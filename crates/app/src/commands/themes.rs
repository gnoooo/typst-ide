// Theme files management.
//
// Themes are plain JSON files stored in `<app config dir>/themes/`.
// The frontend owns the color validation, this layer only enforces the file boundary
// (single `.json` file name, size limit, no symlinks) and the theme document envelope (`format` / `formatVersion`).

use std::path::{Component, Path, PathBuf};

use tauri::Manager;

const MAX_THEME_BYTES: u64 = 1024 * 1024;
const FORMAT_ID: &str = "typst-ide-color-scheme";
const FORMAT_VERSION: u64 = 1;
const THEMES_DIR: &str = "themes";
const README: &str = "\
Typst IDE themes
================

Each *.json file in this folder is a theme.

Format:
{
  \"$schema\": \"https://raw.githubusercontent.com/gnoooo/typst-ide/main/schemas/theme.schema.json\",
  \"format\": \"typst-ide-color-scheme\",
  \"formatVersion\": 1,
  \"name\": \"My theme\",
  \"light\": { \"--bg\": \"#...\", \"--text\": \"#...\" },
  \"dark\":  { \"--bg\": \"#...\", \"--text\": \"#...\" }
}

JSON Schema:
https://raw.githubusercontent.com/gnoooo/typst-ide/main/schemas/theme.schema.json

Add the \"$schema\" key above to get completion and validation in JSON editors.

`light` and `dark` are both optional. A missing variant is disabled in the
theme picker. Only existing color variables are accepted; values are colors
only (no url(...) or arbitrary CSS).
";

#[derive(serde::Serialize)]
pub struct ThemeFile {
    pub file: String,
    pub content: String,
}

/// Returns the themes directory, creating it and a short README if needed.
pub(crate) fn themes_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(THEMES_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    let readme = dir.join("README.txt");
    if !readme.exists() {
        let _ = std::fs::write(&readme, README);
    }
    Ok(dir)
}

/// A theme file name must be one normal path component ending in `.json`.
pub(crate) fn validate_theme_file(name: &str) -> Result<(), String> {
    if name.is_empty() || name == ".json" || name.len() > 200 {
        return Err("Invalid theme name.".to_string());
    }
    if !name.ends_with(".json") {
        return Err("Theme must be a .json file.".to_string());
    }
    if name
        .chars()
        .any(|c| c.is_control() || matches!(c, '/' | '\\'))
    {
        return Err("Invalid theme name.".to_string());
    }
    let path = Path::new(name);
    if path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err("Invalid theme name.".to_string());
    }
    Ok(())
}

fn theme_path(root: &Path, file: &str) -> Result<PathBuf, String> {
    validate_theme_file(file)?;
    Ok(root.join(file))
}

/// Reads a theme file. `Ok(None)` means the file does not exist.
pub(crate) fn read_theme_at(root: &Path, file: &str) -> Result<Option<String>, String> {
    let path = theme_path(root, file)?;
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(format!("{}: is not a theme file.", path.display()));
    }
    if meta.len() > MAX_THEME_BYTES {
        return Err(format!(
            "{}: theme too large ({} octets, maximum {MAX_THEME_BYTES}).",
            path.display(),
            meta.len()
        ));
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Lists readable `.json` theme files (sorted by file name).
pub(crate) fn list_themes_at(root: &Path) -> Result<Vec<ThemeFile>, String> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {e}", root.display())),
    };

    let mut themes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if validate_theme_file(&name).is_err() {
            continue;
        }
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_THEME_BYTES {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        themes.push(ThemeFile {
            file: name,
            content,
        });
    }
    themes.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(themes)
}

/// Writes a theme file atomically, validating the document envelope.
pub(crate) fn write_theme_at(root: &Path, file: &str, payload: &str) -> Result<(), String> {
    let path = theme_path(root, file)?;
    if payload.len() as u64 > MAX_THEME_BYTES {
        return Err(format!(
            "Theme too large ({} octets, maximum {MAX_THEME_BYTES}).",
            payload.len()
        ));
    }

    let doc: serde_json::Value =
        serde_json::from_str(payload).map_err(|e| format!("Invalid JSON: {e}"))?;
    if doc.get("format").and_then(|v| v.as_str()) != Some(FORMAT_ID) {
        return Err("Unknown theme format.".to_string());
    }
    if doc.get("formatVersion").and_then(|v| v.as_u64()) != Some(FORMAT_VERSION) {
        return Err("Unsupported theme version.".to_string());
    }

    std::fs::create_dir_all(root).map_err(|e| format!("{}: {e}", root.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("theme");
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_file_name(format!(".{name}.{}.{nonce}.tmp", std::process::id()));
    std::fs::write(&tmp, payload).map_err(|e| format!("{}: {e}", tmp.display()))?;
    match std::fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(format!("{}: {e}", path.display()))
        }
    }
}

#[tauri::command]
pub fn get_themes_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = themes_root(&app)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_themes(app: tauri::AppHandle) -> Result<Vec<ThemeFile>, String> {
    let root = themes_root(&app)?;
    list_themes_at(&root)
}

#[tauri::command]
pub fn read_theme(app: tauri::AppHandle, file: String) -> Result<Option<String>, String> {
    let root = themes_root(&app)?;
    read_theme_at(&root, &file)
}

#[tauri::command]
pub fn write_theme(app: tauri::AppHandle, file: String, payload: String) -> Result<(), String> {
    let root = themes_root(&app)?;
    write_theme_at(&root, &file, &payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const VALID: &str = r##"{
        "format": "typst-ide-color-scheme",
        "formatVersion": 1,
        "name": "Test",
        "light": { "--bg": "#ffffff" }
    }"##;

    #[test]
    fn validates_file_names() {
        assert!(validate_theme_file("default.json").is_ok());
        assert!(validate_theme_file("My theme.json").is_ok());
        assert!(validate_theme_file("../evil.json").is_err());
        assert!(validate_theme_file("sub/theme.json").is_err());
        assert!(validate_theme_file("theme.txt").is_err());
        assert!(validate_theme_file(".json").is_err());
    }

    #[test]
    fn writes_reads_and_lists_themes() {
        let root = tempdir().unwrap();
        write_theme_at(root.path(), "default.json", VALID).unwrap();
        assert_eq!(
            read_theme_at(root.path(), "default.json")
                .unwrap()
                .as_deref(),
            Some(VALID)
        );
        let themes = list_themes_at(root.path()).unwrap();
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].file, "default.json");
    }

    #[test]
    fn missing_theme_is_none() {
        let root = tempdir().unwrap();
        assert!(
            read_theme_at(root.path(), "missing.json")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn rejects_invalid_documents() {
        let root = tempdir().unwrap();
        assert!(write_theme_at(root.path(), "bad.json", "not json").is_err());
        assert!(
            write_theme_at(
                root.path(),
                "bad.json",
                r#"{"format":"other","formatVersion":1}"#
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn ignores_symlinks() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let target = outside.path().join("target.json");
        std::fs::write(&target, VALID).unwrap();
        std::os::unix::fs::symlink(&target, root.path().join("link.json")).unwrap();

        assert!(read_theme_at(root.path(), "link.json").is_err());
        assert!(list_themes_at(root.path()).unwrap().is_empty());
    }
}
