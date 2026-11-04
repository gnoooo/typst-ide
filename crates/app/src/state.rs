// Tauri-managed state structs shared across command modules

use std::sync::Mutex;
use std::sync::mpsc;
use std::thread;
use tokio::sync::oneshot;
use typst_ide_core::compiler::{DiagnosticInfo, PreviewResult, compile_to_preview_html};

/// Tauri-managed state for the notes database
pub struct NotesDbState(pub Mutex<rusqlite::Connection>);
pub struct HistoryDbState(pub Mutex<rusqlite::Connection>);

/// The real project root, anchored Rust-side by `open_project` / `create_project`
/// (after their native-dialog validation). The frontend's copy is never trusted:
/// the FS sandbox roots are built from this state, not from invoke arguments.
pub struct ProjectRootState(pub Mutex<Option<std::path::PathBuf>>);

/// PDF export destination, anchored Rust-side by `pick_pdf_path` (native save
/// dialog). `export_pdf` writes only here; a forged `invoke` cannot choose the
/// destination.
pub struct PdfExportPathState(pub Mutex<Option<std::path::PathBuf>>);

/// A single preview compile request sent to the worker.
pub struct CompileRequest {
    pub root: Option<String>,
    pub source: String,
    pub cursor: Option<(u32, u32)>,
    pub result_tx: oneshot::Sender<Result<PreviewResult, Vec<DiagnosticInfo>>>,
}

/// Preview compile scheduler: at most one compile runs at a time, and pending
/// requests are coalesced so only the latest source is compiled.
pub struct CompileState {
    pub request_tx: mpsc::Sender<CompileRequest>,
}

impl CompileState {
    pub fn new() -> Self {
        let (request_tx, request_rx) = mpsc::channel::<CompileRequest>();

        thread::spawn(move || {
            while let Ok(current) = request_rx.recv() {
                // Drain every request that arrived while the previous compile
                // was running; keep the latest and drop the stale ones.
                let mut latest = current;
                while let Ok(req) = request_rx.try_recv() {
                    latest = req;
                }

                let result =
                    compile_to_preview_html(latest.root.as_deref(), &latest.source, latest.cursor);

                // The latest requester gets the result; older superseded
                // requests are silently dropped (the frontend only cares about
                // the most recent preview).
                let _ = latest.result_tx.send(result);
            }
        });

        Self { request_tx }
    }
}
