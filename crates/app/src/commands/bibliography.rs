// Bibliography feature commands

use std::io::ErrorKind;

use crate::state::BibliographyDbState;
use typst_ide_core::database::bibliography_db::{self};
use typst_ide_core::features::bibliography;

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

#[tauri::command]
pub fn get_all_bibs(project_path: &str) -> Result<Vec<String>, String> {
    bibliography::get_all_bibs(project_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn replace_whole_bib_source(
    filepath: &str,
    old_cite_key: &str,
    entry: serde_json::Value,
) -> Result<bool, String> {
    let out = bibliography::replace_whole_bib_source(filepath, old_cite_key, &entry);
    match out {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn delete_whole_bib_source(filepath: &str, cite_key_to_delete: &str) -> Result<bool, String> {
    let out = bibliography::delete_whole_bib_source(filepath, cite_key_to_delete);
    match out {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn delete_bib_source_value(
    filepath: &str,
    cite_key_to_edit: &str,
    key_to_delete: &str,
) -> Result<bool, String> {
    let out = bibliography::delete_bib_source_value(filepath, cite_key_to_edit, key_to_delete);
    match out {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn synchronize_bibliography_entries(
    state: tauri::State<'_, BibliographyDbState>,
    projectpath: &str,
) {
    let conn = match state.0.lock() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("lock error: {e}");
            return;
        }
    };

    let bib_files = match get_all_bibs(projectpath) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("get_all_bibs error: {e}");
            return;
        }
    };

    for bib_file in bib_files {
        let title = bib_file.trim_end_matches(".bib").to_string();
        let path = format!("{}/{}", projectpath, bib_file);

        // Update project_path for existing entries (e.g. from before the migration)
        let _ = bibliography_db::set_entry_project_path(&conn, &path, projectpath);
        // Insert new entries if they don't exist yet
        let _ = bibliography_db::add_entry(&conn, &title, "ieee", &path, projectpath, false);
    }
}
