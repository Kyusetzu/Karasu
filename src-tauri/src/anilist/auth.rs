//! Token storage. In normal installs the token lives in the OS credential
//! store (keyring — Windows Credential Manager, or the Secret Service on
//! Linux). In portable mode it is stored in a file next to the executable so
//! it travels with the folder, encrypted on both platforms: DPAPI on Windows,
//! XChaCha20-Poly1305 under a Secret Service-held key on Linux. Either way the
//! token never leaves the Rust backend.
//!
//! Both schemes bind the file to the machine and account, and that is not an
//! accident of the Linux one. `CryptProtectData` with no entropy has always
//! been per-user, so a Windows portable token has never decrypted on another
//! machine either. The folder is portable; the sign-in is not, on either
//! platform.

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
    entry().ok()?.get_password().ok()
}

/// Clears the sign-in from **both** stores, whichever mode is active.
///
/// Branching on `is_portable()` here was a hole: an install that had been
/// switched to portable mode signed out of the file and left the token sitting
/// in the credential store — still valid, readable by anything running as that
/// user, and still wired up, because turning portable mode back off made
/// `load_token()` find it again and silently sign the user back in. The mirror
/// case left `token.dat` on disk forever after disabling portable mode.
///
/// Sign-out means signed out, so it clears everywhere a token can live.
#[cfg(any(windows, target_os = "linux"))]
pub fn delete_token() {
    if let Some(path) = crate::portable::token_file() {
        // `NotFound` is the ordinary case (not portable, or never migrated) and
        // is not worth a line; anything else means a live token may still be on
        // disk after the user asked to be signed out.
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

/// Drops the key the portable file was sealed with — it only ever protected
/// the file `delete_token` just removed. Written as a pair rather than a
/// `#[cfg]` on the call above so the call site itself compiles everywhere;
/// a cfg'd statement is invisible to `cargo test` on Windows.
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
// Windows, not "everything that is not Linux": the desktop `delete_token`
// above is this stub's only caller, and on mobile that caller does not exist
// — a not-linux gate left this as dead code on every Android check.
#[cfg(windows)]
fn delete_portable_key() {}

/// Moves the current credential-store token into the encrypted portable file
/// (used when switching a running install into portable mode).
///
/// The distinction between "nothing is stored" and "the store could not be
/// read" is the whole point. Collapsing both into "no token" — which
/// `get_password().ok()` does — reported a successful migration for a user
/// whose keyring was merely locked, and the sign-in was then unreachable
/// through a portable folder that had never received it.
#[cfg(any(windows, target_os = "linux"))]
pub fn migrate_to_portable_file() -> Result<(), String> {
    let entry = entry()?;
    let token = match entry.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Ok(()),
        Err(e) => return Err(format!("Could not read the stored sign-in: {e}")),
    };
    save_token_file(&token)?;
    // Only once the token is safely in the portable file. Leaving it behind
    // would keep a live bearer token in the credential store that sign-out
    // (which follows `is_portable()`) would never reach — so a failure here is
    // worth recording even though the migration itself succeeded.
    if let Err(e) = entry.delete_credential() {
        crate::logging::warn(
            "auth",
            format!("migrated to portable mode but could not clear the old credential: {e}"),
        );
    }
    Ok(())
}

// --- Mobile ------------------------------------------------------------------
//
// `cfg(mobile)`, not `cfg(not(any(windows, linux)))`, and the difference is
// macOS: the module header's stance is that a macOS build fails to compile
// rather than silently getting a backend nobody has tested, and a
// not-windows-not-linux arm would hand it this one. Android and iOS get a
// plain file in the app-private data dir — sandboxed per app by the OS,
// weaker than a credential store, Keystore-backed encryption the named
// follow-up. The invariant that holds regardless: the token stays in Rust
// and never reaches the WebView.

#[cfg(mobile)]
const MOBILE_TOKEN_FILE: &str = "anilist_token.dat";

#[cfg(mobile)]
pub fn save_token(token: &str) -> Result<(), String> {
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)
        .ok_or("The data directory is not known yet")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, token.as_bytes()).map_err(|e| format!("Could not save token: {e}"))
}

#[cfg(mobile)]
pub fn load_token() -> Option<String> {
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)?;
    let raw = std::fs::read(path).ok()?;
    String::from_utf8(raw).ok().filter(|t| !t.is_empty())
}

#[cfg(mobile)]
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

/// Portable mode is an exe-relative concept and phones have no exe dir, so
/// there is never anything to migrate.
#[cfg(mobile)]
pub fn migrate_to_portable_file() -> Result<(), String> {
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
    String::from_utf8(plain).ok()
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

/// The AniList authorize URL.
///
/// `state` is a per-attempt nonce that AniList echoes back in the redirect
/// fragment; the callback server requires it before acting on a token. Without
/// it, `/token` had nothing to distinguish the real redirect from any other
/// page on the machine hitting the same port.
pub fn authorize_url(client_id: &str, state: Option<&str>) -> String {
    let base =
        format!("https://anilist.co/api/v2/oauth/authorize?client_id={client_id}&response_type=token");
    // `None` is the manual-paste fallback: no callback server is listening, so
    // there is nothing for a nonce to protect — the user copies the token out
    // of the page themselves.
    match state {
        Some(s) => format!("{base}&state={s}"),
        None => base,
    }
}

/// Extracts the access token from any user input: raw token, complete
/// redirect URL (`…#access_token=…&token_type=…`) or bare fragment.
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

/// Credential-store entry holding the key the portable token file is sealed
/// with. Separate from the token entry: this one exists precisely so the token
/// does *not* have to live in the credential store.
#[cfg(target_os = "linux")]
const PORTABLE_KEY_USER: &str = "portable-key";

/// Distinguishes this file format from the plaintext one that never shipped,
/// and gives a future change something to branch on. Without it a wrong-format
/// file reaches the AEAD as garbage and fails with nothing to say.
#[cfg(target_os = "linux")]
const MAGIC: &[u8; 5] = b"KRSU1";
#[cfg(target_os = "linux")]
const NONCE_LEN: usize = 24;

/// The portable file's key, generated on first use and kept in the Secret
/// Service.
///
/// Failing closed is deliberate. The alternative — writing the token in the
/// clear when no keyring daemon is running — is what this replaces, and
/// shipping that under the word "encrypted" would be a lie. Note the default,
/// non-portable path already requires the Secret Service (`entry()` above), so
/// this asks for nothing new; a desktop without one cannot store a token at
/// all, in either mode.
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
            // A key that cannot be read is worse than none: it would decrypt
            // nothing and silently re-seal under a new one. Say so instead.
            return Err("The stored portable key is unreadable; sign in again".into());
        }
        // First use — fall through and generate one.
        Err(keyring::Error::NoEntry) => {}
        // Anything else (locked collection, no D-Bus) is not "no key yet".
        // Treating it as such would generate a replacement for a key that
        // exists, which is how an existing token.dat becomes undecryptable.
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

    // Length first, so a short file is an error rather than a panic on the
    // slice below — the obvious way to get this wrong.
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

    /// A truncated file must error, not panic — slicing past the end is how
    /// this would otherwise take the app down on a corrupt USB stick.
    #[test]
    fn a_truncated_file_is_an_error_not_a_panic() {
        assert!(open(&KEY, b"").is_err());
        assert!(open(&KEY, MAGIC).is_err());
        assert!(open(&KEY, b"KRSU1short").is_err());
        assert!(open(&KEY, b"NOTMEnonce........................").is_err());
    }
}
