//! The pipeline: detection finds a title, recognition matches it, relations redirect it, scrobbler writes it.

pub mod detection;
pub mod recognition;
pub mod relations;
pub mod scrobbler;
