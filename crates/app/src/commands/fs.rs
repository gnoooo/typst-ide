// File system / project management commands

use crate::state::HistoryDbState;
use serde::Serialize;
use tauri::Manager;
use typst_ide_core::database::history_db;

/// Returns `Ok(canonical)` if `path` resolves (and stays) inside one of the
/// `roots`. Used to restrict destructive file-system commands to the
/// project directory and template roots — even if the frontend
/// (`withGlobalTauri: true`) is compromised, an XSS payload cannot escape
/// the project's working area.
///
/// Symlinks pointing outside the roots are rejected because `canonicalize`
/// resolves them. Canonicalize failures (path does not exist yet) are
/// tolerated only if the deepest *existing* ancestor resolves inside the
/// roots — this defeats `projet/lien -> /etc` followed by a write to
/// `lien/x.txt` (the leaf doesn't exist, so a naive lexical prefix check
/// would happily let the write through and create `/etc/x.txt`).
#[allow(dead_code)]
pub fn assert_within(
    path: &std::path::Path,
    roots: &[&std::path::Path],
) -> Result<std::path::PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Empty path".to_string());
    }

    // Preferred path: the target already exists. Canonicalize resolves
    // every symlink in it, so a hit means it really is inside a root.
    if let Ok(canonical) = std::fs::canonicalize(path) {
        for root in roots {
            if let Ok(canon_root) = std::fs::canonicalize(root) {
                if canonical.starts_with(&canon_root) {
                    return Ok(canonical);
                }
            }
        }
        let display = canonical.to_string_lossy().into_owned();
        return Err(format!("Path '{display}' is outside the allowed roots"));
    }

    // The target does not exist yet (about to be created). Resolve the
    // deepest ancestor that exists and require IT to be inside a root —
    // comparing the raw lexical path could be tricked by a symlink
    // component (e.g. `projet/lien -> /outside`).
    let mut ancestor = path.to_path_buf();
    while !ancestor.exists() && ancestor.pop() {}
    if let Ok(canonical) = std::fs::canonicalize(&ancestor) {
        for root in roots {
            if let Ok(canon_root) = std::fs::canonicalize(root) {
                if canonical.starts_with(&canon_root) {
                    return Ok(canonical);
                }
            }
        }
    }
    let display = path.to_string_lossy().into_owned();
    Err(format!("Path '{display}' is outside the allowed roots"))
}

/// Returns the list of FS roots a destructive/read command is allowed to
/// touch, given an optional current project root.
///
/// The app's data directory is always allowed (templates, saved history,
/// etc. live there). The project root is added when provided — so a
/// compromised frontend can still only touch the project the user
/// currently has open, not `/etc` or `~/Documents`.
pub fn allowed_roots(
    app: &tauri::AppHandle,
    project_root: Option<&str>,
) -> Vec<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(data_dir) = app.path().app_data_dir() {
        roots.push(data_dir);
    }
    if let Ok(config_dir) = app.path().app_config_dir() {
        roots.push(config_dir);
    }
    if let Some(p) = project_root {
        let pb = std::path::PathBuf::from(p);
        if !pb.as_os_str().is_empty() {
            roots.push(pb);
        }
    }
    roots
}

fn path_components(name: &str) -> impl Iterator<Item = &str> {
    name.split(['/', '\\']).filter(|s| !s.is_empty())
}

/// Rejects names that would escape the parent directory when joined to it
/// (`..`, absolute paths, embedded separators). Mirrors the frontend
/// `INVALID_NAME` regex but rejects `..` which the regex lets through.
pub fn validate_name_segment(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("Invalid name '{name}'"));
    }
    if path_components(name).count() != 1 {
        return Err(format!("Name '{name}' must not contain path separators"));
    }
    for c in name.chars() {
        if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\0') {
            return Err(format!("Name '{name}' contains a forbidden character"));
        }
    }
    Ok(())
}

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
    // Reject `.`, `..`, separators, and absolute paths. The frontend
    // `INVALID_NAME` regex blocks separators but lets `..` through;
    // validate here on the backend so a compromised frontend cannot create
    // files outside `base_path`.
    validate_name_segment(&name)?;

    let base = std::path::PathBuf::from(&base_path);
    let project_path = base.join(&name);
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
pub fn read_file(
    app: tauri::AppHandle,
    path: String,
    project_root: Option<String>,
) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(p, &root_refs)?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Writes `content` to the file at `path`, creating intermediate directories if needed
#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
    project_root: Option<String>,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(p, &root_refs)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_file(
    app: tauri::AppHandle,
    old_path: String,
    new_path: String,
    project_root: Option<String>,
) -> Result<(), String> {
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(std::path::Path::new(&old_path), &root_refs)?;
    assert_within(std::path::Path::new(&new_path), &root_refs)?;
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
pub fn list_directory(
    app: tauri::AppHandle,
    dir_path: String,
    project_root: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let root = std::path::PathBuf::from(&dir_path);
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(&root, &root_refs)?;
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
            .into_owned()
            // Normalize to forward slashes so the JS frontend (which uses
            // `split('/')`, `lastIndexOf('/')` and `startsWith(folder + '/')`
            // on `relative_path`) works on Windows too — `Path::strip_prefix`
            // yields OS-native separators (backslashes on Windows), which
            // collapses the file-manager tree into a flat list.
            .replace('\\', "/");
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
pub fn create_dir(
    app: tauri::AppHandle,
    dir_path: String,
    project_root: Option<String>,
) -> Result<(), String> {
    let p = std::path::Path::new(&dir_path);
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(p, &root_refs)?;
    std::fs::create_dir_all(p).map_err(|e| e.to_string())
}

/// Deletes a file or directory (recursively)
#[tauri::command]
pub fn delete_file_or_dir(
    app: tauri::AppHandle,
    path: String,
    project_root: Option<String>,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(p, &root_refs)?;
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
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
pub fn read_image_as_base64(
    app: tauri::AppHandle,
    path: String,
    project_root: Option<String>,
) -> Result<String, String> {
    use base64::Engine;
    let p = std::path::Path::new(&path);
    let roots: Vec<std::path::PathBuf> = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(p, &root_refs)?;
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    // Infer MIME type from extension
    let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
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
pub async fn import_file_dialog(
    app: tauri::AppHandle,
    dest_dir: String,
    project_root: Option<String>,
) -> Result<Vec<String>, String> {
    let dest_pb = std::path::PathBuf::from(&dest_dir);
    let roots = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(&dest_pb, &root_refs)?;

    let files = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Importer des fichiers")
            .pick_files()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Aucun fichier sélectionné.".to_string())?;

    let mut imported = Vec::new();
    for src_path in &files {
        let name = src_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let dest_path = dest_pb.join(&name);
        std::fs::copy(src_path, &dest_path)
            .map_err(|e| format!("Impossible de copier {} : {}", name, e))?;
        imported.push(name);
    }
    Ok(imported)
}

/// Opens a native image picker, copies the selected image into
/// `<project>/images/` (created if missing) and returns its relative path.
/// If a file with the same name already exists, a numeric suffix is added
/// (e.g. `image (1).png`).
#[tauri::command]
pub async fn import_image_dialog(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<String, String> {
    let project_pb = std::path::PathBuf::from(&project_path);
    let roots = allowed_roots(&app, Some(&project_path));
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(&project_pb, &root_refs)?;

    let file = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choisir une image")
            .add_filter(
                "Images",
                &["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico"],
            )
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Aucune image sélectionnée.".to_string())?;

    let images_dir = project_pb.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let name = file
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let mut dest_path = images_dir.join(&name);
    let mut counter = 1;
    while dest_path.exists() {
        let stem = file.file_stem().unwrap_or_default().to_string_lossy();
        let ext = file.extension().unwrap_or_default().to_string_lossy();
        dest_path = images_dir.join(format!("{stem} ({counter}).{ext}"));
        counter += 1;
    }

    std::fs::copy(&file, &dest_path).map_err(|e| format!("Impossible de copier {name} : {e}"))?;

    Ok(dest_path
        .strip_prefix(&std::path::PathBuf::from(&project_path))
        .unwrap_or(&dest_path)
        .to_string_lossy()
        .into_owned()
        // Normalize to forward slashes — see comment in `collect_entries`.
        .replace('\\', "/"))
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
pub async fn import_folder_dialog(
    app: tauri::AppHandle,
    dest_dir: String,
    project_root: Option<String>,
) -> Result<String, String> {
    let dest_pb = std::path::PathBuf::from(&dest_dir);
    let roots = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(&dest_pb, &root_refs)?;

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
    copy_dir_recursive(
        &folder,
        &dest_pb.join(&name),
    )?;
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
pub async fn replace_file(
    app: tauri::AppHandle,
    path: String,
    project_root: Option<String>,
) -> Result<String, String> {
    let dest_pb = std::path::PathBuf::from(&path);
    let roots = allowed_roots(&app, project_root.as_deref());
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(&dest_pb, &root_refs)?;

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
    std::fs::copy(&src, &dest_pb)
        .map_err(|e| format!("Impossible de remplacer {} : {}", name, e))?;
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
pub async fn save_data_image(
    app: tauri::AppHandle,
    project_path: String,
    data_url: String,
) -> Result<String, String> {
    use base64::Engine;
    use std::time::{SystemTime, UNIX_EPOCH};

    const PREFIX: &str = "data:image/";
    if !data_url.starts_with(PREFIX) {
        return Err("Format invalide: image data URL attendue".to_string());
    }

    // Validate the project root before doing any work. The path is then
    // constrained to `<project>/images/...` so the scoping is preserved
    // by construction even if `project_path` were a symlink to /etc.
    let project_pb = std::path::PathBuf::from(&project_path);
    let roots = allowed_roots(&app, Some(&project_path));
    let root_refs: Vec<&std::path::Path> = roots.iter().map(|r| r.as_path()).collect();
    assert_within(&project_pb, &root_refs)?;

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
