//! Token storage. In normal installs the token lives in the OS credential
//! store (keyring — Windows Credential Manager, or the Secret Service on
//! Linux). In portable mode it is stored in a file next to the executable so
//! it travels with the folder: DPAPI-encrypted on Windows; on other platforms
//! (Linux groundwork) it is currently stored unencrypted — a future
//! platform-keystore/passphrase step is needed there. Either way the token
//! never leaves the Rust backend.

const SERVICE: &str = "dev.kyu.karasu";
const USER: &str = "anilist";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("Credential store: {e}"))
}

pub fn save_token(token: &str) -> Result<(), String> {
    if crate::portable::is_portable() {
        return save_token_file(token);
    }
    entry()?
        .set_password(token)
        .map_err(|e| format!("Could not save token: {e}"))
}

pub fn load_token() -> Option<String> {
    if crate::portable::is_portable() {
        return load_token_file();
    }
    entry().ok()?.get_password().ok()
}

pub fn delete_token() {
    if crate::portable::is_portable() {
        if let Some(path) = crate::portable::token_file() {
            let _ = std::fs::remove_file(path);
        }
        return;
    }
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}

/// Copies the current keyring token into the portable DPAPI file (used when
/// switching a running install into portable mode).
pub fn migrate_to_portable_file() -> Result<(), String> {
    if let Some(token) = entry().ok().and_then(|e| e.get_password().ok()) {
        save_token_file(&token)?;
    }
    Ok(())
}

fn save_token_file(token: &str) -> Result<(), String> {
    let path = crate::portable::token_file().ok_or("No portable path")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let bytes = protect(token.as_bytes())?;
    std::fs::write(path, bytes).map_err(|e| format!("Could not save token: {e}"))
}

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

// Non-Windows groundwork: store as-is for now. NOT encrypted — a platform
// keystore or passphrase should back this before portable mode ships on Linux.
#[cfg(not(windows))]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}
#[cfg(not(windows))]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
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

pub fn authorize_url(client_id: &str) -> String {
    format!("https://anilist.co/api/v2/oauth/authorize?client_id={client_id}&response_type=token")
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
