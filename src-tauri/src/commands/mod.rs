//! The Tauri command surface by subject, re-exported so `commands::x` paths and `generate_handler!` still resolve.

pub(crate) mod auth;
mod images;
pub(crate) mod list;
mod playback;
mod prefs;
mod system;
mod update;

pub use auth::*;
pub use images::*;
pub use list::*;
pub use playback::*;
pub use prefs::*;
pub use system::*;
pub use update::*;
