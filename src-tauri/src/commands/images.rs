use base64::Engine;
use std::time::Duration;

// Siblings in the same module tree; `mod.rs` re-exports all of it.
#[allow(unused_imports)]
use super::*;

/// The most an inlined image may weigh.
///
/// Bios routinely embed 2000px GIFs, and every byte here becomes base64 in a
/// `data:` URI — a third larger again — held in the WebView for as long as the
/// profile is open. Four megabytes covers ordinary decoration and refuses the
/// animated wallpaper.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Short on purpose. A bio can name a host that simply never answers, and the
/// user is looking at a profile, not waiting on a download.
const TIMEOUT: Duration = Duration::from_secs(8);

/// What may come back. An allowlist, not a denylist: the response is about to
/// become a `data:` URI, and `data:image/svg+xml` is a scripting context.
///
/// **SVG is deliberately absent.** It can carry `<script>`, and while the CSP
/// blocks script in an `<img>`, relying on that for something this easy to
/// exclude is a worse trade than losing the handful of SVG bios that exist.
const ALLOWED_TYPES: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
];

/// Hosts that must never be fetched on a stranger's say-so.
///
/// The URL comes from a bio written by somebody else, so without this a crafted
/// profile could make the app probe the machine it is running on or the LAN
/// behind it — the classic SSRF shape. Checked on the original URL *and* on
/// every redirect hop, since a public host can redirect to `127.0.0.1`.
///
/// **The limit, stated plainly:** this matches on the literal host, so a
/// hostname that *resolves* to a private address still gets through. Closing
/// that needs a custom DNS resolver, which is a much larger change; what is here
/// stops the direct attempt, and the payoff for the remaining case is only ever
/// an image rendered in a profile — there is no path back out to the attacker.
fn host_is_local(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
            }
            std::net::IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    // Unique-local (fc00::/7) and link-local (fe80::/10).
                    || (v6.segments()[0] & 0xfe00) == 0xfc00
                    || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
    }
    false
}

/// Whether this is a URL worth even attempting.
fn url_is_fetchable(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some_and(|h| !host_is_local(h))
}

/// Fetches a remote image and hands it back as a `data:` URI.
///
/// **Why this exists, and why it is not a CSP change.** Bio images were rendered
/// as chips because widening `img-src` was measured and rejected: across 89 real
/// bios holding 350 images, only 6 (2%) were on `*.anilist.co`, and the rest were
/// imgur, tumblr, pinimg, catbox and discord. Allowlisting that tail would hand
/// an unbounded set of third parties the user's IP and which profile they opened,
/// from a desktop app holding an OAuth token — and every one of those requests
/// would be made by the *page*, on every render, forever.
///
/// Proxying is a different trade and the maintainer took it. The CSP does not
/// move: `img-src 'self' data:` already permits the result, so the WebView still
/// never talks to imgur. What crosses the network is one bounded request made by
/// Rust, with a size cap, a content-type allowlist, a timeout, no cookies and no
/// `Referer`. The host still learns the user's IP — that is unavoidable in any
/// design that shows the image at all, and it is the part to be honest about
/// rather than the part that was fixed.
///
/// Errors are strings the frontend does not parse: it falls back to the chip on
/// any failure, which is the behaviour that shipped before this existed.
#[tauri::command]
pub async fn fetch_bio_image(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "bad url".to_string())?;
    if !url_is_fetchable(&parsed) {
        return Err("refused".into());
    }

    // Every hop re-checked, because a public URL may redirect anywhere.
    let client = reqwest::Client::builder()
        .user_agent(concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 {
                attempt.stop()
            } else if url_is_fetchable(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "client".to_string())?;

    // Never the URL and never the response: a bio is somebody else's text, and
    // `karasu.log` is a file the user may well paste into a bug report.
    let resp = client.get(parsed).send().await.map_err(|_| "unreachable".to_string())?;
    if !resp.status().is_success() {
        return Err("status".into());
    }

    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_TYPES.contains(&mime.as_str()) {
        return Err("type".into());
    }

    // Checked before reading where the server declares it, so an oversized
    // image costs one round trip rather than a download.
    if resp.content_length().is_some_and(|n| n > MAX_BYTES) {
        return Err("too large".into());
    }
    let bytes = resp.bytes().await.map_err(|_| "read".to_string())?;
    // And again after, because `Content-Length` is a claim, not a guarantee —
    // a chunked response has none at all.
    if bytes.len() as u64 > MAX_BYTES {
        return Err("too large".into());
    }

    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).expect("test url")
    }

    /// The SSRF shape. A bio is a stranger's text, so a crafted one must not be
    /// able to make the app probe the machine it runs on or the LAN behind it.
    #[test]
    fn local_and_private_hosts_are_refused() {
        for host in [
            "http://localhost/a.png",
            "http://LOCALHOST/a.png",
            "http://127.0.0.1/a.png",
            "http://127.1.2.3/a.png",
            "http://0.0.0.0/a.png",
            "http://10.0.0.5/a.png",
            "http://192.168.1.1/a.png",
            "http://172.16.4.4/a.png",
            "http://169.254.169.254/meta",
            "http://[::1]/a.png",
            "http://[fe80::1]/a.png",
            "http://[fd00::1]/a.png",
            "http://router.local/a.png",
        ] {
            assert!(!url_is_fetchable(&url(host)), "{host} must be refused");
        }
    }

    /// And the ordinary hosts a bio actually uses have to still work, or the
    /// guard has quietly disabled the feature.
    #[test]
    fn the_hosts_bios_actually_use_are_allowed() {
        for host in [
            "https://i.imgur.com/abc.png",
            "https://64.media.tumblr.com/x.gif",
            "https://i.pinimg.com/x.jpg",
            "https://files.catbox.moe/x.webp",
            "https://s4.anilist.co/file/x.jpg",
            // A public IP is fine; it is *private* ranges that are the problem.
            "http://93.184.216.34/a.png",
        ] {
            assert!(url_is_fetchable(&url(host)), "{host} must be allowed");
        }
    }

    /// `data:` would be a self-inflicted wound and `file:` reads the disk.
    #[test]
    fn only_http_is_attempted() {
        for other in [
            "file:///C:/Windows/win.ini",
            "data:image/png;base64,AAAA",
            "ftp://example.com/a.png",
        ] {
            assert!(!url_is_fetchable(&url(other)), "{other} must be refused");
        }
    }

    /// SVG is the one image type deliberately missing: it is a scripting
    /// context, and losing the few SVG bios is the cheaper side of the trade.
    #[test]
    fn svg_is_not_an_allowed_type() {
        assert!(!ALLOWED_TYPES.contains(&"image/svg+xml"));
        assert!(ALLOWED_TYPES.contains(&"image/png"));
    }
}
