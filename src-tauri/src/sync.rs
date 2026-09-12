//! Lock-taking that survives a poisoned mutex, so a loop `logging::supervise` restarts does not die on its first lock.

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

    /// Proves a mutex a panicking thread held is still usable and still holds what was written before the panic.
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
