// PDF export commands

use typst_ide_core::compiler::compile_to_pdf;

/// Opens a native "Enregistrer sous" dialog filtered to PDF files
/// Returns the chosen path as a string, or `null` if the user cancelled
#[tauri::command]
pub async fn pick_pdf_path() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Enregistrer en PDF")
            .add_filter("PDF", &["pdf"])
            .save_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .unwrap_or(None)
}

/// Compiles `source` to PDF and writes it to `path`
#[tauri::command]
pub async fn export_pdf(source: String, path: String, root: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = compile_to_pdf(root.as_deref(), &source)?;
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}