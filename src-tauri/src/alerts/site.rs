//! The AniList-notification summary pass — the scheduler's in-app half.
//!
//! One bounded request per fire: the server's unread count plus the newest
//! notification id, compared against a persisted cursor, surfaced as a
//! single summary **toast** — never a bell row. The bell already renders the
//! site rows themselves, so a local "N new notifications" row would sit
//! beside the very rows it summarizes; the toast is the half the bell cannot
//! do (reach the desktop while Karasu sits in the tray, or the phone while
//! the app is backgrounded). Same resolution as the airing watcher's
//! duplicate-refusal, same mechanism (`notify_toast`).
//!
//! Off by default, like `stale` and `sequel`: this is the first thing in the
//! app that spends the shared ~30/min budget with nobody asking, and even at
//! the 15-minute floor it costs 4 requests an hour.
//!
//! The interval is re-read every tick rather than slept, deliberately unlike
//! the compile-time-constant passes — a settings change takes effect without
//! a restart, and Android's JobScheduler shares the same kv vocabulary
//! (`notif_bg_interval_min`, `site_notif_seen_id`,
//! `site_notif_last_check_ms`), which is how the two halves coordinate: the
//! job defers to a fresh `site_notif_last_check_ms`, and the cursor advances
//! through `kv_advance_max` so two connections cannot both toast one batch.
//!
//! Arming is silent: with no cursor on record the first successful fetch
//! only writes the baseline. The airing watcher's lesson — turning a
//! notification on must not fire the backlog — with the request-free twist
//! that while *off* this pass fetches nothing at all, so the baseline is
//! taken at the first fetch instead of maintained on a clock.

use crate::anilist::client::AniList;
use crate::db::Db;
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const TICK: Duration = Duration::from_secs(60);
const STARTUP_DELAY: Duration = Duration::from_secs(45);

pub const INTERVAL_KEY: &str = "notif_bg_interval_min";
const SEEN_KEY: &str = "site_notif_seen_id";
const LAST_CHECK_KEY: &str = "site_notif_last_check_ms";

/// Android's JobScheduler floor — one vocabulary on both platforms, so the
/// desktop cannot promise a cadence the phone quietly rounds up.
pub const INTERVAL_MIN: i64 = 15;
pub const INTERVAL_MAX: i64 = 720;

/// `0` = off (the default); anything else clamped to the shared bounds.
pub fn interval_min(db: &Db) -> i64 {
    let raw = db
        .kv_get(INTERVAL_KEY)
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    if raw <= 0 {
        0
    } else {
        raw.clamp(INTERVAL_MIN, INTERVAL_MAX)
    }
}

/// The one request. `resetNotificationCount` is deliberately absent — its
/// default is false, and a background pass marking the user's site feed seen
/// would be a real bug, pinned by a test below. The 19 inline fragments are
/// the price of `notifications` being a union with no common id field;
/// `ActivityMessageNotification` is excluded exactly as everywhere else
/// (absent from `type_in`, no fragment).
const SITE_QUERY: &str = "
query {
  Viewer { unreadNotificationCount }
  Page(page: 1, perPage: 1) {
    notifications(type_in: [
      AIRING, FOLLOWING, ACTIVITY_MENTION, ACTIVITY_REPLY, ACTIVITY_REPLY_SUBSCRIBED,
      ACTIVITY_LIKE, ACTIVITY_REPLY_LIKE, THREAD_COMMENT_MENTION, THREAD_COMMENT_REPLY,
      THREAD_SUBSCRIBED, THREAD_COMMENT_LIKE, THREAD_LIKE, RELATED_MEDIA_ADDITION,
      MEDIA_DATA_CHANGE, MEDIA_MERGE, MEDIA_DELETION, MEDIA_SUBMISSION_UPDATE,
      STAFF_SUBMISSION_UPDATE, CHARACTER_SUBMISSION_UPDATE
    ]) {
      __typename
      ... on AiringNotification { id }
      ... on FollowingNotification { id }
      ... on ActivityMentionNotification { id }
      ... on ActivityReplyNotification { id }
      ... on ActivityReplySubscribedNotification { id }
      ... on ActivityLikeNotification { id }
      ... on ActivityReplyLikeNotification { id }
      ... on ThreadCommentMentionNotification { id }
      ... on ThreadCommentReplyNotification { id }
      ... on ThreadCommentSubscribedNotification { id }
      ... on ThreadCommentLikeNotification { id }
      ... on ThreadLikeNotification { id }
      ... on RelatedMediaAdditionNotification { id }
      ... on MediaDataChangeNotification { id }
      ... on MediaMergeNotification { id }
      ... on MediaDeletionNotification { id }
      ... on MediaSubmissionUpdateNotification { id }
      ... on StaffSubmissionUpdateNotification { id }
      ... on CharacterSubmissionUpdateNotification { id }
    }
  }
}";

pub fn spawn(app: AppHandle) {
    crate::logging::supervise("site", move || {
        let app = app.clone();
        async move {
            tokio::time::sleep(STARTUP_DELAY).await;
            loop {
                check(&app).await;
                tokio::time::sleep(TICK).await;
            }
        }
    });
}

async fn check(app: &AppHandle) {
    let db = app.state::<Db>();
    let interval = interval_min(&db);
    if interval == 0 {
        return;
    }
    let last = db
        .kv_get(LAST_CHECK_KEY)
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    if crate::alerts::notify::now_ms() - last < interval * 60_000 {
        return;
    }
    let Some(token) = crate::anilist::auth::load_token() else {
        return;
    };

    let api = app.state::<AniList>();
    let data = match api.query(Some(&token), SITE_QUERY, json!({})).await {
        Ok(d) => d,
        Err(e) => {
            // Once per transition, not per tick — the debug_changed lesson.
            crate::logging::debug_changed("site", "check", format!("check failed: {e:?}"));
            return;
        }
    };
    // Stamped only on success, like the update throttle: a failed fetch must
    // not silence the next interval (or Android's job, which defers to this).
    let _ = db.kv_set(
        LAST_CHECK_KEY,
        &crate::alerts::notify::now_ms().to_string(),
    );

    let unread = data
        .pointer("/Viewer/unreadNotificationCount")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let Some(newest) = data
        .pointer("/Page/notifications/0/id")
        .and_then(|v| v.as_i64())
    else {
        return;
    };

    let seen = db.kv_get(SEEN_KEY).and_then(|s| s.parse::<i64>().ok());
    let advanced = db.kv_advance_max(SEEN_KEY, newest);
    match seen {
        // First fetch ever: baseline written, nothing announced.
        None => {}
        // News, and this connection is the one that claimed it. A zero
        // unread count means the user already read it in the bell — the
        // cursor still moved, the toast stays quiet.
        Some(s) if newest > s && unread > 0 && advanced => {
            crate::alerts::notify::notify_toast(
                app,
                "site",
                crate::i18n::Msg::SiteNotifTitle,
                crate::i18n::Msg::SiteNotifBody { count: unread },
            );
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::SITE_QUERY;

    /// A background pass must never mark the user's site feed seen. The
    /// argument's default is false; this pins that nobody "helpfully" adds
    /// it back while touching the query.
    #[test]
    fn the_query_never_resets_the_unread_count() {
        assert!(!SITE_QUERY.contains("resetNotificationCount"));
    }

    /// Private mail stays excluded, the same way it is everywhere else.
    #[test]
    fn message_notifications_are_absent_twice_over() {
        assert!(!SITE_QUERY.contains("ACTIVITY_MESSAGE"));
        assert!(!SITE_QUERY.contains("ActivityMessageNotification"));
    }
}
