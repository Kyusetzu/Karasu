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
use crate::sync::LockExt;
use crate::db::Db;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
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

/// The `state` nonce for the login attempt currently in flight.
///
/// Without one, `/token` acted on any GET that reached the port. The listener
/// is open for ten minutes while the user is in their browser, and
/// `http://127.0.0.1` counts as a potentially-trustworthy origin, so any page
/// open in that browser — an ad iframe in a background tab is enough — could
/// issue `new Image().src = "http://127.0.0.1:46231/token?access_token=…"` and
/// hand Karasu *its* AniList token. It validates, so it gets saved, and from
/// then on every scrobble and list edit the victim makes is written to the
/// attacker's account while the victim's screen shows the attacker's list.
/// Textbook login CSRF; the nonce is what closes it.
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

/// Starts the callback server (if not already running) and returns once the
/// listener is bound. The actual token handling happens on a background
/// thread; the UI is notified through the `anilist-auth` /
/// `anilist-auth-error` events.
/// Returns the `state` nonce the authorize URL must carry.
pub fn start<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    if ACTIVE.swap(true, Ordering::SeqCst) {
        // A previous login attempt is still waiting — reuse its listener, and
        // its nonce, since that is what the running server will check against.
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
            let db = app.state::<Db>();
            let api = app.state::<AniList>();
            match tauri::async_runtime::block_on(crate::commands::connect_with_token(
                &db, &api, token,
            )) {
                Ok(viewer) => {
                    let _ = app.emit("anilist-auth", &viewer);
                    surface_main_window(&app);
                    Ok(())
                }
                Err(e) => {
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
    // The listener is non-blocking so the accept loop can time out, and on
    // Windows the accepted socket inherits that flag — which would make the
    // read below fail with `WouldBlock` (and silently drop the request)
    // whenever the browser's bytes have not landed by the time `accept`
    // returned. Put this socket back into blocking mode so the read timeout
    // actually applies and a partial write cannot be lost either.
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
        // The bridge page is same-origin and sends no `Origin`; a cross-site
        // fetch always does. Cheap to check and it costs a legitimate login
        // nothing — but it is only the second line, because a plain
        // `new Image().src` sends no Origin either. The nonce below is what
        // actually holds.
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
            Some(token) if !token.is_empty() => match on_token(token) {
                Ok(()) => {
                    respond(&mut stream, 200, &success_page());
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

/// Reads the request head, i.e. everything up to the blank line that ends the
/// headers. One `read` is not enough: TCP gives no framing guarantees, so the
/// first segment can carry as little as `GET ` — parsing that alone yields no
/// path at all and would answer a valid `/callback` with a 404.
///
/// Returns `None` if nothing was received, so the caller can drop the
/// connection.
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
    // Half-close so the peer sees a clean end-of-response (we announced
    // `Connection: close`) instead of inferring it from the socket being
    // dropped, which can surface as a reset mid-read.
    let _ = stream.shutdown(Shutdown::Write);
}

/// The landing page a finished login shows — a cfg'd pair, per the house
/// rule, because the two platforms owe the reader different things.
///
/// On desktop the app is already frontmost and the browser tab was the
/// detour, so the page only has to say it is over.
#[cfg(not(target_os = "android"))]
fn success_page() -> String {
    page(
        "You're logged in",
        "Karasu is now connected to your AniList account. You can close this tab.",
    )
}

/// On Android the browser is now the foreground app and has no way to yield
/// by itself, so the page carries the hop back: a `karasu://login` link — the
/// custom scheme the deep-link plugin registers from `tauri.conf.json`, which
/// re-enters the running `singleTask` activity — plus an automatic attempt.
/// The attempt is best-effort (Chrome may demand a user gesture for scheme
/// navigation); the button is the load-bearing half. The message string is
/// trusted HTML into `page`'s `<p>`, like every other call site's.
#[cfg(target_os = "android")]
fn success_page() -> String {
    page(
        "You're logged in",
        "Karasu is now connected to your AniList account.</p>\
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

    /// Spins up the server on an OS-assigned port with a scripted token
    /// handler and returns (port, join handle).
    /// The nonce the tests hand to `/token`. Every test uses the same one, so
    /// the shared `PENDING_STATE` is safe to set from each of them.
    const TEST_STATE: &str = "0123456789abcdef";

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

    /// Sends one request and reads the response until the server closes.
    ///
    /// Every failure mode here is loud on purpose: a discarded read error or a
    /// truncated body would come back as an empty string and fail whichever
    /// content assertion ran next with a message that says nothing about the
    /// actual cause.
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

    /// Reads to end-of-stream and checks the response arrived whole, so a
    /// short read fails as a short read rather than as a missing status line.
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

        // A token with no `state`, or the wrong one, is what a page on some
        // other site can produce. It must never reach the token handler.
        let unstamped = get(port, "/token?access_token=GOOD&token_type=Bearer");
        assert!(unstamped.contains("403"), "state-less token: {unstamped}");
        let wrong = get(port, "/token?access_token=GOOD&state=deadbeefdeadbeef");
        assert!(wrong.contains("403"), "wrong state: {wrong}");
        assert!(
            rx.try_recv().is_err(),
            "a rejected state must not end the login window"
        );

        let rejected = get(
            port,
            &format!("/token?access_token=BAD&token_type=Bearer&state={TEST_STATE}"),
        );
        assert!(rejected.contains("Login failed"), "bad token: {rejected}");
        assert!(
            rx.try_recv().is_err(),
            "server must keep running after a rejected token"
        );

        let accepted = get(
            port,
            &format!("/token?access_token=GOOD&token_type=Bearer&state={TEST_STATE}"),
        );
        assert!(accepted.contains("logged in"), "good token: {accepted}");
        rx.recv_timeout(Duration::from_secs(5))
            .expect("server must shut down after a successful login");
        handle.join().unwrap();
    }

    /// Pins the two timing assumptions the server must not make, both of which
    /// a browser can violate and neither of which `full_callback_flow` exercises
    /// reliably — it just happens to lose the race about once in twenty runs.
    ///
    /// 1. The accept loop polls a non-blocking listener, and on Windows the
    ///    accepted socket inherits that flag, so a request whose bytes arrive
    ///    after `accept` returned used to fail the read with `WouldBlock` and be
    ///    dropped without any response.
    /// 2. TCP does not preserve write boundaries, so the first `read` can return
    ///    a fragment too short to contain the path.
    ///
    /// Connecting before sending, and splitting the request line, makes both
    /// orderings certain rather than a race.
    #[test]
    fn serves_a_request_that_arrives_late_and_split() {
        let (tx, rx) = mpsc::channel();
        let (port, handle) = spawn_server("GOOD", tx);

        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        // Longer than one poll of the accept loop, so the server has certainly
        // accepted this connection while its receive buffer is still empty.
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
        assert!(accepted.contains("logged in"), "good token: {accepted}");
        handle.join().unwrap();
    }

    /// The `Origin` header is the cheap half of the check: the bridge page is
    /// same-origin and sends none, a cross-site fetch always does.
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
        // An empty expectation must never match, or a login that was never
        // started would accept anything.
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

/// Brings Karasu back to the front once the browser half of the sign-in is
/// done. `unminimize` does not exist on a mobile `WebviewWindow`, and the
/// system brings the app forward itself when the callback URL resolves — so
/// the mobile arm is a real no-op rather than a stub.
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
