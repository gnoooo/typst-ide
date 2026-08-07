// Preview commands: compile to HTML, invalidate cache, resolve clicks

use crate::state::CompileState;
use typst_ide_core::compiler::{
    ClickResult, DiagnosticInfo, PreviewResult, compile_to_preview_html,
    invalidate_preview_file_cache, resolve_click,
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
/// At most one compilation runs at a time — the semaphore suspends excess callers
/// asynchronously (zero thread cost) until the running compile finishes.
#[tauri::command]
pub async fn render_preview(
    state: tauri::State<'_, CompileState>,
    source: String,
    root: Option<String>,
    cursor: Option<CursorPos>,
) -> Result<PreviewResult, Vec<DiagnosticInfo>> {
    // Acquire before spawning the blocking work: suspends (not blocks) extra callers
    let _permit = state.0.acquire().await.map_err(|e| {
        vec![DiagnosticInfo {
            severity: "error".into(),
            message: e.to_string(),
            hints: vec![],
            line: None,
            column: None,
            end_line: None,
            end_column: None,
        }]
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let cur = cursor.map(|c| (c.line_number, c.column));
        compile_to_preview_html(root.as_deref(), &source, cur)
    })
    .await
    .map_err(|e| {
        vec![DiagnosticInfo {
            severity: "error".into(),
            message: e.to_string(),
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
#[tauri::command]
pub fn invalidate_file_cache() {
    invalidate_preview_file_cache();
}

/// Resolves a click on the rendered preview to a source position (line, column).
///
/// Runs on the blocking thread pool so it never freezes the UI even if
/// the preview world lock is temporarily held by a concurrent compile.
#[tauri::command]
pub async fn resolve_preview_click(
    source: String,
    root: Option<String>,
    page: usize,
    x: f64,
    y: f64,
) -> Option<ClickResult> {
    tauri::async_runtime::spawn_blocking(move || {
        resolve_click(root.as_deref(), &source, page, x, y)
    })
    .await
    .ok()?
}
