//! Taking a lock without inheriting somebody else's panic.
//!
//! A `std::sync::Mutex` is *poisoned* once a thread panics while holding it,
//! and every later `lock().unwrap()` panics too — for the life of the process,
//! whatever the data behind it looks like. This module says the other thing:
//! take the guard anyway.
//!
//! That is the right default here specifically because of `logging::supervise`,
//! which puts a panicked background loop back. A poisoned lock turns one panic
//! into a permanent outage: the restarted loop dies on its first lock, burns
//! through `MAX_RESTARTS`, and detection or the alert passes are then off until
//! the app is restarted. Nothing about a poisoned mutex is worse than that — the
//! guarded data is a SQLite connection, a playback session or a presence handle,
//! none of which a panic can leave torn in a way a fresh poll will not overwrite.
//!
//! Two modules recovered like this already and are the reason it is now one
//! trait rather than a habit: `logging`, which must keep working *while*
//! reporting the panic, and the Jellyfin caches. The Linux-only `mpris.rs`
//! spells it out by hand — it does not compile on Windows, so it is left where
//! CI can see it rather than changed where nothing here can check it.

use std::sync::{Mutex, MutexGuard};

pub trait LockExt<T> {
    /// The guard, poisoned or not.
    fn guard(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn guard(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole point: a mutex a panicking thread held is still usable, and
    /// still holds what was written before the panic.
    #[test]
    fn a_poisoned_lock_still_hands_over_its_data() {
        let m = std::sync::Arc::new(Mutex::new(vec![1, 2, 3]));

        let poisoner = std::sync::Arc::clone(&m);
        let died = std::thread::spawn(move || {
            let mut held = poisoner.guard();
            held.push(4);
            panic!("while holding the lock");
        })
        .join();
        assert!(died.is_err(), "the thread was supposed to panic");

        assert!(m.lock().is_err(), "and to poison the mutex on the way out");
        assert_eq!(*m.guard(), vec![1, 2, 3, 4]);
    }
}
