//! The background passes that end in a notification; `notify` is the only writer of a bell row and the only toast caller.

pub mod airing;
pub mod notify;
pub mod sequel;
pub mod site;
pub mod stale;
