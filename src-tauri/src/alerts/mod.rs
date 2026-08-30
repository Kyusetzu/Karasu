//! The background passes that end in a notification.
//!
//! `airing` watches for episodes that have aired, `sequel` for announced
//! continuations of things you finished, `stale` for entries you paused and
//! forgot — and all three end at `notify`, which is the only writer of a
//! notification row and the only caller of the desktop toast.
//!
//! Grouping them says the thing four sibling modules could not: they are one
//! subject, and `notify` is where each of them stops.

pub mod airing;
pub mod notify;
pub mod sequel;
pub mod site;
pub mod stale;
