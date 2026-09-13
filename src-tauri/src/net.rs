//! Where every outbound HTTP client is born, one seam so a TLS fix cannot miss a builder.

#[cfg(not(target_os = "android"))]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
}

/// User-installed CAs are not honoured on Android; a self-signed Jellyfin needs plain HTTP there.
#[cfg(target_os = "android")]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().use_preconfigured_tls(android_tls_config())
}

/// Webpki roots in a preconfigured rustls config; rustls must stay in lockstep with reqwest's own or it fails at runtime.
#[cfg(target_os = "android")]
fn android_tls_config() -> rustls::ClientConfig {
    // A named aws-lc-rs provider on Android; the default-provider lookup panics with two providers in the graph.
    let provider = std::sync::Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs supports the default TLS protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    // ALPN is the caller's job here: rustls offers nothing by default, and then every Android request ran HTTP/1.1.
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config
}

// URL validation sits beside the client seam because these questions are asked about the URLs those clients are handed.

/// Whether a host names this machine or its network, decided by parsing rather than by spelling.
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
    // Unwrap an IPv4-mapped address, never through `to_ipv4`, which also turns `::1` into `0.0.0.1` and passes every test.
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
                // Carrier-grade NAT and the benchmarking range: neither is public, both are routable where they are used.
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

/// Whether this is usable as the base of a server the user chose; private is fine, a non-HTTP or hostless URL is not.
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

    /// A user's own server may be on the LAN, but it still has to be somewhere a token can be sent.
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
