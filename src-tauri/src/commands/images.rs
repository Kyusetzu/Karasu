use base64::Engine;
use std::time::Duration;

// Siblings in the same module tree; `mod.rs` re-exports all of it.
#[allow(unused_imports)]
use super::*;

/// The most an inlined image may weigh; it covers ordinary decoration and refuses the animated wallpaper.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Short on purpose: a bio can name a host that never answers, and the user is reading a profile.
const TIMEOUT: Duration = Duration::from_secs(8);

/// How many bytes the format is decided on; the AVIF brand list is the signature that reaches furthest.
const SNIFF_BYTES: usize = 64;

/// The image format the bytes declare, ignoring `Content-Type`; never SVG here, because it is a scripting context.
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
    // ISO-BMFF: AVIF may carry `mif1` as its major brand and `avif` only among the compatibles, so read them all.
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        let avif = head[8..]
            .chunks_exact(4)
            .take((SNIFF_BYTES - 8) / 4)
            .any(|brand| brand == b"avif" || brand == b"avis");
        if avif {
            return Some("image/avif");
        }
    }
    // ICO: a zero reserved word, type 1 (2 is a cursor), then a non-zero image count.
    if head.len() >= 6 && head[..4] == [0, 0, 1, 0] && head[4..6] != [0, 0] {
        return Some("image/x-icon");
    }
    None
}

/// Appends `chunk` to `buf` unless the result would pass `cap`, refusing before it grows rather than after.
fn push_capped(buf: &mut Vec<u8>, chunk: &[u8], cap: u64) -> Result<(), &'static str> {
    if buf.len() as u64 + chunk.len() as u64 > cap {
        return Err("too large");
    }
    buf.extend_from_slice(chunk);
    Ok(())
}

// The SSRF guard lives in `net`, beside the client seam, and parses the host rather than comparing spellings.
use crate::net::is_public_http_url as url_is_fetchable;

/// Fetches a bio image as one bounded Rust request and returns a `data:` URI; never widen `img-src` instead.
#[tauri::command]
#[specta::specta]
pub async fn fetch_bio_image(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "bad url".to_string())?;
    if !url_is_fetchable(&parsed) {
        return Err("refused".into());
    }

    // Every hop is re-checked, and `referer(false)` keeps "no Referer" true on redirects, where reqwest would set one.
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

    // Never log the URL or the response: a bio is somebody else's text and the log ends up in bug reports.
    let resp = client.get(parsed).send().await.map_err(|_| "unreachable".to_string())?;
    if !resp.status().is_success() {
        return Err("status".into());
    }

    // Checked before reading where the server declares it, so an oversized image costs one round trip.
    if resp.content_length().is_some_and(|n| n > MAX_BYTES) {
        return Err("too large".into());
    }
    // Enforced while reading too, since `Content-Length` is a claim, and the format is sniffed as soon as it can be.
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

    /// A crafted bio cannot make the app probe the machine it runs on or the LAN behind it.
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

    /// The ordinary hosts a bio uses still pass the guard.
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

    /// Every allowed format is recognised by its bytes, which is the whole of the allowlist.
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

    /// SVG, HTML and near-miss containers sniff as nothing.
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
            // A cursor shares ICO's header with type 2; an ICO with no entries has nothing to draw.
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

    /// A body is judged by its bytes, whatever the header claimed.
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
