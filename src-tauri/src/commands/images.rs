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

/// How many bytes the format is decided on. Every signature below sits well
/// inside 64; the AVIF brand list is the one that reaches furthest.
const SNIFF_BYTES: usize = 64;

/// What the bytes say the image is — and nothing else is asked.
///
/// The declared `Content-Type` is not consulted at all. Hosts answer with
/// `application/octet-stream`, with no header, and with `image/png` for a
/// JPEG, and an allowlist over the header refused the first two and trusted
/// the third; the bytes cannot be wrong about themselves. The result is an
/// allowlist all the same, and `None` is the answer for everything not on it:
/// the response is about to become a `data:` URI, and `data:image/svg+xml`
/// is a scripting context.
///
/// **SVG is deliberately absent.** It can carry `<script>`, and while the CSP
/// blocks script in an `<img>`, relying on that for something this easy to
/// exclude is a worse trade than losing the handful of SVG bios that exist.
/// An SVG or an HTML error page sniffs as nothing, and nothing is what the
/// caller gets.
///
/// ICO is on the list because favicon services are how a bio links its
/// author's other accounts — `img16(https://a.favicon.im/steamcommunity.com)`
/// inside an `<a>`, sampled 2026-09-10, answered `image/x-icon` with bytes
/// that agreed, while the same service gave PNG for discord.com. A raster
/// container the WebView decodes like any other, with no scripting surface;
/// a cursor (type 2) is not an image and stays out.
fn sniff_image(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if head.len() >= 12 && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    // ISO-BMFF: a size, `ftyp`, the major brand, a minor version, then the
    // compatible brands. AVIF may carry `mif1` as its major brand and `avif`
    // only among the compatibles, so the whole list is read.
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        let avif = head[8..]
            .chunks_exact(4)
            .take((SNIFF_BYTES - 8) / 4)
            .any(|brand| brand == b"avif" || brand == b"avis");
        if avif {
            return Some("image/avif");
        }
    }
    // ICO: a zero reserved word, type 1 (2 is a cursor), then a non-zero
    // image count.
    if head.len() >= 6 && head[..4] == [0, 0, 1, 0] && head[4..6] != [0, 0] {
        return Some("image/x-icon");
    }
    None
}

/// Appends `chunk` to `buf` unless the result would pass `cap`.
///
/// Refuses *before* growing: a hostile host — any host an arbitrary bio can
/// name — must not get the app to allocate a chunk past the cap and only then
/// notice.
fn push_capped(buf: &mut Vec<u8>, chunk: &[u8], cap: u64) -> Result<(), &'static str> {
    if buf.len() as u64 + chunk.len() as u64 > cap {
        return Err("too large");
    }
    buf.extend_from_slice(chunk);
    Ok(())
}

/// Hosts that must never be fetched on a stranger's say-so.
///
/// The URL comes from a bio written by somebody else, so without this a crafted
/// profile could make the app probe the machine it is running on or the LAN
/// behind it — the classic SSRF shape. Checked on the original URL *and* on
/// The SSRF guard and the scheme check both live in `net`, beside the client
/// seam every outbound request is built from — they are questions about the
/// URLs those clients are handed, and keeping them here meant they were
/// answered by string comparison that three spellings of loopback walked
/// through.
use crate::net::is_public_http_url as url_is_fetchable;

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
    //
    // `Accept` names the formats the sniff below will take, which is what a
    // host that negotiates (imgur, the CDNs) needs to hand over an image
    // rather than a page about one. `referer(false)` is what makes "no
    // Referer" true on *every* hop: reqwest's default sets one on redirects,
    // so the promise in SECURITY.md only held for the first request.
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static(
            "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.1",
        ),
    );
    let client = crate::net::client_builder()
        .user_agent(concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .default_headers(headers)
        .referer(false)
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

    // Checked before reading where the server declares it, so an oversized
    // image costs one round trip rather than a download.
    if resp.content_length().is_some_and(|n| n > MAX_BYTES) {
        return Err("too large".into());
    }
    // Then enforced *while* reading, because `Content-Length` is a claim rather
    // than a guarantee and a chunked response makes none at all. Buffering the
    // whole body first and measuring afterwards meant a hostile host — any host
    // an arbitrary bio can name — could make the app allocate as much memory as
    // it cared to send before the cap was ever consulted.
    //
    // The format is decided from the first bytes as soon as there are enough
    // of them, so an HTML page four megabytes long is refused after one
    // chunk rather than after the download. See `sniff_image` for why the
    // declared type is never read.
    let mut bytes: Vec<u8> = Vec::new();
    let mut resp = resp;
    let mut mime: Option<&'static str> = None;
    while let Some(chunk) = resp.chunk().await.map_err(|_| "read".to_string())? {
        push_capped(&mut bytes, &chunk, MAX_BYTES).map_err(str::to_string)?;
        if mime.is_none() && bytes.len() >= SNIFF_BYTES {
            mime = Some(sniff_image(&bytes).ok_or_else(|| "type".to_string())?);
        }
    }
    let mime = match mime {
        Some(m) => m,
        // Shorter than the sniff window, which a tiny icon can be.
        None => sniff_image(&bytes).ok_or_else(|| "type".to_string())?,
    };

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

    /// Each format by its signature — the declared type is never consulted,
    /// so this is the whole of the allowlist.
    #[test]
    fn every_allowed_format_is_recognised_by_its_bytes() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
        assert_eq!(sniff_image(&png), Some("image/png"));
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]), Some("image/jpeg"));
        assert_eq!(sniff_image(b"GIF89a\x01\x00"), Some("image/gif"));
        assert_eq!(sniff_image(b"GIF87a\x01\x00"), Some("image/gif"));
        assert_eq!(sniff_image(b"RIFF\x24\x00\x00\x00WEBPVP8 "), Some("image/webp"));
        // Major brand `avif`.
        assert_eq!(sniff_image(b"\x00\x00\x00\x1cftypavif\x00\x00\x00\x00mif1"), Some("image/avif"));
        // Major brand `mif1`, `avif` only among the compatible brands.
        assert_eq!(
            sniff_image(b"\x00\x00\x00\x20ftypmif1\x00\x00\x00\x00mif1avifmiaf"),
            Some("image/avif")
        );
        assert_eq!(sniff_image(b"\x00\x00\x00\x1cftypavis\x00\x00\x00\x00"), Some("image/avif"));
        // ICO as a favicon service answers it: reserved 0, type 1, one entry.
        assert_eq!(
            sniff_image(b"\x00\x00\x01\x00\x01\x00\x10\x10\x00\x00\x01\x00\x20\x00"),
            Some("image/x-icon")
        );
    }

    /// SVG is the one image type deliberately missing: it is a scripting
    /// context, and losing the few SVG bios is the cheaper side of the trade.
    /// An HTML page — the usual body behind a hotlink refusal — is nothing
    /// either, whatever its header said.
    #[test]
    fn svg_html_and_near_misses_sniff_as_nothing() {
        for body in [
            &b""[..],
            b"\xFF\xD8",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>1</script></svg>",
            b"<?xml version=\"1.0\"?><svg/>",
            b"<!DOCTYPE html><html><body>403</body></html>",
            // RIFF without the WEBP form type is a WAV or an AVI.
            b"RIFF\x24\x00\x00\x00WAVEfmt ",
            // A cursor shares ICO's header with type 2; an ICO with no
            // entries is a header and nothing to draw.
            b"\x00\x00\x02\x00\x01\x00\x10\x10",
            b"\x00\x00\x01\x00\x00\x00\x10\x10",
            // An ISO-BMFF that is not an AVIF: HEIC, or plain mif1.
            b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic",
            b"\x00\x00\x00\x14ftypmif1\x00\x00\x00\x00mif1",
        ] {
            assert_eq!(sniff_image(body), None, "{:?}", String::from_utf8_lossy(body));
        }
    }

    /// The cap refuses before it grows the buffer, and exactly-at-cap is fine.
    #[test]
    fn the_size_cap_refuses_before_allocating() {
        let mut buf = vec![0u8; 3];
        assert!(push_capped(&mut buf, &[1, 2, 3], 8).is_ok());
        assert_eq!(buf.len(), 6);
        assert!(push_capped(&mut buf, &[4, 5], 8).is_ok(), "exactly at the cap is allowed");
        assert_eq!(buf.len(), 8);
        assert_eq!(push_capped(&mut buf, &[6], 8), Err("too large"));
        assert_eq!(buf.len(), 8, "a refused chunk must not have been appended");
    }

    /// The reason the declared type is ignored: a body that is not what its
    /// header claims is judged by the body.
    #[test]
    fn a_body_that_is_not_an_image_is_refused_whatever_it_was_declared_as() {
        // "image/png" on the wire, HTML in the body — sniffed, refused.
        assert_eq!(sniff_image(b"<html><body>hotlink denied</body></html>"), None);
        // "application/octet-stream" on the wire, a real PNG in the body — accepted.
        assert_eq!(
            sniff_image(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            Some("image/png")
        );
    }
}
