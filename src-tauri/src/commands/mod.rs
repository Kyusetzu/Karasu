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

/// A 64-bit integer crossing the IPC as a TypeScript `number`; specta refuses a bare i64 and AniList ids are i64 here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Num(pub i64);

impl specta::Type for Num {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <specta_typescript::Number<i64> as specta::Type>::definition(types)
    }
}

impl From<Num> for i64 {
    fn from(n: Num) -> i64 {
        n.0
    }
}

/// A `serde_json::Value` crossing the IPC as TypeScript `any`; specta's own `Value` support recurses without end.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Json(pub serde_json::Value);

impl specta::Type for Json {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <specta_typescript::Any as specta::Type>::definition(types)
    }
}

/// A float crossing the IPC as a plain TypeScript `number`; specta spells a bare f64 as `number | null` for NaN's sake.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Real(pub f64);

impl specta::Type for Real {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <specta_typescript::Number<f64> as specta::Type>::definition(types)
    }
}
