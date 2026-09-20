//! Finds a Jellyfin server on the LAN by UDP broadcast and confirms it through `/System/Info/Public`.

use std::net::SocketAddr;
use std::time::Duration;

use super::jellyfin::{http, normalize_base_url, str_field, ERR_BAD_URL, ERR_NOT_JELLYFIN};

pub const DISCOVERY_PORT: u16 = 7359;
pub const DISCOVERY_MESSAGE: &[u8] = b"who is JellyfinServer?";
/// How long replies are collected for; a server on the segment answers within milliseconds.
pub const LISTEN_FOR: Duration = Duration::from_secs(2);
/// How many discovered addresses are confirmed with a probe; a reply storm is not worth chasing.
const MAX_PROBES: usize = 8;
/// Receive errors tolerated early: Windows surfaces any host's ICMP port-unreachable as a `recv_from` error here.
const MAX_RECV_ERRORS: u8 = 8;

/// A server that answered the broadcast, confirmed by its own info endpoint.
#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    pub name: String,
    pub address: String,
    pub id: String,
    /// From the probe; `None` for a reply that was never confirmed.
    pub version: Option<String>,
}

/// `/System/Info/Public`, the parts the app uses.
#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub name: String,
    pub id: String,
    pub version: String,
}

/// One UDP reply, or `None` for a stray datagram, a reply without an address, or one the app would refuse anyway.
pub fn parse_discovery_reply(bytes: &[u8]) -> Option<DiscoveredServer> {
    let body: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let address = normalize_base_url(&str_field(&body, "Address"));
    if !crate::net::is_usable_base_url(&address) {
        return None;
    }
    Some(DiscoveredServer {
        name: str_field(&body, "Name"),
        address,
        id: str_field(&body, "Id"),
        version: None,
    })
}

/// Reads `/System/Info/Public`; without an `Id` the body is not a Jellyfin answer, while a missing name is cosmetic.
pub fn parse_public_info(body: &serde_json::Value) -> Option<ServerInfo> {
    let id = str_field(body, "Id");
    if id.is_empty() {
        return None;
    }
    Some(ServerInfo {
        name: str_field(body, "ServerName"),
        id,
        version: str_field(body, "Version"),
    })
}

/// One row per server with the first address kept, sorted by name so the list is stable between two presses.
pub fn merge_replies(replies: Vec<DiscoveredServer>) -> Vec<DiscoveredServer> {
    let mut out: Vec<DiscoveredServer> = Vec::new();
    for reply in replies {
        let seen = out.iter().any(|s| {
            s.address == reply.address || (!reply.id.is_empty() && s.id == reply.id)
        });
        if !seen {
            out.push(reply);
        }
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.address.cmp(&b.address))
    });
    out
}

/// The address the default route leaves through, read off a UDP connect that sends nothing; `None` with no route.
fn primary_local_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.connect(("192.0.2.1", DISCOVERY_PORT)).ok()?;
    socket.local_addr().ok().map(|a| a.ip())
}

/// Broadcasts from the default route's address too; a wildcard socket picks one interface and may pick the virtual switch.
pub async fn broadcast(
    target: SocketAddr,
    listen_for: Duration,
) -> Result<Vec<DiscoveredServer>, String> {
    let mut binds: Vec<std::net::IpAddr> = vec![std::net::Ipv4Addr::UNSPECIFIED.into()];
    if let Some(ip) = primary_local_ip().filter(|ip| ip.is_ipv4() && !ip.is_unspecified()) {
        binds.insert(0, ip);
    }
    let tasks: Vec<_> = binds
        .into_iter()
        .map(|bind| tokio::spawn(collect_from(bind, target, listen_for)))
        .collect();
    let mut found = Vec::new();
    let mut sent = 0usize;
    let mut last_error = String::new();
    for task in tasks {
        match task.await {
            Ok(Ok(list)) => {
                sent += 1;
                found.extend(list);
            }
            Ok(Err(e)) => last_error = e,
            Err(e) => last_error = format!("discovery task failed: {e}"),
        }
    }
    // One socket that could send is enough; only when none could is the search a failure rather than empty.
    if sent == 0 {
        return Err(last_error);
    }
    Ok(found)
}

/// One socket's share of `broadcast`.
async fn collect_from(
    bind: std::net::IpAddr,
    target: SocketAddr,
    listen_for: Duration,
) -> Result<Vec<DiscoveredServer>, String> {
    let socket = tokio::net::UdpSocket::bind((bind, 0))
        .await
        .map_err(|e| format!("Could not open a socket on {bind}: {e}"))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Could not enable broadcast: {e}"))?;
    socket
        .send_to(DISCOVERY_MESSAGE, target)
        .await
        .map_err(|e| format!("Could not send the discovery message from {bind}: {e}"))?;

    let deadline = tokio::time::Instant::now() + listen_for;
    let mut buf = [0u8; 4096];
    let mut found = Vec::new();
    let mut errors = 0u8;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, socket.recv_from(&mut buf)).await {
            Ok(Ok((n, _))) => {
                if let Some(server) = parse_discovery_reply(&buf[..n]) {
                    found.push(server);
                }
            }
            Ok(Err(e)) => {
                errors += 1;
                crate::logging::debug("jellyfin", format!("discovery receive failed: {e}"));
                if errors >= MAX_RECV_ERRORS {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    Ok(found)
}

/// Asks a server what it is, anonymously; runs on a button press and on sign-in, never inside the poll loop.
pub async fn probe(base: &str) -> Result<ServerInfo, String> {
    let base = normalize_base_url(base);
    if !crate::net::is_usable_base_url(&base) {
        return Err(ERR_BAD_URL.into());
    }
    let resp = http()
        .get(format!("{base}/System/Info/Public"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| ERR_NOT_JELLYFIN.to_string())?;
    parse_public_info(&body).ok_or_else(|| ERR_NOT_JELLYFIN.to_string())
}

/// Broadcast, merge, confirm: a reply whose address fails the probe is dropped, and the probe's name and version win.
pub async fn discover() -> Result<Vec<DiscoveredServer>, String> {
    let target = SocketAddr::from(([255, 255, 255, 255], DISCOVERY_PORT));
    let replies = merge_replies(broadcast(target, LISTEN_FOR).await?);
    let mut confirmed = Vec::new();
    for reply in replies.into_iter().take(MAX_PROBES) {
        match probe(&reply.address).await {
            Ok(info) => confirmed.push(DiscoveredServer {
                name: if info.name.is_empty() { reply.name } else { info.name },
                address: reply.address,
                id: if info.id.is_empty() { reply.id } else { info.id },
                version: Some(info.version).filter(|v| !v.is_empty()),
            }),
            Err(e) => crate::logging::debug(
                "jellyfin",
                format!("discovered {} but it did not answer the probe: {e}", reply.address),
            ),
        }
    }
    Ok(confirmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_discovery_reply_is_parsed_and_junk_is_not() {
        let reply =
            br#"{"Address":"http://192.168.1.10:8096","Id":"abc123","Name":"NAS","EndpointAddress":null}"#;
        let s = parse_discovery_reply(reply).unwrap();
        assert_eq!(s.address, "http://192.168.1.10:8096");
        assert_eq!(s.id, "abc123");
        assert_eq!(s.name, "NAS");
        assert_eq!(s.version, None);
        // A trailing slash is trimmed like a typed URL, and camelCase is accepted like every other Jellyfin field.
        assert_eq!(
            parse_discovery_reply(br#"{"address":"http://nas:8096/","id":"x","name":"n"}"#)
                .unwrap()
                .address,
            "http://nas:8096"
        );
        for junk in [&b""[..], b"who is JellyfinServer?", b"not json", b"[]", b"{}"] {
            assert!(
                parse_discovery_reply(junk).is_none(),
                "{:?}",
                String::from_utf8_lossy(junk)
            );
        }
    }

    /// Anything the URL field would refuse is refused here, since the address is about to be typed into it.
    #[test]
    fn a_reply_with_an_unusable_address_is_dropped() {
        for address in ["ftp://nas", "", "javascript:alert(1)", "nas:8096"] {
            let bytes = format!(r#"{{"Address":"{address}","Id":"x","Name":"n"}}"#);
            assert!(parse_discovery_reply(bytes.as_bytes()).is_none(), "{address}");
        }
    }

    #[test]
    fn public_info_reads_pascal_and_camel_case() {
        let info = parse_public_info(&json!({
            "ServerName": "NAS", "Version": "10.10.7", "Id": "abc", "LocalAddress": "http://x"
        }))
        .unwrap();
        assert_eq!(
            info,
            ServerInfo { name: "NAS".into(), id: "abc".into(), version: "10.10.7".into() }
        );
        assert_eq!(
            parse_public_info(&json!({ "serverName": "n", "id": "i", "version": "v" }))
                .unwrap()
                .id,
            "i"
        );
        assert!(
            parse_public_info(&json!({ "ServerName": "nameless" })).is_none(),
            "the id is what makes an answer usable"
        );
    }

    #[test]
    fn replies_are_deduped_by_server_id_and_sorted_by_name() {
        let r = |name: &str, addr: &str, id: &str| DiscoveredServer {
            name: name.into(),
            address: addr.into(),
            id: id.into(),
            version: None,
        };
        let merged = merge_replies(vec![
            r("Zeta", "http://z:8096", "z"),
            r("alpha", "http://a:8096", "a"),
            r("alpha again", "http://a2:8096", "a"),
            r("Zeta", "http://z:8096", "z"),
        ]);
        let addresses: Vec<&str> = merged.iter().map(|s| s.address.as_str()).collect();
        assert_eq!(addresses, ["http://a:8096", "http://z:8096"]);
        // Without ids the address is the identity.
        let merged = merge_replies(vec![
            r("x", "http://a", ""),
            r("x", "http://a", ""),
            r("y", "http://b", ""),
        ]);
        assert_eq!(merged.len(), 2);
    }

    /// A loopback responder stands in for a server, and `broadcast` collects its reply without waiting the budget out.
    #[tokio::test]
    async fn a_loopback_responder_is_discovered() {
        let responder = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = responder.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buf = [0u8; 256];
            if let Ok((n, from)) = responder.recv_from(&mut buf).await {
                if &buf[..n] == DISCOVERY_MESSAGE {
                    let _ = responder
                        .send_to(
                            br#"{"Address":"http://127.0.0.1:8096","Id":"loop","Name":"Loopback"}"#,
                            from,
                        )
                        .await;
                }
            }
        });
        let found = broadcast(addr, Duration::from_millis(800)).await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Loopback");
        assert_eq!(found[0].address, "http://127.0.0.1:8096");
    }
}
