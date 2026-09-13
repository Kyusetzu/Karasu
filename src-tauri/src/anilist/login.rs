//! One-click OAuth login: a localhost callback server whose bridge page re-sends the URL fragment to `/token`.

use crate::anilist::client::AniList;
use crate::sync::LockExt;
use crate::db::Db;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Fixed so the redirect URL registered on AniList always matches; deliberately below the ephemeral range.
pub const AUTH_CALLBACK_PORT: u16 = 46231;

/// How long the callback server waits for the user to finish in the browser.
const LOGIN_WINDOW: Duration = Duration::from_secs(600);

static ACTIVE: AtomicBool = AtomicBool::new(false);

/// The `state` nonce for the login in flight; without it any page in the browser could hand Karasu its own token.
static PENDING_STATE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// A fresh 256-bit nonce, hex-encoded.
fn new_state() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Could not start login: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Constant-time equality, so a reply cannot be guessed a byte at a time.
fn state_matches(expected: &str, given: &str) -> bool {
    let (a, b) = (expected.as_bytes(), given.as_bytes());
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

const BRIDGE_HTML: &str = concat!(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Karasu</title></head>",
    "<body><script>location.replace(\"/token?\"+location.hash.slice(1));</script>",
    "<noscript>JavaScript is required to complete the login.</noscript></body></html>",
);

/// Starts the callback server if it is not running and returns the `state` nonce the authorize URL must carry.
pub fn start<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    if ACTIVE.swap(true, Ordering::SeqCst) {
        // A previous attempt is still waiting: reuse its listener and its nonce, which is what the server checks.
        return PENDING_STATE
            .guard()
            .clone()
            .ok_or_else(|| "A login is already in progress".to_string());
    }
    let listener = match bind(AUTH_CALLBACK_PORT) {
        Ok(l) => l,
        Err(e) => {
            ACTIVE.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let state = match new_state() {
        Ok(s) => s,
        Err(e) => {
            ACTIVE.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    *PENDING_STATE.guard() = Some(state.clone());
    std::thread::spawn(move || {
        // Validates the token, persists it and notifies the frontend.
        let on_token = |token: &str| -> Result<(), String> {
            // Front the app before the connect: the browser tab resolves at once, so the outcome lands in this window.
            surface_main_window(&app);
            let db = app.state::<Db>();
            let api = app.state::<AniList>();
            match tauri::async_runtime::block_on(crate::commands::connect_with_token(
                &db, &api, token,
            )) {
                Ok(viewer) => {
                    let _ = app.emit("anilist-auth", &viewer);
                    Ok(())
                }
                Err(e) => {
                    // Logged as well as emitted, so the error still exists somewhere after the one screen it paints.
                    crate::logging::warn(
                        "auth",
                        format!("connect after the callback failed: {e}"),
                    );
                    let _ = app.emit("anilist-auth-error", &e);
                    Err(e)
                }
            }
        };
        serve(&listener, LOGIN_WINDOW, &on_token);
        // The window is over: no further reply can be legitimate.
        *PENDING_STATE.guard() = None;
        ACTIVE.store(false, Ordering::SeqCst);
    });
    Ok(state)
}

/// Binds the callback port non-blocking so the accept loop can enforce the login window timeout.
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

/// Accept loop. Runs until a token was delivered or the window elapsed.
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

/// Handles one request; true once a state-valid token was delivered, whatever the connect then does.
fn handle_connection(
    mut stream: TcpStream,
    on_token: &dyn Fn(&str) -> Result<(), String>,
) -> bool {
    // Back to blocking: on Windows the accepted socket inherits the listener's flag and the read fails with `WouldBlock`.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let request = match read_request(&mut stream) {
        Some(r) => r,
        None => return false,
    };
    let path = request.split_whitespace().nth(1).unwrap_or("/");

    if path == "/callback" || path.starts_with("/callback?") {
        respond(&mut stream, 200, BRIDGE_HTML);
        false
    } else if let Some(query) = path.strip_prefix("/token?") {
        // The bridge page sends no `Origin` and a cross-site fetch always does; cheap, but the nonce is what holds.
        if has_origin_header(&request) || !state_ok(query) {
            respond(
                &mut stream,
                403,
                &page(
                    "Login failed",
                    "That login response did not come from Karasu. Please start again from the app.",
                ),
            );
            return false;
        }
        match query_param(query, "access_token") {
            Some(token) if !token.is_empty() => {
                // The page goes out before the connect and claims only the handoff: on a failed connect it is all the tab shows.
                respond(&mut stream, 200, &handoff_page());
                // `true` either way: the browser's job ended at delivery, and the in-app button is the retry now.
                let _ = on_token(token);
                true
            }
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

/// Whether the query carries the nonce this login attempt was started with.
fn state_ok(query: &str) -> bool {
    let expected = PENDING_STATE.guard();
    match (expected.as_deref(), query_param(query, "state")) {
        (Some(want), Some(got)) => state_matches(want, got),
        // No pending login means nothing legitimate can arrive here.
        _ => false,
    }
}

/// Whether the request carries an `Origin` header, i.e. came from a page.
fn has_origin_header(request: &str) -> bool {
    request
        .lines()
        .any(|l| l.to_ascii_lowercase().starts_with("origin:"))
}

/// Reads the request head up to the blank line; one `read` is not enough, since TCP gives no framing guarantees.
fn read_request(stream: &mut TcpStream) -> Option<String> {
    let mut buf = [0u8; 8192];
    let mut len = 0;
    while len < buf.len() {
        match stream.read(&mut buf[len..]) {
            Ok(0) => break, // peer closed
            Ok(n) => {
                len += n;
                if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                    break; // headers complete
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break, // timed out or reset — use whatever arrived
        }
    }
    (len > 0).then(|| String::from_utf8_lossy(&buf[..len]).into_owned())
}

/// Extracts a raw query parameter value; no percent-decoding, since AniList tokens are URL-safe JWTs.
fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix(key)?.strip_prefix('='))
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        _ => "Not Found",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    // Half-close so the peer sees a clean end-of-response instead of a reset mid-read.
    let _ = stream.shutdown(Shutdown::Write);
}

/// The page a delivered token shows, served before the connect runs, so it claims only the handoff, never success.
#[cfg(not(target_os = "android"))]
fn handoff_page() -> String {
    page(
        "Finishing sign-in",
        "Karasu is finishing the sign-in — you can close this tab and return to the app.",
    )
}

/// On Android the page carries the hop back to the app: a `karasu://login` link plus a best-effort automatic attempt.
#[cfg(target_os = "android")]
fn handoff_page() -> String {
    page(
        "Finishing sign-in",
        "Karasu is finishing the sign-in.</p>\
         <p><a href=\"karasu://login\" style=\"display:inline-block;margin-top:.75rem;\
         padding:.7rem 1.5rem;border-radius:.7rem;background:#4b3fc7;color:#fff;\
         text-decoration:none;font-weight:600\">Return to Karasu</a></p>\
         <script>setTimeout(function(){location.href=\"karasu://login\"},350)</script><p>",
    )
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

    /// The nonce every test hands to `/token`, so the shared `PENDING_STATE` is safe to set from each of them.
    const TEST_STATE: &str = "0123456789abcdef";

    /// Spins up the server on an OS-assigned port with a scripted token handler.
    fn spawn_server(
        accept: &'static str,
        done: mpsc::Sender<()>,
    ) -> (u16, std::thread::JoinHandle<()>) {
        *PENDING_STATE.guard() = Some(TEST_STATE.to_string());
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

    /// Sends one request and reads the response until the server closes; every failure mode is loud on purpose.
    fn get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        request(&mut s, path);
        read_response(&mut s, path)
    }

    fn request(s: &mut TcpStream, path: &str) {
        send(s, path, &format!("GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n"));
    }

    fn send(s: &mut TcpStream, path: &str, bytes: &str) {
        s.write_all(bytes.as_bytes())
            .and_then(|()| s.flush())
            .unwrap_or_else(|e| panic!("sending {path} failed: {e}"));
    }

    /// Reads to end-of-stream and checks the response arrived whole, so a short read fails as a short read.
    fn read_response(s: &mut TcpStream, path: &str) -> String {
        let mut response = String::new();
        s.read_to_string(&mut response)
            .unwrap_or_else(|e| panic!("reading the response to {path} failed: {e}"));

        let (head, body) = response
            .split_once("\r\n\r\n")
            .unwrap_or_else(|| panic!("response to {path} has no headers: {response:?}"));
        let declared: usize = head
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: "))
            .unwrap_or_else(|| panic!("response to {path} has no Content-Length: {head:?}"))
            .trim()
            .parse()
            .unwrap();
        assert_eq!(
            body.len(),
            declared,
            "response to {path} was truncated: {} of {declared} body bytes",
            body.len()
        );
        response
    }

    #[test]
    fn full_callback_flow() {
        let (tx, rx) = mpsc::channel();
        let (port, handle) = spawn_server("GOOD", tx);

        let bridge = get(port, "/callback");
        assert!(bridge.contains("200 OK"), "bridge page: {bridge}");
        assert!(bridge.contains("/token?"), "bridge must hop to /token");

        let missing = get(port, &format!("/token?token_type=Bearer&state={TEST_STATE}"));
        assert!(missing.contains("400"), "missing token: {missing}");

        let unknown = get(port, "/somewhere");
        assert!(unknown.contains("404"), "unknown path: {unknown}");

        // A token with no `state`, or the wrong one, must never reach the token handler.
        let unstamped = get(port, "/token?access_token=GOOD&token_type=Bearer");
        assert!(unstamped.contains("403"), "state-less token: {unstamped}");
        let wrong = get(port, "/token?access_token=GOOD&state=deadbeefdeadbeef");
        assert!(wrong.contains("403"), "wrong state: {wrong}");
        assert!(
            rx.try_recv().is_err(),
            "a rejected state must not end the login window"
        );

        let accepted = get(
            port,
            &format!("/token?access_token=GOOD&token_type=Bearer&state={TEST_STATE}"),
        );
        assert!(accepted.contains("Finishing sign-in"), "good token: {accepted}");
        rx.recv_timeout(Duration::from_secs(5))
            .expect("server must shut down after a state-valid token delivery");
        handle.join().unwrap();
    }

    /// A token the connect later rejects gets the same handoff page and still ends the window.
    #[test]
    fn a_rejected_token_still_ends_the_window_with_the_handoff_page() {
        let (tx, rx) = mpsc::channel();
        let (port, handle) = spawn_server("GOOD", tx);

        let rejected = get(
            port,
            &format!("/token?access_token=BAD&token_type=Bearer&state={TEST_STATE}"),
        );
        assert!(rejected.contains("200 OK"), "bad token still hands off: {rejected}");
        assert!(rejected.contains("Finishing sign-in"), "bad token: {rejected}");
        rx.recv_timeout(Duration::from_secs(5))
            .expect("server must shut down after any state-valid token delivery");
        handle.join().unwrap();
    }

    /// A request whose bytes arrive after `accept`, split across two writes, is still served.
    #[test]
    fn serves_a_request_that_arrives_late_and_split() {
        let (tx, rx) = mpsc::channel();
        let (port, handle) = spawn_server("GOOD", tx);

        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        // Longer than one poll of the accept loop, so the connection is accepted while its buffer is still empty.
        std::thread::sleep(Duration::from_millis(250));
        send(&mut s, "/callback", "GET ");
        std::thread::sleep(Duration::from_millis(50));
        send(&mut s, "/callback", "/callback HTTP/1.1\r\nHost: localhost\r\n\r\n");

        let late = read_response(&mut s, "/callback");
        assert!(late.contains("200 OK"), "late request: {late}");
        assert!(late.contains("/token?"), "bridge must hop to /token");
        assert!(rx.try_recv().is_err(), "server must still be running");

        let accepted = get(
            port,
            &format!("/token?access_token=GOOD&token_type=Bearer&state={TEST_STATE}"),
        );
        assert!(accepted.contains("Finishing sign-in"), "good token: {accepted}");
        handle.join().unwrap();
    }

    /// The `Origin` header is the cheap half of the check: the bridge page sends none, a cross-site fetch always does.
    #[test]
    fn a_request_carrying_an_origin_is_refused() {
        let (tx, _rx) = mpsc::channel();
        let (port, _handle) = spawn_server("GOOD", tx);

        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let path = format!("/token?access_token=GOOD&state={TEST_STATE}");
        send(
            &mut s,
            &path,
            &format!(
                "GET {path} HTTP/1.1\r\nHost: localhost\r\nOrigin: https://evil.example\r\n\r\n"
            ),
        );
        let response = read_response(&mut s, &path);
        assert!(response.contains("403"), "cross-origin token: {response}");
    }

    #[test]
    fn the_state_compare_rejects_mismatches_and_empties() {
        assert!(state_matches("abc123", "abc123"));
        assert!(!state_matches("abc123", "abc124"));
        assert!(!state_matches("abc123", "abc12"));
        // An empty expectation must never match, or a login that was never started would accept anything.
        assert!(!state_matches("", ""));
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

/// Fronts Karasu once the browser half is done; on mobile the system does that itself, so that arm is a real no-op.
#[cfg(desktop)]
fn surface_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(mobile)]
fn surface_main_window<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {}
