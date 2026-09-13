//! The site-notification summary toast, never a bell row; its kv vocabulary is shared with background.rs's Android job.

use crate::anilist::client::AniList;
use crate::db::Db;
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const TICK: Duration = Duration::from_secs(60);
const STARTUP_DELAY: Duration = Duration::from_secs(45);

pub const INTERVAL_KEY: &str = "notif_bg_interval_min";
/// The cursor per account; `switch_identity` clears it, since `kv_advance_max` only ever moves it forward.
pub(crate) const SEEN_KEY: &str = "site_notif_seen_id";
pub(crate) const LAST_CHECK_KEY: &str = "site_notif_last_check_ms";

/// Android's JobScheduler floor, one vocabulary on both platforms so the desktop cannot promise a faster cadence.
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

/// The one request; `resetNotificationCount` is deliberately absent, and message notifications stay excluded.
pub(crate) const SITE_QUERY: &str = "
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

/// How long a failed check waits: neither the tick rate nor the whole configured interval.
const RETRY_AFTER_FAILURE_MS: i64 = 5 * 60_000;

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
    let data = match api.query_from("site", Some(&token), SITE_QUERY, json!({})).await {
        Ok(d) => d,
        Err(e) => {
            // Once per transition, not per tick — the debug_changed lesson.
            crate::logging::debug_changed("site", "check", format!("check failed: {e:?}"));
            // Not a success stamp, yet not left unstamped: an unreachable server must not be polled at the tick rate.
            let interval_ms = interval * 60_000;
            let retry_in = interval_ms.min(RETRY_AFTER_FAILURE_MS);
            let _ = db.kv_set(
                LAST_CHECK_KEY,
                &(crate::alerts::notify::now_ms() - interval_ms + retry_in).to_string(),
            );
            return;
        }
    };
    // Stamped only on success: a failed fetch must not silence the next interval, nor Android's job.
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
        // News this connection claimed; a zero unread count means it was read in the bell, so the toast stays quiet.
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

    /// A background pass must never mark the user's site feed seen.
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
