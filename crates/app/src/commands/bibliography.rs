// Bibliography feature commands

use std::io::ErrorKind;

use serde::Serialize;
use typst_ide_core::features::bibliography;

#[derive(Serialize)]
pub struct ProjectBibFile {
    pub title: String,
    pub path: String,
}

#[tauri::command]
pub fn create_bib_file_if_missing(filepath: &str) -> Result<bool, String> {
    let out = bibliography::create_bib_file_if_missing(filepath);

    match out {
        Ok(_) => Ok(true),
        Err(ref e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn parse_bib_file(filepath: &str) -> Result<Vec<bibliography::BibEntry>, String> {
    bibliography::parse_bib_file(filepath).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_entry_to_bib(
    filepath: &str,
    entry_type: &str,
    cite_key: &str,
    json: serde_json::Value,
) -> Result<bool, String> {
    let out = bibliography::add_entry_to_bib(filepath, entry_type, cite_key, &json);
    match out {
        Ok(_) => Ok(true),
        Err(e) => {
            if e.to_string().contains("Entry already exists") {
                Ok(false)
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// Lists the .bib files of the project (fresh scan of the fs, sorted by name).
/// This replaces the old database-backed list: it is called on every opening
/// of the bibliography window, so the list always matches the disc.
#[tauri::command]
pub fn get_project_bibliographies(project_path: &str) -> Result<Vec<ProjectBibFile>, String> {
    let mut files = bibliography::get_all_bibs(project_path).map_err(|e| e.to_string())?;
    files.sort();

    Ok(files
        .into_iter()
        .map(|name| ProjectBibFile {
            title: name.trim_end_matches(".bib").to_string(),
            path: format!("{}/{}", project_path, name),
        })
        .collect())
}

/// `Err(NotFound)` means the entry is already gone — treat as a benign race.
/// All other IO errors are propagated so the frontend can surface them.
fn io_err_to_string(e: std::io::Error) -> Result<bool, String> {
    if e.kind() == ErrorKind::NotFound {
        Ok(false)
    } else {
        Err(e.to_string())
    }
}

#[tauri::command]
pub fn replace_whole_bib_source(
    filepath: &str,
    old_cite_key: &str,
    entry: serde_json::Value,
) -> Result<bool, String> {
    match bibliography::replace_whole_bib_source(filepath, old_cite_key, &entry) {
        Ok(_) => Ok(true),
        Err(e) => io_err_to_string(e),
    }
}

#[tauri::command]
pub fn delete_whole_bib_source(filepath: &str, cite_key_to_delete: &str) -> Result<bool, String> {
    match bibliography::delete_whole_bib_source(filepath, cite_key_to_delete) {
        Ok(_) => Ok(true),
        Err(e) => io_err_to_string(e),
    }
}

#[tauri::command]
pub fn delete_bib_source_value(
    filepath: &str,
    cite_key_to_edit: &str,
    key_to_delete: &str,
) -> Result<bool, String> {
    match bibliography::delete_bib_source_value(filepath, cite_key_to_edit, key_to_delete) {
        Ok(_) => Ok(true),
        Err(e) => io_err_to_string(e),
    }
}
