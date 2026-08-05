//! Reading the desktop's media sessions on Linux, via MPRIS over D-Bus.
//!
//! MPRIS is the Linux counterpart to Windows' SMTC, and on this platform it is
//! the *only* generic source: window enumeration has no X11/Wayland backend,
//! and on Wayland it cannot have one — a client is not permitted to read other
//! clients' windows at all. So everything a Linux user detects locally comes
//! through here.
//!
//! It is also better input than a window title where it applies. A player
//! publishes `xesam:url`, and for a local file that is the release name itself
//! rather than whatever the title bar was decorated with.
//!
//! Nothing here decides anything — it turns what the bus reports into
//! `MediaSession`s. See the parent module for what is then done with them.
//!
//! Known limitation: zbus's blocking proxy exposes no per-call timeout, so a
//! wedged player can stall a sweep for the D-Bus default of 25 seconds. The
//! blast radius is bounded — this runs on a `spawn_blocking` thread, the app
//! stays responsive, and the 5-second poll simply ticks late.

use super::MediaSession;
use std::collections::HashMap;
use std::sync::Mutex;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedValue, Value};

const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";

/// The session bus connection, reused across polls.
///
/// Detection runs every 5 seconds; a fresh connection each time is a socket
/// plus an auth handshake, forever. Cached — but dropped on *any* error, which
/// a bare `OnceLock` could not do: if the bus restarts or the connection dies,
/// a cached-forever handle would wedge detection permanently with no way back
/// short of restarting Karasu.
static BUS: Mutex<Option<Connection>> = Mutex::new(None);

fn connection() -> zbus::Result<Connection> {
    // A poisoned lock is recovered from rather than propagated: a panic
    // elsewhere should not permanently disable detection.
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

/// Unwraps nested variants. D-Bus `v` values can arrive boxed one or more
/// levels deep depending on how the player composed them.
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

/// The strings behind a metadata entry.
///
/// `xesam:artist` is spec'd as an array, but several players publish a bare
/// string instead, so both shapes are accepted. This is exactly the class of
/// inconsistency the parent module's docs warn about.
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

/// Reads an `a{sv}` out of a property value.
///
/// Tried directly first, then through one layer of variant, because whether
/// the dict arrives boxed depends on the sender.
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
        // A player can vanish between listing and reading it, so a failure on
        // any one of these is a skip, not an error for the whole sweep.
        // An owned bus name, so the proxy does not borrow `name` for its whole
        // lifetime — the session below takes ownership of it.
        let Ok(props) = Proxy::new(
            &conn,
            name.clone(),
            MPRIS_PATH,
            "org.freedesktop.DBus.Properties",
        ) else {
            continue;
        };
        // GetAll rather than two Gets: one round trip returns PlaybackStatus
        // and Metadata together, and this runs against every player on the bus
        // every five seconds.
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
            // MPRIS's vocabulary — Playing/Paused/Stopped — lands exactly on
            // the one SMTC already established once lowercased, so `pick` and
            // `is_playing` need no knowledge of which backend produced this.
            status,
            url,
        });
    }
    Ok(out)
}
