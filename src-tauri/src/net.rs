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
    // The provider is named, never defaulted: `ClientConfig::builder()` asks
    // rustls for a process-level default, and with more than one provider in
    // the crate graph rustls refuses to guess — with a *panic*, at line 249
    // of its crypto module, which on the first device build aborted the app
    // during setup before a window ever existed. aws-lc-rs is the provider
    // reqwest's own rustls already compiles in, so this adds nothing new.
    let provider = std::sync::Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs supports the default TLS protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    // ALPN is the caller's job on this path. reqwest's own rustls arm
    // advertises h2 + http/1.1 itself, but `use_preconfigured_tls` forwards
    // this config verbatim — and rustls defaults to offering *nothing*, so
    // the server could never pick h2 and every Android request ran HTTP/1.1:
    // one TCP+TLS handshake per concurrent request over the phone's radio
    // where the desktop multiplexes them all onto one connection. The offer
    // is a preference list, not a demand — an http/1.1-only server still
    // negotiates http/1.1, and plain-HTTP Jellyfin never touches TLS at all.
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config
}
