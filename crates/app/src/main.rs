// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use std::sync::Arc;
use std::sync::Mutex;
use tauri::Manager;
use tokio::sync::Semaphore;
use typst_ide_core::database::{bibliography_db, history_db, notes_db};

use commands::bibliography;
use commands::db;
use commands::export;
use commands::fs;
use commands::misc;
use commands::preview;
use commands::templates;
use state::{BibliographyDbState, CompileState, HistoryDbState, NotesDbState};

/// Initialises one of the SQLite databases, showing a native error dialog and
/// returning the error if anything goes wrong (instead of panicking).
fn init_db_with_dialog(
    label: &str,
    path: &std::path::Path,
    init: fn(&str) -> rusqlite::Result<rusqlite::Connection>,
) -> Result<rusqlite::Connection, Box<dyn std::error::Error>> {
    let path_str = path.to_str().ok_or_else(|| {
        format!(
            "{label} database path is not valid UTF-8: {}",
            path.display()
        )
    })?;
    init(path_str).map_err(|e| {
        let message = format!("Failed to initialise {label} database: {e}");
        let _ = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Typst IDE")
            .set_description(&message)
            .show();
        message.into()
    })
}

fn main() {
    // On Linux, WebKitGTK may try to use DMABuf/GPU compositing and fail on some systems.
    // Disable as a secondary defense (the real fix is not bundling Wayland libs in the AppImage).
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // SAFETY: called before any threads are spawned (start of main, before Tauri init).
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let note_db_path = data_dir.join("notes.db");
            let note_conn = init_db_with_dialog("notes", &note_db_path, notes_db::init_db)?;
            app.manage(NotesDbState(Mutex::new(note_conn)));

            let history_db_path = data_dir.join("history.db");
            let history_conn =
                init_db_with_dialog("history", &history_db_path, history_db::init_db)?;
            app.manage(HistoryDbState(Mutex::new(history_conn)));

            let bibliography_db_path = data_dir.join("bibliography.db");
            let bibliography_conn = init_db_with_dialog(
                "bibliography",
                &bibliography_db_path,
                bibliography_db::init_db,
            )?;
            app.manage(BibliographyDbState(Mutex::new(bibliography_conn)));

            // Semaphore(1): at most one Typst compile at a time
            app.manage(CompileState(Arc::new(Semaphore::new(1))));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            preview::render_preview,
            preview::invalidate_file_cache,
            preview::resolve_preview_click,
            fs::open_folder_dialog,
            fs::create_project,
            fs::open_project,
            fs::read_file,
            fs::save_file,
            fs::rename_file,
            fs::list_directory,
            fs::create_dir,
            fs::delete_file_or_dir,
            fs::import_file_dialog,
            fs::import_image_dialog,
            fs::import_folder_dialog,
            fs::pick_files,
            fs::replace_file,
            fs::reveal_in_file_manager,
            fs::read_image_as_base64,
            fs::save_data_image,
            fs::file_hash,
            db::add_note,
            db::get_all_notes,
            db::delete_note,
            db::update_note,
            db::get_global_notes,
            db::get_project_notes,
            db::get_current_project_id,
            db::add_history_entry,
            db::get_history,
            db::delete_history_entry,
            db::update_history_entry,
            db::add_bibliography_entry,
            db::get_bibliography,
            db::delete_bibliography_entry,
            db::update_bibliography_entry,
            bibliography::create_bib_file_if_missing,
            bibliography::parse_bib_file,
            bibliography::add_entry_to_bib,
            bibliography::get_all_bibs,
            bibliography::replace_whole_bib_source,
            bibliography::delete_whole_bib_source,
            bibliography::delete_bib_source_value,
            bibliography::synchronize_bibliography_entries,
            export::pick_pdf_path,
            export::export_pdf,
            misc::set_webview_zoom,
            misc::font_exists,
            misc::suggest_font,
            templates::get_templates_dir,
            templates::list_templates,
            templates::create_template,
            templates::read_template,
            templates::update_template,
            templates::rename_template,
            templates::delete_template,
            templates::copy_template_to_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
