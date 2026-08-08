// Local templates management commands
//
// Templates are stored in the OS config directory, under a `templates/` subfolder:
//   Linux:   ~/.config/com.typst.ide/templates/
//   Windows: %APPDATA%\com.typst.ide\templates\
//
// Each template lives in its own directory:
//   templates/<name>/lib.typ      mandatory entry file of the template
//   templates/<name>/test.typ     optional example usage
//   templates/<name>/images/      dedicated images
//   templates/<name>/fonts/       optional fonts (stored/copied, but not loaded by the compiler)

use std::path::{Path, PathBuf};
use tauri::Manager;

/// Returns the absolute path of the templates root directory, creating it if needed.
fn templates_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("templates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Validates a template name: must be a single path component, without separators
/// or traversal sequences, and without characters invalid on common file systems.
fn validate_template_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Le nom du template est vide.".to_string());
    }
    if name == "." || name == ".." {
        return Err("Nom de template invalide.".to_string());
    }
    if name
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return Err("Le nom du template contient des caractères invalides.".to_string());
    }
    Ok(())
}

/// Returns the directory of a single template, after validating its name.
fn template_dir(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    validate_template_name(name)?;
    Ok(templates_root(app)?.join(name))
}

#[derive(serde::Serialize)]
pub struct TemplateInfo {
    name: String,
    has_lib: bool,
    has_test: bool,
    has_images: bool,
    has_fonts: bool,
}

/// Returns the absolute path of the templates root folder.
#[tauri::command]
pub fn get_templates_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = templates_root(&app)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Lists every template in the templates directory.
#[tauri::command]
pub fn list_templates(app: tauri::AppHandle) -> Result<Vec<TemplateInfo>, String> {
    let root = templates_root(&app)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let tdir = entry.path();
        if !tdir.is_dir() {
            continue;
        }
        out.push(TemplateInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            has_lib: tdir.join("lib.typ").is_file(),
            has_test: tdir.join("test.typ").is_file(),
            has_images: tdir.join("images").is_dir(),
            has_fonts: tdir.join("fonts").is_dir(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Creates a new template directory with `lib.typ` (and optional `test.typ`),
/// plus the `images/` and `fonts/` subfolders. Optional `images`/`fonts` lists
/// contain absolute source paths copied into the corresponding subfolders.
#[tauri::command]
pub fn create_template(
    app: tauri::AppHandle,
    name: String,
    lib_typ: String,
    test_typ: Option<String>,
    images: Option<Vec<String>>,
    fonts: Option<Vec<String>>,
) -> Result<(), String> {
    let dir = template_dir(&app, &name)?;
    if dir.exists() {
        return Err(format!("Un template '{}' existe déjà.", name));
    }
    std::fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.join("fonts")).map_err(|e| e.to_string())?;
    write_template_files(&dir, &lib_typ, test_typ.as_deref())?;
    if let Some(files) = images {
        copy_assets(&dir.join("images"), &files)?;
    }
    if let Some(files) = fonts {
        copy_assets(&dir.join("fonts"), &files)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct TemplateContent {
    lib_typ: String,
    test_typ: Option<String>,
}

/// Reads the content of `lib.typ` (and `test.typ` if present) for editing.
#[tauri::command]
pub fn read_template(app: tauri::AppHandle, name: String) -> Result<TemplateContent, String> {
    let dir = template_dir(&app, &name)?;
    if !dir.exists() {
        return Err(format!("Template '{}' introuvable.", name));
    }
    let lib_typ = std::fs::read_to_string(dir.join("lib.typ")).map_err(|e| e.to_string())?;
    let test_typ = match std::fs::read_to_string(dir.join("test.typ")) {
        Ok(content) => Some(content),
        Err(_) => None,
    };
    Ok(TemplateContent { lib_typ, test_typ })
}

/// Updates the content of `lib.typ` and `test.typ` of an existing template.
/// Passing `None` for `test_typ` removes any existing `test.typ`.
#[tauri::command]
pub fn update_template(
    app: tauri::AppHandle,
    name: String,
    lib_typ: String,
    test_typ: Option<String>,
) -> Result<(), String> {
    let dir = template_dir(&app, &name)?;
    if !dir.exists() {
        return Err(format!("Template '{}' introuvable.", name));
    }
    write_template_files(&dir, &lib_typ, test_typ.as_deref())?;
    Ok(())
}

/// Renames a template directory.
#[tauri::command]
pub fn rename_template(
    app: tauri::AppHandle,
    name: String,
    new_name: String,
) -> Result<(), String> {
    let root = templates_root(&app)?;
    let old = root.join(&name);
    let new = template_dir(&app, &new_name)?;
    if !old.exists() {
        return Err(format!("Template '{}' introuvable.", name));
    }
    if new.exists() {
        return Err(format!("Un template '{}' existe déjà.", new_name));
    }
    std::fs::rename(&old, &new).map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes a template directory and all its content.
#[tauri::command]
pub fn delete_template(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = template_dir(&app, &name)?;
    if !dir.exists() {
        return Err(format!("Template '{}' introuvable.", name));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(())
}

/// Copies the full template folder (keeping its original name) into `dest_dir`,
/// so it can be imported from a project via `#import "<name>/lib.typ": *`.
/// If the destination folder already exists and `overwrite` is true, it is
/// removed first (re-inserting the template updates it in the project).
/// Returns the path of the copied folder.
#[tauri::command]
pub fn copy_template_to_project(
    app: tauri::AppHandle,
    template_name: String,
    dest_dir: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let src = template_dir(&app, &template_name)?;
    if !src.exists() {
        return Err(format!("Template '{}' introuvable.", template_name));
    }
    let dest = PathBuf::from(&dest_dir).join(&template_name);
    if dest.exists() {
        if !overwrite.unwrap_or(false) {
            return Err(format!(
                "Le dossier '{}' existe déjà dans le projet.",
                template_name
            ));
        }
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    crate::commands::fs::copy_dir_recursive(&src, &dest)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Writes `lib.typ` (mandatory) and, depending on `test_typ`,
/// writes or removes `test.typ`.
fn write_template_files(dir: &Path, lib_typ: &str, test_typ: Option<&str>) -> Result<(), String> {
    std::fs::write(dir.join("lib.typ"), lib_typ).map_err(|e| e.to_string())?;
    match test_typ {
        Some(test) => {
            std::fs::write(dir.join("test.typ"), test).map_err(|e| e.to_string())?;
        }
        None => {
            let _ = std::fs::remove_file(dir.join("test.typ"));
        }
    }
    Ok(())
}

/// Copies absolute source paths (files or folders) into `dest_dir`.
/// Files keep their filename, folders are copied as-is (name preserved).
/// Existing entries with the same name are overwritten.
fn copy_assets(dest_dir: &Path, paths: &[String]) -> Result<(), String> {
    for src in paths {
        let src_path = Path::new(src);
        if !src_path.exists() {
            return Err(format!("Chemin introuvable : {}", src));
        }
        let name = src_path
            .file_name()
            .ok_or_else(|| format!("Nom de chemin invalide : {}", src))?;
        if src_path.is_dir() {
            crate::commands::fs::copy_dir_recursive(src_path, &dest_dir.join(name))?;
        } else {
            std::fs::copy(src_path, dest_dir.join(name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
