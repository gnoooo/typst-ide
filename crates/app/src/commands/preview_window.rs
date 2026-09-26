// Preview window management
//
// The "preview in a separate window" feature opens a second Tauri window
// (label "preview") that renders the compiled pages forwarded by the main
// window. The mode is transient: closing the window (X or the "re-embed"
// button) restores the classic split layout in the main window.

use tauri::{Manager, Runtime, WebviewUrl};

pub const PREVIEW_WINDOW_LABEL: &str = "preview";

/// Event emitted to the main window when the preview window is destroyed.
pub const PREVIEW_WINDOW_CLOSED_EVENT: &str = "preview-window-closed";

/// Creates the preview window if it does not exist yet, otherwise shows it
/// and gives it focus. Returns whether the window is open afterwards.
#[tauri::command]
pub fn ensure_preview_window<R>(app: tauri::AppHandle<R>) -> bool
where
    R: Runtime + 'static,
{
    if let Some(win) = app.get_webview_window(PREVIEW_WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return true;
    }

    let new_builder = || {
        tauri::WebviewWindowBuilder::new(
            &app,
            PREVIEW_WINDOW_LABEL,
            WebviewUrl::App("preview.html".into()),
        )
        .title("Typst IDE : Preview")
        .inner_size(900.0, 800.0)
        .min_inner_size(420.0, 300.0)
    };

    // Attach the preview window to the main one so it closes with the app
    // (no orphaned window on quit).
    let result = if let Some(main) = app.get_webview_window("main") {
        new_builder().parent(&main).and_then(|b| b.build())
    } else {
        new_builder().build()
    };

    match result {
        Ok(_) => true,
        Err(err) => {
            eprintln!("Failed to open preview window: {err}");
            false
        }
    }
}

/// Closes the preview window (used when the user toggles the feature off
/// from the main window). Returns whether the window was open.
#[tauri::command]
pub fn close_preview_window<R>(app: tauri::AppHandle<R>) -> bool
where
    R: Runtime + 'static,
{
    match app.get_webview_window(PREVIEW_WINDOW_LABEL) {
        Some(win) => {
            let _ = win.close();
            true
        }
        None => false,
    }
}

/// Whether the preview window currently exists. Used by the main window on
/// reload (e.g. after a config import) to re-adopt the external layout.
#[tauri::command]
pub fn preview_window_status<R>(app: tauri::AppHandle<R>) -> bool
where
    R: Runtime + 'static,
{
    app.get_webview_window(PREVIEW_WINDOW_LABEL).is_some()
}
