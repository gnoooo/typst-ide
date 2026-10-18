// Tauri-managed state structs shared across command modules

use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::Semaphore;

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

/// Semaphore that limits preview compilation to one at a time.
/// The JS scheduler already ensures at most one in-flight invoke, but this is a
/// belt-and-suspenders guard at the Rust level, prevents concurrent CPU-bound
/// compiles from piling up if multiple callers ever bypass the JS scheduler.
pub struct CompileState(pub Arc<Semaphore>);
