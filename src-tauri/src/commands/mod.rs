//! The Tauri command surface, grouped by what each command is about.
//!
//! Split out of a single 1513-line file holding 62 commands. Everything is
//! re-exported here, so `commands::x` paths and the `generate_handler!` list in
//! `lib.rs` resolve exactly as they did — a command's name is a string on the
//! frontend, and renaming one is a runtime break the compiler cannot see.

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
