// Configuration export/import commands
//
// The whole user configuration (editor/UI preferences, markers, notes,
// history and local templates) can be dumped into a single JSON file and
// re-imported into another installation.
//
// File format:
//   {
//     "format": "typst-ide-config",
//     "formatVersion": 1,
//     "appVersion": "...",
//     "exportedAt": "...",
//     "settings": { "<localStorage key>": <value>, ... },
//     "notes": [...],
//     "history": [...],
//     "templates": { "<name>": { "<relative path>": { "encoding": "utf8"|"base64", "content": "..." } } }
//   }
//
// Importing is incremental and never destructive: notes/history are merged
// with INSERT OR IGNORE, template files that already exist are skipped, and
// unknown settings keys are ignored.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use base64::Engine as _;

use super::templates::{templates_root, validate_template_name};
use crate::state::{HistoryDbState, NotesDbState};
use typst_ide_core::database::{
    history_db::{self, HistoryImport},
    notes_db::{self, NoteImport},
};

#[derive(serde::Serialize)]
pub struct ExportData {
    pub notes: Vec<typst_ide_core::database::notes_db::Note>,
    pub history: Vec<history_db::HistoryEntry>,
    pub templates: HashMap<String, HashMap<String, EncodedFile>>,
}

/// A single template file: text files are exported as plain UTF-8, binary
/// files (images, fonts) as base64.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct EncodedFile {
    pub encoding: String,
    pub content: String,
}

#[derive(serde::Serialize)]
pub struct TemplateImportSummary {
    pub templates_created: usize,
    pub files_written: usize,
    pub files_skipped: usize,
}

/// Opens a "save" dialog and writes the given payload to the chosen file.
/// Returns `Ok(None)` when the user cancels.
#[tauri::command]
pub async fn export_config(payload: String) -> Result<Option<String>, String> {
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Exporter la configuration")
            .add_filter("Configuration Typst IDE", &["json"])
            .set_file_name("typst-ide-config.json")
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|p| p.to_string_lossy().into_owned());

    let path = match path {
        Some(p) => p,
        None => return Ok(None),
    };

    std::fs::write(&path, payload).map_err(|e| format!("{path}: {e}"))?;
    Ok(Some(path))
}

/// Opens an "open" dialog and returns the raw content of the chosen file.
/// Returns `Ok(None)` when the user cancels.
#[tauri::command]
pub async fn import_config() -> Result<Option<String>, String> {
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Importer la configuration")
            .add_filter("Configuration Typst IDE", &["json"])
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|p| p.to_string_lossy().into_owned());

    let path = match path {
        Some(p) => p,
        None => return Ok(None),
    };

    let content = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(Some(content))
}

/// Collects everything the export file will contain: notes, history entries
/// and the whole local templates tree.
#[tauri::command]
pub fn collect_export_data(
    notes_state: tauri::State<'_, NotesDbState>,
    history_state: tauri::State<'_, HistoryDbState>,
    app: tauri::AppHandle,
) -> Result<ExportData, String> {
    let notes_conn = notes_state.0.lock().map_err(|e| e.to_string())?;
    let notes = notes_db::get_all_notes(&notes_conn).map_err(|e| e.to_string())?;

    let history_conn = history_state.0.lock().map_err(|e| e.to_string())?;
    let history = history_db::get_history(&history_conn).map_err(|e| e.to_string())?;

    let templates = read_templates_tree(&app)?;

    Ok(ExportData {
        notes,
        history,
        templates,
    })
}

/// Imports exported notes (merged: existing ids are skipped).
#[tauri::command]
pub fn import_notes_data(
    state: tauri::State<'_, NotesDbState>,
    notes: Vec<NoteImport>,
) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    notes_db::import_notes(&conn, &notes).map_err(|e| e.to_string())
}

/// Imports exported history entries (merged: existing ids/paths are skipped).
#[tauri::command]
pub fn import_history_data(
    state: tauri::State<'_, HistoryDbState>,
    entries: Vec<HistoryImport>,
) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    history_db::import_history(&conn, &entries).map_err(|e| e.to_string())
}

/// Imports exported templates. Template names and file paths are validated
/// (no traversal, no absolute paths); files that already exist are skipped,
/// so nothing already present is ever overwritten.
#[tauri::command]
pub fn import_templates_data(
    app: tauri::AppHandle,
    templates: HashMap<String, HashMap<String, EncodedFile>>,
) -> Result<TemplateImportSummary, String> {
    let root = templates_root(&app)?;
    let mut summary = TemplateImportSummary {
        templates_created: 0,
        files_written: 0,
        files_skipped: 0,
    };

    for (name, files) in templates {
        validate_template_name(&name)?;
        let dir = root.join(&name);
        if !dir.exists() {
            std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
            summary.templates_created += 1;
        }
        for (rel, file) in files {
            match import_template_file(&dir, &rel, &file) {
                Ok(written) => {
                    summary.files_written += written;
                    if written == 0 {
                        summary.files_skipped += 1;
                    }
                }
                // A single malicious/invalid entry must not abort the whole
                // import: skip it, the summary lets the user notice.
                Err(_) => summary.files_skipped += 1,
            }
        }
    }

    Ok(summary)
}

// ###########################################################
// Helpers

/// Recursively reads the templates tree as `{name: {rel-path: EncodedFile}}`.
fn read_templates_tree(
    app: &tauri::AppHandle,
) -> Result<HashMap<String, HashMap<String, EncodedFile>>, String> {
    let root = templates_root(app)?;
    let mut out = HashMap::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let mut files = HashMap::new();
        collect_template_files(&path, &mut files)?;
        if !files.is_empty() {
            out.insert(name, files);
        }
    }
    Ok(out)
}

/// Recursively walks `dir`, filling `files` with relative (forward-slash) paths.
fn collect_template_files(
    dir: &Path,
    files: &mut HashMap<String, EncodedFile>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let rel = path
            .strip_prefix(dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if path.is_dir() {
            collect_template_files(&path, files)?;
        } else if path.is_file() {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            let file = match String::from_utf8(bytes) {
                Ok(text) => EncodedFile {
                    encoding: "utf8".to_string(),
                    content: text,
                },
                Err(raw) => EncodedFile {
                    encoding: "base64".to_string(),
                    content: base64::engine::general_purpose::STANDARD.encode(raw.into_bytes()),
                },
            };
            files.insert(rel, file);
        }
    }
    Ok(())
}

/// Writes a single imported template file under `dir`.
/// Returns 1 when written, 0 when skipped because the file already exists.
fn import_template_file(dir: &Path, rel: &str, file: &EncodedFile) -> Result<usize, String> {
    let dest = resolve_relative(dir, rel)?;
    if dest.exists() {
        return Ok(0);
    }

    let content = match file.encoding.as_str() {
        "utf8" => file.content.as_bytes().to_vec(),
        "base64" => base64::engine::general_purpose::STANDARD
            .decode(&file.content)
            .map_err(|_| format!("Contenu base64 invalide pour '{rel}'"))?,
        other => return Err(format!("Encodage inconnu '{other}' pour '{rel}'")),
    };

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, content).map_err(|e| e.to_string())?;
    Ok(1)
}

/// Joins `rel` (forward-slash separated, may contain subdirectories) onto
/// `dir`, rejecting traversal (`..`), empty segments and absolute paths.
fn resolve_relative(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut dest = dir.to_path_buf();
    for segment in rel.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(format!("Chemin invalide dans le template : '{rel}'"));
        }
        if Path::new(segment).components().count() != 1
            || !matches!(
                Path::new(segment).components().next(),
                Some(Component::Normal(_))
            )
        {
            return Err(format!("Chemin invalide dans le template : '{rel}'"));
        }
        dest.push(segment);
    }
    Ok(dest)
}
