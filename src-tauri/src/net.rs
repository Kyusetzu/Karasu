//! Where every outbound HTTP client is born.
//!
//! One seam instead of four call sites building their own, because Android
//! needs a different TLS answer and a fix applied to three of four builders
//! is the kind of bug that only fails on the platform nobody is holding.
//!
//! **Why Android is special, measured on the first device.** reqwest 0.13
//! defaults to rustls with `rustls-platform-verifier`, whose Android backend
//! calls into the JVM — and requires an explicit init handed a JNI `Env` and
//! the app `Context`, *plus* a Kotlin helper component added to the Gradle
//! build. Nothing does that init, so every request died with
//! `panic: Expect rustls-platform-verifier to be initialized`
//! (rustls-platform-verifier-0.7.0/src/android.rs:90, verbatim from the
//! device's karasu.log). Wiring the init properly means a Gradle dependency
//! inside the *generated* `gen/android` tree — which `tauri android init`
//! regenerates at will — so the deterministic fix is chosen instead: a
//! preconfigured rustls config with webpki's baked Mozilla roots, Android
//! only.
//!
//! What that trades away, stated: user-installed CAs are not honoured on
//! Android, so a corporate MITM proxy or a self-signed Jellyfin certificate
//! that works on the desktop (whose platform verifier reads the OS store)
//! will not verify on the phone. Karasu talks to graphql.anilist.co, GitHub
//! and the user's Jellyfin — for the first two the public roots are exactly
//! right; a self-signed Jellyfin needs plain HTTP on Android until this
//! carries a user-supplied trust option.
//!
//! The rustls version here must stay in lockstep with reqwest's own —
//! `use_preconfigured_tls` downcasts the config against reqwest's rustls, and
//! a version skew fails at runtime as "unknown TLS backend", not at compile.

#[cfg(not(target_os = "android"))]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
}

#[cfg(target_os = "android")]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().use_preconfigured_tls(android_tls_config())
}

#[cfg(target_os = "android")]
fn android_tls_config() -> rustls::ClientConfig {
    // The provider is named, never defaulted: `ClientConfig::builder()` asks
    // rustls for a process-level default, and with more than one provider in
    // the crate graph rustls refuses to guess — with a *panic*, at line 249
    // of its crypto module, which on the first device build aborted the app
    // during setup before a window ever existed. aws-lc-rs is the provider
    // reqwest's own rustls already compiles in, so this adds nothing new.
    let provider = std::sync::Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs supports the default TLS protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    // ALPN is the caller's job on this path. reqwest's own rustls arm
    // advertises h2 + http/1.1 itself, but `use_preconfigured_tls` forwards
    // this config verbatim — and rustls defaults to offering *nothing*, so
    // the server could never pick h2 and every Android request ran HTTP/1.1:
    // one TCP+TLS handshake per concurrent request over the phone's radio
    // where the desktop multiplexes them all onto one connection. The offer
    // is a preference list, not a demand — an http/1.1-only server still
    // negotiates http/1.1, and plain-HTTP Jellyfin never touches TLS at all.
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config
}

// --- URL validation ---------------------------------------------------------
//
// Beside the client seam because these two questions are asked *about* the
// URLs those clients are handed, and they were previously answered by string
// comparison inside one command — where three spellings of "localhost" walked
// straight through.

/// Whether a host names this machine or the network it sits on.
///
/// Decided by **parsing**, not by spelling. The version this replaces matched
/// literal text, so `::ffff:127.0.0.1` (loopback written as an IPv4-mapped
/// IPv6 address, which `is_loopback` answers `false` for) and `localhost.`
/// (a fully qualified name, trailing dot and all, which resolvers accept)
/// both passed a guard whose whole purpose was to stop them.
///
/// **The limit, stated plainly:** this still matches on the literal host, so a
/// hostname that *resolves* to a private address gets through. Closing that
/// needs a custom DNS resolver, which is a much larger change.
pub fn host_is_local(host: &str) -> bool {
    let h = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") {
        return true;
    }
    let Ok(ip) = h.parse::<std::net::IpAddr>() else {
        return false;
    };
    // Unwrap an IPv4 address wearing an IPv6 costume, so every range rule below
    // is written once — but only after IPv6's own rules have had their say.
    //
    // `to_ipv4` is deliberately not used here: it also converts IPv4-*compatible*
    // addresses, and `::1` is one of those, so loopback would come out as
    // `0.0.0.1` and pass every test. `to_ipv4_mapped` converts only the
    // `::ffff:0:0/96` form, which is the one that actually turns up.
    let ip = match ip {
        std::net::IpAddr::V6(v6) => {
            if v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
            {
                return true;
            }
            match v6.to_ipv4_mapped() {
                Some(v4) => std::net::IpAddr::V4(v4),
                None => std::net::IpAddr::V6(v6),
            }
        }
        v4 => v4,
    };
    match ip {
        std::net::IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // Carrier-grade NAT (100.64/10) and the benchmarking range
                // (198.18/15): neither is public, and both are routable inside
                // the networks that use them.
                || (a == 100 && (64..128).contains(&b))
                || (a == 198 && (18..20).contains(&b))
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // Unique-local (fc00::/7) and link-local (fe80::/10).
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// Whether this is a URL worth fetching from the public internet.
pub fn is_public_http_url(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|h| !host_is_local(h))
}

/// Whether this is usable as the base of a server the *user* chose.
///
/// Deliberately permissive about private addresses — a Jellyfin server on the
/// LAN is the normal case, and refusing it would break the feature. What it
/// refuses is a URL that is not HTTP at all, or carries no host: those are not
/// a server the user misconfigured, they are somewhere a stored access token
/// must never be sent.
pub fn is_usable_base_url(raw: &str) -> bool {
    reqwest::Url::parse(raw)
        .is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each of these reached the guard as a spelling it did not know.
    #[test]
    fn loopback_in_every_costume_is_local() {
        for host in [
            "127.0.0.1",
            "localhost",
            "localhost.",
            "LOCALHOST",
            "[::1]",
            "::1",
            // IPv4-mapped and IPv4-compatible IPv6: `is_loopback` says false.
            "::ffff:127.0.0.1",
            "[::ffff:127.0.0.1]",
            "::ffff:7f00:1",
            "0.0.0.0",
            "printer.local",
            "printer.local.",
        ] {
            assert!(host_is_local(host), "{host} should be refused");
        }
    }

    #[test]
    fn private_ranges_are_local() {
        for host in [
            "10.0.0.5",
            "172.16.3.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "fc00::1",
            "fe80::1",
            "::ffff:192.168.1.1",
        ] {
            assert!(host_is_local(host), "{host} should be refused");
        }
    }

    #[test]
    fn ordinary_public_hosts_are_not() {
        for host in [
            "example.com",
            "i.imgur.com",
            "8.8.8.8",
            "2606:4700::1111",
            "100.128.0.1",
            "198.20.0.1",
            "172.32.0.1",
        ] {
            assert!(!host_is_local(host), "{host} should be allowed");
        }
    }

    #[test]
    fn only_http_urls_are_fetchable() {
        for raw in ["file:///etc/passwd", "data:text/html,x", "ftp://example.com/x"] {
            let url = reqwest::Url::parse(raw).expect("parses");
            assert!(!is_public_http_url(&url), "{raw} should be refused");
        }
        assert!(is_public_http_url(
            &reqwest::Url::parse("https://example.com/a.png").unwrap()
        ));
    }

    /// A user's own server may be on the LAN — that is the normal case — but
    /// it still has to be somewhere a token can be sent.
    #[test]
    fn a_base_url_may_be_private_but_must_be_http() {
        assert!(is_usable_base_url("http://192.168.1.50:8096"));
        assert!(is_usable_base_url("https://jellyfin.example.com"));
        assert!(!is_usable_base_url("file:///etc"));
        assert!(!is_usable_base_url("not a url"));
        assert!(!is_usable_base_url(""));
        assert!(!is_usable_base_url("https://"));
    }
}
