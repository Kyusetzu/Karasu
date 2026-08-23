//! Where every outbound HTTP client is born.
//!
//! One seam instead of four call sites building their own, because Android
//! needs a different TLS answer and a fix applied to three of four builders
//! is the kind of bug that only fails on the platform nobody is holding.
//!
//! **Why Android is special, measured on the first device.** reqwest 0.13
//! defaults to rustls with `rustls-platform-verifier`, whose Android backend
//! calls into the JVM — and requires an explicit init handed a JNI `Env` and
//! the app `Context`, *plus* a Kotlin helper component added to the Gradle
//! build. Nothing does that init, so every request died with
//! `panic: Expect rustls-platform-verifier to be initialized`
//! (rustls-platform-verifier-0.7.0/src/android.rs:90, verbatim from the
//! device's karasu.log). Wiring the init properly means a Gradle dependency
//! inside the *generated* `gen/android` tree — which `tauri android init`
//! regenerates at will — so the deterministic fix is chosen instead: a
//! preconfigured rustls config with webpki's baked Mozilla roots, Android
//! only.
//!
//! What that trades away, stated: user-installed CAs are not honoured on
//! Android, so a corporate MITM proxy or a self-signed Jellyfin certificate
//! that works on the desktop (whose platform verifier reads the OS store)
//! will not verify on the phone. Karasu talks to graphql.anilist.co, GitHub
//! and the user's Jellyfin — for the first two the public roots are exactly
//! right; a self-signed Jellyfin needs plain HTTP on Android until this
//! carries a user-supplied trust option.
//!
//! The rustls version here must stay in lockstep with reqwest's own —
//! `use_preconfigured_tls` downcasts the config against reqwest's rustls, and
//! a version skew fails at runtime as "unknown TLS backend", not at compile.

#[cfg(not(target_os = "android"))]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
}

#[cfg(target_os = "android")]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().use_preconfigured_tls(android_tls_config())
}

#[cfg(target_os = "android")]
fn android_tls_config() -> rustls::ClientConfig {
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth()
}
