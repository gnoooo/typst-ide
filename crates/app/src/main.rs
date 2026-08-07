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
use state::{BibliographyDbState, CompileState, HistoryDbState, NotesDbState};

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
            let note_conn = notes_db::init_db(note_db_path.to_str().unwrap())
                .expect("Failed to initialise notes DB");
            app.manage(NotesDbState(Mutex::new(note_conn)));

            let history_db_path = data_dir.join("history.db");
            let history_conn = history_db::init_db(history_db_path.to_str().unwrap())
                .expect("Failed to initialise history DB");
            app.manage(HistoryDbState(Mutex::new(history_conn)));

            let bibliography_db_path = data_dir.join("bibliography.db");
            let bibliography_conn = bibliography_db::init_db(bibliography_db_path.to_str().unwrap())
                .expect("Failed to initialise bibliography DB");
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
            misc::suggest_font
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}