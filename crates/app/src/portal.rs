// XDG Desktop Portal helpers used inside the Flatpak sandbox.
//
// Outside Linux (or outside a sandbox) `is_sandboxed` simply returns false
// and the reveal helper is not compiled, so the native shell fallbacks in
// `commands/fs.rs` keep working unchanged.

/// Whether the application is running inside a Flatpak (or similar) sandbox.
#[tauri::command]
pub fn is_sandboxed() -> bool {
    #[cfg(target_os = "linux")]
    {
        ashpd::is_sandboxed()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Reveals `dir` in the user's file manager through the OpenURI portal.
///
/// Inside the sandbox the path is a document-portal mount
/// (`/run/user/<uid>/doc/...`) which is also visible on the host, so the
/// host file manager opens the real location.
#[cfg(target_os = "linux")]
pub async fn reveal_in_file_manager(dir: &std::path::Path) -> Result<(), String> {
    use std::os::fd::AsFd;

    let handle = std::fs::File::open(dir)
        .map_err(|e| format!("Impossible d'ouvrir {} : {e}", dir.display()))?;
    ashpd::desktop::open_uri::OpenDirectoryRequest::default()
        .send(&handle.as_fd())
        .await
        .map_err(|e| e.to_string())?
        .response()
        .map_err(|e| e.to_string())
}
