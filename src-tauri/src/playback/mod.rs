//! What is playing, and what it is.
//!
//! The pipeline runs left to right: `detection` finds a window, a Windows media
//! session or a Jellyfin session and reports a raw title; `recognition` parses
//! that release name and matches it against the cached list; `relations` applies
//! anime-relations episode redirects; `scrobbler` decides when a session has
//! been watched long enough to write.
//!
//! They were four unrelated top-level modules before, which said nothing about
//! the fact that each one only exists to feed the next.

pub mod detection;
pub mod recognition;
pub mod relations;
pub mod scrobbler;
