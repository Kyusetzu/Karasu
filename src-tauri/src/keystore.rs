//! Android-Keystore sealing for the mobile secret files.
//!
//! The mobile arms of `anilist::auth` and `detection::jellyfin` used to write
//! their tokens as plain UTF-8 into the app-private data dir — sandboxed per
//! app by the OS, but not encrypted at rest, and both files named Keystore as
//! the follow-up. This is that follow-up: the bytes on disk become
//! `KRSA1 || iv(12) || ciphertext+tag`, AES-256-GCM under a key that never
//! leaves the Android Keystore (`TokenCipher.kt` in the generated tree — a
//! hand-written file, restore it from git if a wiped gen/ tree loses it).
//!
//! The JNI route is tao's own: `main_android_context()` hands over the
//! `JavaVM` and the activity, and the class is resolved through the
//! activity's ClassLoader — a bare JNI `FindClass` from a native thread
//! cannot see app classes at all. `jni` and `tao` are pinned to the versions
//! tauri already compiles (Cargo.lock), so this adds no second copy — the
//! rustls-skew class of mistake `net.rs` documents.
//!
//! Failure honesty follows `portable_key()`'s: a Keystore refusal is an
//! error carried upward, never silently "no key yet" — but the *call sites*
//! render an undecryptable file as "signed out" (the quiet sign-in screen),
//! never a crash loop. The framing half below is pure and tested on every
//! platform; only the sealing itself needs the phone.

/// Distinguishes the sealed format from the plaintext files that shipped
/// before it — the legacy branch of `classify` is what migrates them.
pub const MAGIC: &[u8; 5] = b"KRSA1";

/// What a mobile secret file holds.
pub enum Stored<'a> {
    /// `MAGIC` was present; the rest is `iv || ciphertext` for `open`.
    /// May still fail to decrypt — truncation, tampering, a vanished key.
    Sealed(&'a [u8]),
    /// No magic: a token written by a build before sealing existed,
    /// to be re-wrapped in place on first read.
    Legacy(&'a [u8]),
}

pub fn classify(blob: &[u8]) -> Stored<'_> {
    // Length first, so a short file is a branch rather than a panic on the
    // slice below — the same note `open` in anilist/auth.rs carries.
    if blob.len() >= MAGIC.len() && &blob[..MAGIC.len()] == MAGIC {
        Stored::Sealed(&blob[MAGIC.len()..])
    } else {
        Stored::Legacy(blob)
    }
}

/// Frames a `TokenCipher.seal` result into the on-disk format.
pub fn frame(sealed: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(MAGIC.len() + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(sealed);
    out
}

#[cfg(target_os = "android")]
mod jni_impl {
    use jni::objects::{JByteArray, JObject, JValue};

    fn err<E: std::fmt::Display>(what: &str) -> impl FnOnce(E) -> String + '_ {
        move |e| format!("keystore {what}: {e}")
    }

    fn call(method: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let ctx = tao::platform::android::prelude::main_android_context()
            .ok_or("keystore: the android context is not ready yet")?;
        let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
            .map_err(err("vm"))?;
        let mut env = vm.attach_current_thread().map_err(err("attach"))?;
        let activity = unsafe { JObject::from_raw(ctx.context_jobject.cast()) };

        // Through the activity's ClassLoader, not FindClass: a native thread's
        // JNI FindClass only sees system classes.
        let result = (|| -> jni::errors::Result<Vec<u8>> {
            let loader = env
                .call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
                .l()?;
            let name = env.new_string("dev.kyu.karasu.TokenCipher")?;
            let class = env
                .call_method(
                    &loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[JValue::Object(&name)],
                )?
                .l()?;
            let arr = env.byte_array_from_slice(data)?;
            let out = env
                .call_static_method(
                    &jni::objects::JClass::from(class),
                    method,
                    "([B)[B",
                    &[JValue::Object(&arr)],
                )?
                .l()?;
            env.convert_byte_array(&JByteArray::from(out))
        })();

        result.map_err(|e| {
            // A pending Java exception poisons every later JNI call on the
            // thread; clear it and carry the message instead.
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            format!("keystore {method}: {e}")
        })
    }

    pub fn seal(plain: &[u8]) -> Result<Vec<u8>, String> {
        call("seal", plain)
    }

    pub fn open(sealed: &[u8]) -> Result<Vec<u8>, String> {
        call("open", sealed)
    }
}

#[cfg(target_os = "android")]
pub use jni_impl::{open, seal};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_framed_blob_classifies_as_sealed_with_the_payload() {
        let framed = frame(b"ivandciphertext");
        match classify(&framed) {
            Stored::Sealed(rest) => assert_eq!(rest, b"ivandciphertext"),
            Stored::Legacy(_) => panic!("framed bytes read as legacy"),
        }
    }

    #[test]
    fn a_plaintext_token_classifies_as_legacy_in_full() {
        match classify(b"some-oauth-token") {
            Stored::Legacy(all) => assert_eq!(all, b"some-oauth-token"),
            Stored::Sealed(_) => panic!("plaintext read as sealed"),
        }
    }

    #[test]
    fn short_and_empty_files_are_legacy_not_panics() {
        for blob in [&b""[..], b"K", b"KRSA", b"XRSA1"] {
            assert!(matches!(classify(blob), Stored::Legacy(_)));
        }
    }

    #[test]
    fn a_bare_magic_is_sealed_with_an_empty_payload() {
        // `open` then fails on the phone — truncation is a decrypt error,
        // never a silent fallback to treating "KRSA1" as somebody's token.
        assert!(matches!(classify(MAGIC), Stored::Sealed(rest) if rest.is_empty()));
    }
}
