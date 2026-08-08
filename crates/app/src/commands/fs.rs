// File system / project management commands

use crate::state::HistoryDbState;
use serde::Serialize;
use typst_ide_core::database::history_db;

/// Opens a native folder picker dialog and returns the selected path, or `null` if cancelled
#[tauri::command]
pub async fn open_folder_dialog() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Sélectionner un dossier")
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .unwrap_or(None)
}

/// Creates a new project directory with an optional content in `main.typ` file inside
/// Add an entry to the history database for this project
/// Returns the full path of the created project folder
#[tauri::command]
pub async fn create_project(
    state: tauri::State<'_, HistoryDbState>,
    name: String,
    base_path: String,
    content: Option<String>,
) -> Result<String, String> {
    let project_path = std::path::PathBuf::from(&base_path).join(&name);
    std::fs::create_dir_all(&project_path).map_err(|e| e.to_string())?;
    let typ_path = project_path.join("main.typ");
    if !typ_path.exists() {
        std::fs::write(&typ_path, content.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
    }
    // Add an entry to the history database
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        history_db::add_entry(&conn, &name, &project_path.to_string_lossy())
            .map_err(|e| e.to_string())?;
    }

    Ok(project_path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
pub struct ProjectInfo {
    name: String,
    path: String,
    typ_file: String,
    content: String,
}

/// Opens an existing project directory: finds the first `.typ` file and returns its content
#[tauri::command]
pub async fn open_project(dir_path: String) -> Result<ProjectInfo, String> {
    let dir = std::path::PathBuf::from(&dir_path);
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let typ_path = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().map_or(false, |ext| ext == "typ"))
        .ok_or_else(|| "Aucun fichier .typ trouvé dans ce dossier.".to_string())?;

    let content = std::fs::read_to_string(&typ_path).map_err(|e| e.to_string())?;
    let name = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let typ_file = typ_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    Ok(ProjectInfo {
        name,
        path: dir_path,
        typ_file,
        content,
    })
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Writes `content` to the file at `path`, creating intermediate directories if needed
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    /// Relative path from the project root (e.g. "images/photo.png")
    relative_path: String,
    is_dir: bool,
    size: u64,
    extension: String,
}

/// Lists all files and directories recursively inside `dir_path`.
/// Returns a flat list; the frontend builds the tree from relative paths.
#[tauri::command]
pub fn list_directory(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let root = std::path::PathBuf::from(&dir_path);
    if !root.is_dir() {
        return Err("Le chemin n'est pas un dossier.".to_string());
    }
    let mut entries = Vec::new();
    collect_entries(&root, &root, &mut entries)?;
    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });
    Ok(entries)
}

fn collect_entries(
    root: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<FileEntry>,
) -> Result<(), String> {
    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Skip hidden files/dirs that start with '.'
        if name.starts_with('.') {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        let ext = if path.is_file() {
            path.extension()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        } else {
            String::new()
        };
        out.push(FileEntry {
            name,
            relative_path: relative,
            is_dir: path.is_dir(),
            size: metadata.len(),
            extension: ext,
        });
        if path.is_dir() {
            collect_entries(root, &path, out)?;
        }
    }
    Ok(())
}

/// Creates a directory (including parents if needed)
#[tauri::command]
pub fn create_dir(dir_path: String) -> Result<(), String> {
    std::fs::create_dir_all(&dir_path).map_err(|e| e.to_string())
}

/// Deletes a file or directory (recursively)
#[tauri::command]
pub fn delete_file_or_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// Computes the FNV-1a 64-bit hash of a file's content (hex, 16 chars).
/// Used to detect external modifications of the file being edited.
#[tauri::command]
pub fn file_hash(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let hash = bytes.iter().fold(0xcbf29ce484222325_u64, |h, &b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    });
    Ok(format!("{hash:016x}"))
}

/// Reads an image file and returns it as a base64 data URL
#[tauri::command]
pub fn read_image_as_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Infer MIME type from extension
    let ext = std::path::Path::new(&path)
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" | "svgz" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Opens a native file picker (multi-select), copies selected files into `dest_dir`.
/// Returns the list of filenames that were copied.
#[tauri::command]
pub async fn import_file_dialog(dest_dir: String) -> Result<Vec<String>, String> {
    let files = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Importer des fichiers")
            .pick_files()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Aucun fichier sélectionné.".to_string())?;

    let dest = std::path::PathBuf::from(&dest_dir);
    let mut imported = Vec::new();
    for src_path in &files {
        let name = src_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let dest_path = dest.join(&name);
        std::fs::copy(src_path, &dest_path)
            .map_err(|e| format!("Impossible de copier {} : {}", name, e))?;
        imported.push(name);
    }
    Ok(imported)
}

/// Opens a native file picker (multi-select) without copying anything.
/// Returns the absolute paths of the selected files.
#[tauri::command]
pub async fn pick_files() -> Result<Vec<String>, String> {
    let files = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Sélectionner des fichiers")
            .pick_files()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Aucun fichier sélectionné.".to_string())?;

    Ok(files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// Opens a native folder picker and copies the selected folder (keeping its
/// name) into `dest_dir`. Returns the name of the imported folder.
#[tauri::command]
pub async fn import_folder_dialog(dest_dir: String) -> Result<String, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Importer un dossier")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Aucun dossier sélectionné.".to_string())?;

    let name = folder
        .file_name()
        .ok_or_else(|| "Nom de dossier invalide.".to_string())?
        .to_string_lossy()
        .into_owned();
    copy_dir_recursive(&folder, &std::path::PathBuf::from(&dest_dir).join(&name))?;
    Ok(name)
}

/// Recursively copies a source directory into `dest` (which is created).
pub(crate) fn copy_dir_recursive(
    src: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            std::fs::copy(&path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Opens a native single-file picker and replaces the content of `path`
/// with the chosen file (the target name/path is kept).
/// Returns the chosen file name, or an error if cancelled.
#[tauri::command]
pub async fn replace_file(path: String) -> Result<String, String> {
    let src = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Remplacer le fichier")
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Aucun fichier sélectionné.".to_string())?;

    let name = src
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    std::fs::copy(&src, &path).map_err(|e| format!("Impossible de remplacer {} : {}", name, e))?;
    Ok(name)
}

/// Reveals a file or folder in the OS file manager.
#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::PathBuf::from(&path);
        let target = if p.is_file() {
            p.parent().unwrap_or(&p).to_path_buf()
        } else {
            p.clone()
        };

        #[cfg(target_os = "windows")]
        {
            let dir_arg = format!("/select,{}", path);
            std::process::Command::new("explorer")
                .arg(&dir_arg)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            let res = if p.is_file() {
                std::process::Command::new("open")
                    .arg("-R")
                    .arg(&path)
                    .spawn()
            } else {
                std::process::Command::new("open").arg(&path).spawn()
            };
            res.map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&target)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let _ = target;
            return Err("Système d'exploitation non supporté.".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Saves a `data:image/...;base64,...` payload as a file in `<project>/images/`
/// Returns the relative path to use in Typst (e.g. `images/pasted-123.png`)
#[tauri::command]
pub async fn save_data_image(project_path: String, data_url: String) -> Result<String, String> {
    use base64::Engine;
    use std::time::{SystemTime, UNIX_EPOCH};

    const PREFIX: &str = "data:image/";
    if !data_url.starts_with(PREFIX) {
        return Err("Format invalide: image data URL attendue".to_string());
    }

    let remainder = &data_url[PREFIX.len()..];
    let (raw_ext, base64_payload) = remainder
        .split_once(";base64,")
        .ok_or_else(|| "Format invalide: ';base64,' manquant".to_string())?;

    if raw_ext.trim().is_empty() {
        return Err("Format invalide: extension image manquante".to_string());
    }

    let ext = match raw_ext.trim().to_ascii_lowercase().as_str() {
        "jpeg" => "jpg".to_string(),
        "svg+xml" => "svg".to_string(),
        other => other
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect(),
    };

    let cleaned_b64: String = base64_payload
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cleaned_b64)
        .map_err(|e| format!("Base64 invalide: {e}"))?;

    let images_dir = std::path::Path::new(&project_path).join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    for idx in 0..1000 {
        let filename = if idx == 0 {
            format!("pasted-{ts}.{ext}")
        } else {
            format!("pasted-{ts}-{idx}.{ext}")
        };

        let full_path = images_dir.join(&filename);
        if !full_path.exists() {
            std::fs::write(&full_path, &bytes).map_err(|e| e.to_string())?;
            return Ok(format!("images/{filename}"));
        }
    }

    Err("Impossible de créer un nom de fichier unique pour l'image".to_string())
}
