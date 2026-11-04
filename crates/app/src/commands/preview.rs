// Preview commands: compile to HTML, invalidate cache, resolve clicks

use crate::commands::fs::anchored_project_root;
use crate::state::{CompileRequest, CompileState};
use tauri::Runtime;
use tokio::sync::oneshot;
use typst_ide_core::compiler::{
    ClickResult, DiagnosticInfo, PreviewResult, invalidate_preview_file_cache, resolve_click,
};

/// Cursor position as reported by Monaco (1-based line and UTF-16 column).
/// Transmitted by the frontend to enable forward-search (editor → preview sync).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPos {
    line_number: u32,
    column: u32,
}

/// Compiles Typst source code to a preview HTML document (pages rendered as inline SVGs)
/// At most one compilation runs at a time. Pending requests are coalesced so
/// only the latest source is compiled; older pending requests are dropped.
/// The compile root is the Rust-anchored project root: the invoke arguments are not consulted.
#[tauri::command]
pub async fn render_preview<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, CompileState>,
    source: String,
    cursor: Option<CursorPos>,
) -> Result<PreviewResult, Vec<DiagnosticInfo>> {
    let root = anchored_project_root(&app).map(|p| p.to_string_lossy().into_owned());
    let cur = cursor.map(|c| (c.line_number, c.column));
    let (tx, rx) = oneshot::channel();
    let request = CompileRequest {
        root,
        source,
        cursor: cur,
        result_tx: tx,
    };
    state.request_tx.send(request).map_err(|_| {
        vec![DiagnosticInfo {
            severity: "error".into(),
            message: "Preview compile worker is not running".into(),
            hints: vec![],
            line: None,
            column: None,
            end_line: None,
            end_column: None,
        }]
    })?;
    rx.await.map_err(|_| {
        vec![DiagnosticInfo {
            severity: "error".into(),
            message: "Preview compile result was dropped".into(),
            hints: vec![],
            line: None,
            column: None,
            end_line: None,
            end_column: None,
        }]
    })?
}

/// Invalidates the file cache of the persistent preview world.
/// Call this after saving a file that is imported by the main document so the
/// next preview compilation picks up the changes from disk.
///
/// If `path` is provided, only that file is evicted; otherwise the entire cache
/// is cleared. Selective eviction keeps other imports/packages warm.
///
/// Runs on the blocking thread pool: the preview world mutex may be held by a
/// running compile for seconds, so a synchronous version would freeze the UI
/// (the command would run on the main thread).
#[tauri::command]
pub async fn invalidate_file_cache(path: Option<String>) {
    tauri::async_runtime::spawn_blocking(move || invalidate_preview_file_cache(path.as_deref()))
        .await
        .ok();
}

/// Resolves a click on the rendered preview to a source position (line, column).
///
/// Runs on the blocking thread pool so it never freezes the UI even if
/// the preview world lock is temporarily held by a concurrent compile.
#[tauri::command]
pub async fn resolve_preview_click<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    source: String,
    page: usize,
    x: f64,
    y: f64,
) -> Option<ClickResult> {
    let root = anchored_project_root(&app).map(|p| p.to_string_lossy().into_owned());
    tauri::async_runtime::spawn_blocking(move || {
        resolve_click(root.as_deref(), &source, page, x, y)
    })
    .await
    .ok()?
}
