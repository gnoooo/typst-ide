// Tauri-managed state structs shared across command modules

use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::Semaphore;

/// Tauri-managed state for the notes database
pub struct NotesDbState(pub Mutex<rusqlite::Connection>);
pub struct HistoryDbState(pub Mutex<rusqlite::Connection>);

/// Semaphore that limits preview compilation to one at a time.
/// The JS scheduler already ensures at most one in-flight invoke, but this is a
/// belt-and-suspenders guard at the Rust level — prevents concurrent CPU-bound
/// compiles from piling up if multiple callers ever bypass the JS scheduler.
pub struct CompileState(pub Arc<Semaphore>);
