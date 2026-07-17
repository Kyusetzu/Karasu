//! Token-Speicherung im Windows Credential Manager (via keyring/DPAPI).
//! Der Access-Token verlässt das Rust-Backend nie Richtung WebView.

const SERVICE: &str = "dev.kyu.karasu";
const USER: &str = "anilist";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("Credential-Store: {e}"))
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|e| format!("Token konnte nicht gespeichert werden: {e}"))
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
