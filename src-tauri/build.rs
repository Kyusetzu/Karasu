fn main() {
    tauri_build::build();
    // The lib test binary links every command through the specta builder, and rfd's TaskDialogIndirect needs comctl v6.
    if std::env::var("CARGO_CFG_WINDOWS").is_ok() {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-app.manifest");
        println!("cargo::rerun-if-changed=test-app.manifest");
        println!("cargo::rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo::rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
    }
}
