// Database commands: notes and history

use crate::state::{HistoryDbState, NotesDbState};
use typst_ide_core::database::{
    history_db::{self},
    notes_db::{self, Note},
};

/// ####################################################
/// Notes

/// Adds a note to the database
#[tauri::command]
pub fn add_note(
    state: tauri::State<'_, NotesDbState>,
    title: String,
    content: String,
    scope: String,
    project_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    notes_db::add_note(&conn, &title, &content, &scope, project_id.as_deref())
        .map_err(|e| e.to_string())
}

/// Returns all notes
#[tauri::command]
pub fn get_all_notes(state: tauri::State<'_, NotesDbState>) -> Result<Vec<Note>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    notes_db::get_all_notes(&conn).map_err(|e| e.to_string())
}

/// Returns all global notes (not linked to a project)
#[tauri::command]
pub fn get_global_notes(state: tauri::State<'_, NotesDbState>) -> Result<Vec<Note>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    notes_db::get_global_notes(&conn).map_err(|e| e.to_string())
}

/// Returns all notes linked to a project path
#[tauri::command]
pub fn get_project_notes(
    state: tauri::State<'_, NotesDbState>,
    project_path: String,
) -> Result<Vec<Note>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let project_id = notes_db::project_id_from_path(&project_path);
    notes_db::get_project_notes(&conn, &project_id).map_err(|e| e.to_string())
}

/// Get the hash of a project path to use as a project ID in the database
#[tauri::command]
pub fn get_current_project_id(project_path: String) -> String {
    notes_db::project_id_from_path(&project_path)
}

/// Deletes a note by its ID
#[tauri::command]
pub fn delete_note(state: tauri::State<'_, NotesDbState>, note_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    notes_db::delete_note(&conn, &note_id).map_err(|e| e.to_string())
}

/// Updates a note by its ID
#[tauri::command]
pub fn update_note(
    state: tauri::State<'_, NotesDbState>,
    note_id: String,
    title: String,
    content: String,
    scope: String,
    project_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    notes_db::update_note(
        &conn,
        &note_id,
        &title,
        &content,
        &scope,
        project_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// ################################################
/// History DB

#[tauri::command]
pub fn add_history_entry(
    state: tauri::State<'_, HistoryDbState>,
    name: String,
    path: String,
) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let inserted = history_db::add_entry(&conn, &name, &path).map_err(|e| e.to_string())?;
    Ok(inserted)
}

#[tauri::command]
pub fn get_history(
    state: tauri::State<'_, HistoryDbState>,
) -> Result<Vec<history_db::HistoryEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    history_db::get_history(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_history_entry(
    state: tauri::State<'_, HistoryDbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    history_db::delete_history_entry(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_history_entry(
    state: tauri::State<'_, HistoryDbState>,
    id: String,
    name: String,
    path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    history_db::update_history_entry(&conn, &id, &name, &path).map_err(|e| e.to_string())
}
