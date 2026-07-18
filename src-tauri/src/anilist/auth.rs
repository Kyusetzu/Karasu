//! Token storage in the Windows Credential Manager (via keyring/DPAPI).
//! The access token never leaves the Rust backend towards the WebView.

const SERVICE: &str = "dev.kyu.karasu";
const USER: &str = "anilist";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("Credential store: {e}"))
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|e| format!("Could not save token: {e}"))
}

pub fn load_token() -> Option<String> {
    entry().ok()?.get_password().ok()
}

pub fn delete_token() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
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
