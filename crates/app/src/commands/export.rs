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
            .map(|p| ensure_pdf_extension(&p.to_string_lossy()))
    })
    .await
    .unwrap_or(None)
}

/// `rapport` -> `rapport.pdf` ; `rapport.PDF` / `rapport.Pdf` are kept as-is
/// (case-insensitive). Any other suffix is kept and `.pdf` appended, so the
/// resulting name always ends in `.pdf` exactly once.
fn ensure_pdf_extension(path: &str) -> String {
    if path.to_lowercase().ends_with(".pdf") {
        path.to_string()
    } else {
        format!("{path}.pdf")
    }
}

#[cfg(test)]
mod tests {
    use super::ensure_pdf_extension;

    #[test]
    fn pdf_extension_is_appended_when_missing() {
        assert_eq!(ensure_pdf_extension("rapport"), "rapport.pdf");
        assert_eq!(ensure_pdf_extension(""), ".pdf");
    }

    #[test]
    fn pdf_extension_is_kept_when_already_present() {
        assert_eq!(ensure_pdf_extension("doc.pdf"), "doc.pdf");
        assert_eq!(ensure_pdf_extension("Doc.PDF"), "Doc.PDF");
        assert_eq!(ensure_pdf_extension("DOC.Pdf"), "DOC.Pdf");
    }

    #[test]
    fn pdf_extension_is_appended_to_other_suffixes() {
        assert_eq!(ensure_pdf_extension("doc.txt"), "doc.txt.pdf");
        assert_eq!(ensure_pdf_extension("archive.tar.gz"), "archive.tar.gz.pdf");
    }
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
