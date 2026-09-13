//! Android-Keystore sealing for the mobile secret files, the Rust side of `TokenCipher.kt`.

/// Distinguishes the sealed format from the plaintext files that shipped before it.
// The framing half is compiled everywhere so its tests run on desktop, where a release build reads it as unused.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub const MAGIC: &[u8; 5] = b"KRSA1";

/// What a mobile secret file holds.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub enum Stored<'a> {
    /// `MAGIC` was present; the rest is `iv || ciphertext` for `open`, which may still fail to decrypt.
    Sealed(&'a [u8]),
    /// No magic: a token written by a build before sealing existed, re-wrapped in place on first read.
    Legacy(&'a [u8]),
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn classify(blob: &[u8]) -> Stored<'_> {
    // Length first, so a short file is a branch rather than a panic on the slice below.
    if blob.len() >= MAGIC.len() && &blob[..MAGIC.len()] == MAGIC {
        Stored::Sealed(&blob[MAGIC.len()..])
    } else {
        Stored::Legacy(blob)
    }
}

/// Frames a `TokenCipher.seal` result into the on-disk format.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn frame(sealed: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(MAGIC.len() + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(sealed);
    out
}

#[cfg(target_os = "android")]
pub mod jni_impl {
    use jni::objects::{JByteArray, JClass, JObject, JValue};
    use jni::JNIEnv;

    fn err<E: std::fmt::Display>(what: &str) -> impl FnOnce(E) -> String + '_ {
        move |e| format!("keystore {what}: {e}")
    }

    /// The core, parameterized over any JVM thread's env and any `Context`, so the dead-app job can use it too.
    // Consumed by the background-notification entry point; the allow goes when that lands.
    #[allow(dead_code)]
    pub fn call_with_env(
        env: &mut JNIEnv,
        context: &JObject,
        method: &str,
        data: &[u8],
    ) -> Result<Vec<u8>, String> {
        // Through the context's ClassLoader, not FindClass: a native thread's FindClass only sees system classes.
        let result = (|| -> jni::errors::Result<Vec<u8>> {
            let loader = env
                .call_method(context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
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
                    &JClass::from(class),
                    method,
                    "([B)[B",
                    &[JValue::Object(&arr)],
                )?
                .l()?;
            env.convert_byte_array(&JByteArray::from(out))
        })();

        result.map_err(|e| {
            // A pending Java exception poisons every later JNI call on the thread; clear it and carry the message.
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            format!("keystore {method}: {e}")
        })
    }

    fn call(method: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let ctx = tao::platform::android::prelude::main_android_context()
            .ok_or("keystore: the android context is not ready yet")?;
        let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
            .map_err(err("vm"))?;
        let mut env = vm.attach_current_thread().map_err(err("attach"))?;
        let activity = unsafe { JObject::from_raw(ctx.context_jobject.cast()) };
        call_with_env(&mut env, &activity, method, data)
    }

    pub fn seal(plain: &[u8]) -> Result<Vec<u8>, String> {
        call("seal", plain)
    }

    pub fn open(sealed: &[u8]) -> Result<Vec<u8>, String> {
        call("open", sealed)
    }
}

// `call_with_env` stays addressed by its module path; a re-export here tripped unused-import before its caller landed.
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
        // `open` then fails on the phone: truncation is a decrypt error, never a silent fallback to "KRSA1" as a token.
        assert!(matches!(classify(MAGIC), Stored::Sealed(rest) if rest.is_empty()));
    }
}
