//! Token storage: the OS credential store, or an encrypted file in portable mode; the token never leaves Rust.

#[cfg(any(windows, target_os = "linux"))]
const SERVICE: &str = "dev.kyu.karasu";
#[cfg(any(windows, target_os = "linux"))]
const USER: &str = "anilist";

#[cfg(any(windows, target_os = "linux"))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("Credential store: {e}"))
}

#[cfg(any(windows, target_os = "linux"))]
pub fn save_token(token: &str) -> Result<(), String> {
    if crate::portable::is_portable() {
        return save_token_file(token);
    }
    entry()?
        .set_password(token)
        .map_err(|e| format!("Could not save token: {e}"))
}

#[cfg(any(windows, target_os = "linux"))]
pub fn load_token() -> Option<String> {
    if crate::portable::is_portable() {
        return load_token_file();
    }
    // A zero-length credential would become an empty Bearer header, which AniList rejects even on public queries.
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

/// Clears the sign-in from both stores whichever mode is active; sign-out means signed out everywhere.
#[cfg(any(windows, target_os = "linux"))]
pub fn delete_token() {
    if let Some(path) = crate::portable::token_file() {
        // `NotFound` is the ordinary case; anything else means a live token may still be on disk after sign-out.
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                crate::logging::error(
                    "auth",
                    format!("sign-out could not remove {}: {e}", path.display()),
                );
            }
        }
    }
    match entry() {
        Ok(e) => {
            if let Err(e) = e.delete_credential() {
                if !matches!(e, keyring::Error::NoEntry) {
                    crate::logging::error(
                        "auth",
                        format!("sign-out could not clear the credential store: {e}"),
                    );
                }
            }
        }
        Err(e) => crate::logging::error(
            "auth",
            format!("sign-out could not reach the credential store: {e}"),
        ),
    }
    delete_portable_key();
}

/// Drops the key the portable file was sealed with; a cfg'd pair so the call site compiles everywhere.
#[cfg(target_os = "linux")]
fn delete_portable_key() {
    if let Ok(e) = keyring::Entry::new(SERVICE, PORTABLE_KEY_USER) {
        if let Err(e) = e.delete_credential() {
            if !matches!(e, keyring::Error::NoEntry) {
                crate::logging::warn(
                    "auth",
                    format!("sign-out could not drop the portable key: {e}"),
                );
            }
        }
    }
}
// Windows, not not-Linux: the desktop `delete_token` is this stub's only caller, and mobile has no such caller.
#[cfg(windows)]
fn delete_portable_key() {}

/// Copies the credential-store token into the portable file; clearing is separate so a failed switch never loses it.
#[cfg(any(windows, target_os = "linux"))]
pub fn copy_token_to_portable_file() -> Result<(), String> {
    let entry = entry()?;
    let token = match entry.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Ok(()),
        Err(e) => return Err(format!("Could not read the stored sign-in: {e}")),
    };
    save_token_file(&token)
}

/// Drops the credential-store copy once portable mode is in effect; a failure is logged, since the switch succeeded.
#[cfg(any(windows, target_os = "linux"))]
pub fn clear_credential_store_token() {
    let Ok(entry) = entry() else { return };
    if let Err(e) = entry.delete_credential() {
        if !matches!(e, keyring::Error::NoEntry) {
            crate::logging::warn(
                "auth",
                format!("switched to portable mode but could not clear the old credential: {e}"),
            );
        }
    }
}

/// The way back out, portable file to credential store; the portable file is left in place as the user's data.
#[cfg(any(windows, target_os = "linux"))]
pub fn copy_token_from_portable_file() -> Result<(), String> {
    let Some(token) = load_token_file() else {
        return Ok(());
    };
    entry()?
        .set_password(&token)
        .map_err(|e| format!("Could not restore the stored sign-in: {e}"))
}

// Mobile is `cfg(mobile)`, not not-desktop, so a macOS build fails to compile rather than getting an untested backend.
#[cfg(mobile)]
const MOBILE_TOKEN_FILE: &str = "anilist_token.dat";

/// One read per process, not one JNI round-trip per detection tick; `None` = not yet looked, `Some(None)` = signed out.
#[cfg(target_os = "android")]
static TOKEN_CACHE: std::sync::Mutex<Option<Option<String>>> = std::sync::Mutex::new(None);

#[cfg(target_os = "android")]
pub fn save_token(token: &str) -> Result<(), String> {
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)
        .ok_or("The data directory is not known yet")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let sealed = crate::keystore::seal(token.as_bytes())?;
    std::fs::write(path, crate::keystore::frame(&sealed))
        .map_err(|e| format!("Could not save token: {e}"))?;
    *TOKEN_CACHE.lock().unwrap() = Some(Some(token.to_string()));
    Ok(())
}

/// Reads the Keystore-sealed token; a plaintext token from an older build is re-wrapped in place on first read.
#[cfg(target_os = "android")]
pub fn load_token() -> Option<String> {
    if let Some(cached) = TOKEN_CACHE.lock().unwrap().clone() {
        return cached;
    }
    // The data dir not being known yet is "could not look", never cached.
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)?;
    let token = match std::fs::read(&path) {
        Ok(raw) => match crate::keystore::classify(&raw) {
            crate::keystore::Stored::Sealed(sealed) => match crate::keystore::open(sealed) {
                Ok(plain) => String::from_utf8(plain).ok().filter(|t| !t.is_empty()),
                Err(e) => {
                    // Undecryptable reads as signed out, never a crash loop; named in the log, since the UI cannot tell.
                    crate::logging::warn(
                        "auth",
                        format!("stored token would not decrypt; signed out: {e}"),
                    );
                    None
                }
            },
            // A token written before sealing existed is re-wrapped in place; a failed re-wrap must never cost a sign-in.
            crate::keystore::Stored::Legacy(plain) => {
                let token = String::from_utf8(plain.to_vec())
                    .ok()
                    .filter(|t| !t.is_empty());
                if let Some(t) = &token {
                    match crate::keystore::seal(t.as_bytes()) {
                        Ok(sealed) => {
                            if let Err(e) =
                                std::fs::write(&path, crate::keystore::frame(&sealed))
                            {
                                crate::logging::warn(
                                    "auth",
                                    format!("could not rewrite the migrated token: {e}"),
                                );
                            } else {
                                crate::logging::info("auth", "token migrated to the Keystore");
                            }
                        }
                        Err(e) => crate::logging::warn(
                            "auth",
                            format!("token migration failed, keeping plaintext for now: {e}"),
                        ),
                    }
                }
                token
            }
        },
        Err(_) => None,
    };
    *TOKEN_CACHE.lock().unwrap() = Some(token.clone());
    token
}

#[cfg(target_os = "android")]
pub fn delete_token() {
    *TOKEN_CACHE.lock().unwrap() = Some(None);
    // The Keystore key alias stays: dropping it would orphan a sealed Jellyfin token sharing the same key.
    let Some(path) = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE) else {
        return;
    };
    if let Err(e) = std::fs::remove_file(&path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            crate::logging::error(
                "auth",
                format!("sign-out could not remove {}: {e}", path.display()),
            );
        }
    }
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn save_token(token: &str) -> Result<(), String> {
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)
        .ok_or("The data directory is not known yet")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, token.as_bytes()).map_err(|e| format!("Could not save token: {e}"))
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn load_token() -> Option<String> {
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)?;
    let raw = std::fs::read(path).ok()?;
    String::from_utf8(raw).ok().filter(|t| !t.is_empty())
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn delete_token() {
    let Some(path) = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE) else {
        return;
    };
    if let Err(e) = std::fs::remove_file(&path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            crate::logging::error(
                "auth",
                format!("sign-out could not remove {}: {e}", path.display()),
            );
        }
    }
}

/// Phones have no exe dir, so there is nothing to migrate; a cfg'd trio rather than a cfg on the call site.
#[cfg(mobile)]
pub fn copy_token_to_portable_file() -> Result<(), String> {
    Ok(())
}

#[cfg(mobile)]
pub fn clear_credential_store_token() {}

#[cfg(mobile)]
pub fn copy_token_from_portable_file() -> Result<(), String> {
    Ok(())
}

#[cfg(any(windows, target_os = "linux"))]
fn save_token_file(token: &str) -> Result<(), String> {
    let path = crate::portable::token_file().ok_or("No portable path")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let bytes = protect(token.as_bytes())?;
    std::fs::write(path, bytes).map_err(|e| format!("Could not save token: {e}"))
}

#[cfg(any(windows, target_os = "linux"))]
fn load_token_file() -> Option<String> {
    let path = crate::portable::token_file()?;
    let raw = std::fs::read(path).ok()?;
    let plain = unprotect(&raw).ok()?;
    String::from_utf8(plain).ok().filter(|t| !t.is_empty())
}

/// Per-platform at-rest protection for the portable token file.
#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi_protect(data)
}
#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi_unprotect(data)
}

#[cfg(target_os = "linux")]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    seal(&portable_key()?, data)
}
#[cfg(target_os = "linux")]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    open(&portable_key()?, data)
}

/// Encrypts bytes with the Windows Data Protection API (per-user).
#[cfg(windows)]
fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            0,
            &mut output,
        )
        .map_err(|e| format!("Encryption failed: {e}"))?;
        let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
        Ok(out)
    }
}

/// Decrypts bytes previously produced by `dpapi_protect`.
#[cfg(windows)]
fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            0,
            &mut output,
        )
        .map_err(|e| format!("Decryption failed: {e}"))?;
        let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
        Ok(out)
    }
}

#[cfg(all(test, windows))]
mod dpapi_tests {
    use super::{dpapi_protect, dpapi_unprotect};

    #[test]
    fn round_trip() {
        let secret = b"eyJ.access.token-value_123";
        let enc = dpapi_protect(secret).expect("protect");
        assert_ne!(enc, secret);
        let dec = dpapi_unprotect(&enc).expect("unprotect");
        assert_eq!(dec, secret);
    }
}

/// The AniList authorize URL; `state` is the per-attempt nonce the callback server requires before acting on a token.
pub fn authorize_url(client_id: &str, state: Option<&str>) -> String {
    let base =
        format!("https://anilist.co/api/v2/oauth/authorize?client_id={client_id}&response_type=token");
    // `None` is the manual-paste fallback: no callback server is listening, so there is nothing for a nonce to protect.
    match state {
        Some(s) => format!("{base}&state={s}"),
        None => base,
    }
}

/// Extracts the access token from a raw token, a complete redirect URL or a bare fragment.
pub fn extract_token(input: &str) -> String {
    let input = input.trim();
    match input.find("access_token=") {
        Some(idx) => input[idx + "access_token=".len()..]
            .split(['&', '#', ' '])
            .next()
            .unwrap_or("")
            .to_string(),
        None => input.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::extract_token;

    #[test]
    fn raw_token_passes_through() {
        assert_eq!(extract_token("  abc.def.ghi  "), "abc.def.ghi");
    }

    #[test]
    fn full_redirect_url() {
        let url = "https://anilist.co/api/v2/oauth/null#access_token=abc.def.ghi&token_type=Bearer&expires_in=31536000";
        assert_eq!(extract_token(url), "abc.def.ghi");
    }

    #[test]
    fn bare_fragment() {
        assert_eq!(
            extract_token("access_token=xyz&token_type=Bearer"),
            "xyz"
        );
    }
}

// --- Linux portable-token encryption ----------------------------------------

/// The credential-store entry holding the portable file's key, so the token itself need not live there.
#[cfg(target_os = "linux")]
const PORTABLE_KEY_USER: &str = "portable-key";

/// Identifies the file format, so a wrong-format file fails with something to say rather than as AEAD garbage.
#[cfg(target_os = "linux")]
const MAGIC: &[u8; 5] = b"KRSU1";
#[cfg(target_os = "linux")]
const NONCE_LEN: usize = 24;

/// The portable file's key, generated on first use and kept in the Secret Service; failing closed is deliberate.
#[cfg(target_os = "linux")]
fn portable_key() -> Result<[u8; 32], String> {
    use base64::Engine as _;
    let engine = base64::engine::general_purpose::STANDARD;
    let store = keyring::Entry::new(SERVICE, PORTABLE_KEY_USER)
        .map_err(|e| format!("Portable mode needs a login keyring: {e}"))?;

    match store.get_password() {
        Ok(existing) => {
            if let Ok(raw) = engine.decode(existing.trim()) {
                if let Ok(key) = <[u8; 32]>::try_from(raw.as_slice()) {
                    return Ok(key);
                }
            }
            // A key that cannot be read is worse than none: it would decrypt nothing and silently re-seal under a new one.
            return Err("The stored portable key is unreadable; sign in again".into());
        }
        // First use — fall through and generate one.
        Err(keyring::Error::NoEntry) => {}
        // A locked collection or no D-Bus is not "no key yet"; a replacement key makes the existing token.dat undecryptable.
        Err(e) => return Err(format!("Portable mode needs a login keyring: {e}")),
    }

    let mut key = [0u8; 32];
    use chacha20poly1305::aead::rand_core::RngCore;
    chacha20poly1305::aead::OsRng.fill_bytes(&mut key);
    store
        .set_password(&engine.encode(key))
        .map_err(|e| format!("Portable mode needs a login keyring to hold its key: {e}"))?;
    Ok(key)
}

#[cfg(target_os = "linux")]
fn seal(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};
    use chacha20poly1305::aead::rand_core::RngCore;

    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), plain)
        .map_err(|_| "Could not encrypt the token".to_string())?;

    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

#[cfg(target_os = "linux")]
fn open(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, String> {
    use chacha20poly1305::aead::{Aead, KeyInit};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};

    // Length first, so a short file is an error rather than a panic on the slice below.
    let head = MAGIC.len() + NONCE_LEN;
    if blob.len() <= head || &blob[..MAGIC.len()] != MAGIC {
        return Err("That token file is not in a format Karasu wrote".into());
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(
            XNonce::from_slice(&blob[MAGIC.len()..head]),
            &blob[head..],
        )
        .map_err(|_| "Could not decrypt the token; sign in again".to_string())
}

#[cfg(all(test, target_os = "linux"))]
mod portable_crypto_tests {
    use super::*;

    const KEY: [u8; 32] = [7u8; 32];

    #[test]
    fn a_sealed_token_round_trips() {
        let sealed = seal(&KEY, b"a.token.value").unwrap();
        assert!(sealed.starts_with(MAGIC), "the format has to be identifiable");
        assert_eq!(open(&KEY, &sealed).unwrap(), b"a.token.value");
    }

    /// Two seals of the same token must differ, or the nonce is not random.
    #[test]
    fn sealing_twice_does_not_repeat_itself() {
        assert_ne!(seal(&KEY, b"same").unwrap(), seal(&KEY, b"same").unwrap());
    }

    #[test]
    fn a_tampered_or_foreign_file_is_rejected() {
        let mut sealed = seal(&KEY, b"a.token.value").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert!(open(&KEY, &sealed).is_err(), "AEAD must catch a flipped byte");

        let sealed = seal(&KEY, b"a.token.value").unwrap();
        assert!(open(&[9u8; 32], &sealed).is_err(), "a wrong key must not open it");
    }

    /// A truncated file must error, not panic.
    #[test]
    fn a_truncated_file_is_an_error_not_a_panic() {
        assert!(open(&KEY, b"").is_err());
        assert!(open(&KEY, MAGIC).is_err());
        assert!(open(&KEY, b"KRSU1short").is_err());
        assert!(open(&KEY, b"NOTMEnonce........................").is_err());
    }
}
