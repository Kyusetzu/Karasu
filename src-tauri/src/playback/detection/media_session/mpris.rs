//! Reads the desktop's media sessions on Linux via MPRIS over D-Bus, the only generic local source there.

use super::MediaSession;
use std::collections::HashMap;
use std::sync::Mutex;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedValue, Value};

const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";

/// The session bus connection, reused across polls and dropped on any error so a dead bus cannot wedge detection.
static BUS: Mutex<Option<Connection>> = Mutex::new(None);

fn connection() -> zbus::Result<Connection> {
    // A poisoned lock is recovered from, so a panic elsewhere does not permanently disable detection.
    let mut guard = BUS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(conn) = guard.as_ref() {
        return Ok(conn.clone());
    }
    let conn = Connection::session()?;
    *guard = Some(conn.clone());
    Ok(conn)
}

fn drop_connection() {
    *BUS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Unwraps nested variants, since D-Bus `v` values can arrive boxed one or more levels deep.
fn flatten<'a>(v: &'a Value<'a>) -> &'a Value<'a> {
    match v {
        Value::Value(inner) => flatten(inner),
        other => other,
    }
}

fn as_str<'a>(v: &'a Value<'a>) -> Option<&'a str> {
    match flatten(v) {
        Value::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

/// The strings behind a metadata entry; `xesam:artist` is spec'd as an array, but several players publish a bare string.
pub fn metadata_strings(v: &Value) -> Vec<String> {
    match flatten(v) {
        Value::Str(s) => vec![s.as_str().to_string()],
        Value::Array(a) => a
            .iter()
            .filter_map(|e| as_str(e).map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

/// Reads an `a{sv}` out of a property value, directly or through one layer of variant, since senders differ.
fn as_dict(v: &OwnedValue) -> HashMap<String, OwnedValue> {
    if let Ok(map) = HashMap::<String, OwnedValue>::try_from(v.clone()) {
        return map;
    }
    if let Value::Value(inner) = &**v {
        if let Ok(owned) = OwnedValue::try_from(&**inner) {
            if let Ok(map) = HashMap::<String, OwnedValue>::try_from(owned) {
                return map;
            }
        }
    }
    HashMap::new()
}

fn text(meta: &HashMap<String, OwnedValue>, key: &str) -> String {
    meta.get(key)
        .and_then(|v| as_str(v))
        .unwrap_or_default()
        .to_string()
}

pub fn read_sessions() -> zbus::Result<Vec<MediaSession>> {
    let conn = match connection() {
        Ok(c) => c,
        Err(e) => {
            drop_connection();
            return Err(e);
        }
    };

    let bus = Proxy::new(
        &conn,
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
    )?;
    let names: Vec<String> = match bus.call("ListNames", &()) {
        Ok(n) => n,
        Err(e) => {
            // The bus itself failed, not one player — the handle is suspect.
            drop_connection();
            return Err(e);
        }
    };

    let mut out = Vec::new();
    for name in names.into_iter().filter(|n| n.starts_with(MPRIS_PREFIX)) {
        // A vanished player is a skip, not an error; the owned bus name keeps the proxy from borrowing `name` for its lifetime.
        let Ok(props) = Proxy::new(
            &conn,
            name.clone(),
            MPRIS_PATH,
            "org.freedesktop.DBus.Properties",
        ) else {
            continue;
        };
        // GetAll rather than two Gets: one round trip returns PlaybackStatus and Metadata for every player on every poll.
        let Ok(all) = props.call::<_, _, HashMap<String, OwnedValue>>(
            "GetAll",
            &(PLAYER_IFACE,),
        ) else {
            continue;
        };

        let status = all
            .get("PlaybackStatus")
            .and_then(|v| as_str(v))
            .unwrap_or("unknown")
            .to_lowercase();

        let meta = all.get("Metadata").map(as_dict).unwrap_or_default();
        let url = text(&meta, "xesam:url");
        let artist = {
            let a = meta
                .get("xesam:artist")
                .map(|v| metadata_strings(v))
                .unwrap_or_default();
            let a = if a.is_empty() {
                meta.get("xesam:albumArtist")
                    .map(|v| metadata_strings(v))
                    .unwrap_or_default()
            } else {
                a
            };
            a.join(", ")
        };

        let playback_type = super::infer_playback_type(&url, &name).to_string();

        out.push(MediaSession {
            app_id: name,
            title: text(&meta, "xesam:title"),
            artist,
            album: text(&meta, "xesam:album"),
            playback_type,
            // Lowercased, MPRIS's Playing/Paused/Stopped lands on SMTC's vocabulary, so the shared decisions stay backend-blind.
            status,
            url,
        });
    }
    Ok(out)
}
