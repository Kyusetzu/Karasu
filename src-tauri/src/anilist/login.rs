//! One-click OAuth login via a temporary localhost callback server.
//!
//! AniList uses the implicit grant, so the access token arrives in the URL
//! *fragment* of the redirect — which an HTTP server never receives. The
//! server therefore serves a tiny bridge page on `/callback` whose JS
//! re-sends the fragment as a query string to `/token`, where the token is
//! validated, stored in the credential manager, and announced to the UI.
//!
//! The AniList client's registered redirect URL must be
//! `http://localhost:46231/callback`.

use crate::anilist::client::AniList;
use crate::db::Db;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Fixed port so the redirect URL registered on AniList always matches.
/// Deliberately below the ephemeral range to avoid clashes with OS-assigned
/// ports; the listener only runs during an active login attempt.
pub const AUTH_CALLBACK_PORT: u16 = 46231;

/// How long the callback server waits for the user to finish in the browser.
const LOGIN_WINDOW: Duration = Duration::from_secs(600);

static ACTIVE: AtomicBool = AtomicBool::new(false);

const BRIDGE_HTML: &str = concat!(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Karasu</title></head>",
    "<body><script>location.replace(\"/token?\"+location.hash.slice(1));</script>",
    "<noscript>JavaScript is required to complete the login.</noscript></body></html>",
);

/// Starts the callback server (if not already running) and returns once the
/// listener is bound. The actual token handling happens on a background
/// thread; the UI is notified through the `anilist-auth` /
/// `anilist-auth-error` events.
pub fn start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if ACTIVE.swap(true, Ordering::SeqCst) {
        // A previous login attempt is still waiting — reuse its listener.
        return Ok(());
    }
    let listener = match bind(AUTH_CALLBACK_PORT) {
        Ok(l) => l,
        Err(e) => {
            ACTIVE.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    std::thread::spawn(move || {
        // Validates the token, persists it and notifies the frontend.
        let on_token = |token: &str| -> Result<(), String> {
            let db = app.state::<Db>();
            let api = app.state::<AniList>();
            match tauri::async_runtime::block_on(crate::commands::connect_with_token(
                &db, &api, token,
            )) {
                Ok(viewer) => {
                    let _ = app.emit("anilist-auth", &viewer);
                    // Bring Karasu back to the front now that the browser is done.
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    Ok(())
                }
                Err(e) => {
                    let _ = app.emit("anilist-auth-error", &e);
                    Err(e)
                }
            }
        };
        serve(&listener, LOGIN_WINDOW, &on_token);
        ACTIVE.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Binds the callback port in non-blocking mode so the accept loop can
/// enforce the login window timeout.
fn bind(port: u16) -> Result<TcpListener, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| {
        format!(
            "Could not open the login callback port {port}: {e}. \
             You can still log in by pasting the token manually."
        )
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok(listener)
}

/// Accept loop. Runs until a token was accepted or the window elapsed.
fn serve(
    listener: &TcpListener,
    window: Duration,
    on_token: &dyn Fn(&str) -> Result<(), String>,
) {
    let deadline = Instant::now() + window;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if handle_connection(stream, on_token) {
                    return; // logged in — shut the server down
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return,
        }
    }
}

/// Handles one HTTP request. Returns true once a token was accepted.
fn handle_connection(
    mut stream: TcpStream,
    on_token: &dyn Fn(&str) -> Result<(), String>,
) -> bool {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return false,
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request.split_whitespace().nth(1).unwrap_or("/");

    if path == "/callback" || path.starts_with("/callback?") {
        respond(&mut stream, 200, BRIDGE_HTML);
        false
    } else if let Some(query) = path.strip_prefix("/token?") {
        match query_param(query, "access_token") {
            Some(token) if !token.is_empty() => match on_token(token) {
                Ok(()) => {
                    respond(
                        &mut stream,
                        200,
                        &page(
                            "You're logged in",
                            "Karasu is now connected to your AniList account. You can close this tab.",
                        ),
                    );
                    true
                }
                Err(e) => {
                    respond(
                        &mut stream,
                        502,
                        &page("Login failed", &format!("{e} — please try again from Karasu.")),
                    );
                    false // keep listening so a retry within the window still works
                }
            },
            _ => {
                respond(
                    &mut stream,
                    400,
                    &page(
                        "Login failed",
                        "AniList did not send an access token. Please try again from Karasu.",
                    ),
                );
                false
            }
        }
    } else {
        respond(&mut stream, 404, &page("Not found", "This page does not exist."));
        false
    }
}

/// Extracts a raw query parameter value (no percent-decoding — AniList
/// tokens are URL-safe JWTs).
fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix(key)?.strip_prefix('='))
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        502 => "Bad Gateway",
        _ => "Not Found",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Minimal dark result page shown in the user's browser.
fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Karasu — {title}</title>\
         <style>body{{background:#0c0e14;color:#e2e5ee;font-family:'Segoe UI',sans-serif;\
         display:grid;place-items:center;height:100vh;margin:0}}main{{text-align:center;max-width:26rem;padding:1rem}}\
         h1{{font-size:1.4rem}}p{{color:#9aa1b5;line-height:1.5}}</style></head>\
         <body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// Spins up the server on an OS-assigned port with a scripted token
    /// handler and returns (port, join handle).
    fn spawn_server(
        accept: &'static str,
        done: mpsc::Sender<()>,
    ) -> (u16, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            serve(&listener, Duration::from_secs(10), &|token| {
                if token == accept {
                    Ok(())
                } else {
                    Err("Token invalid or expired".into())
                }
            });
            let _ = done.send(());
        });
        (port, handle)
    }

    fn get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut body = String::new();
        let _ = s.read_to_string(&mut body);
        body
    }

    #[test]
    fn full_callback_flow() {
        let (tx, rx) = mpsc::channel();
        let (port, handle) = spawn_server("GOOD", tx);

        let bridge = get(port, "/callback");
        assert!(bridge.contains("200 OK"), "bridge page: {bridge}");
        assert!(bridge.contains("/token?"), "bridge must hop to /token");

        let missing = get(port, "/token?token_type=Bearer");
        assert!(missing.contains("400"), "missing token: {missing}");

        let unknown = get(port, "/somewhere");
        assert!(unknown.contains("404"), "unknown path: {unknown}");

        let rejected = get(port, "/token?access_token=BAD&token_type=Bearer");
        assert!(rejected.contains("Login failed"), "bad token: {rejected}");
        assert!(
            rx.try_recv().is_err(),
            "server must keep running after a rejected token"
        );

        let accepted = get(port, "/token?access_token=GOOD&token_type=Bearer");
        assert!(accepted.contains("logged in"), "good token: {accepted}");
        rx.recv_timeout(Duration::from_secs(5))
            .expect("server must shut down after a successful login");
        handle.join().unwrap();
    }

    #[test]
    fn finds_token_among_other_params() {
        let q = "access_token=abc.def-ghi&token_type=Bearer&expires_in=31536000";
        assert_eq!(query_param(q, "access_token"), Some("abc.def-ghi"));
    }

    #[test]
    fn missing_param_returns_none() {
        assert_eq!(query_param("token_type=Bearer", "access_token"), None);
    }

    #[test]
    fn key_prefix_does_not_match() {
        // "access_token_x" must not satisfy a lookup for "access_token"
        assert_eq!(query_param("access_token_x=abc", "access_token"), None);
        assert_eq!(query_param("xaccess_token=abc", "access_token"), None);
    }
}
