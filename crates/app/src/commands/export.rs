// PDF export commands

use typst_ide_core::compiler::compile_to_pdf;

use crate::state::PdfExportPathState;
use tauri::Manager;

/// Opens a native "Save as" dialog filtered to PDF files,
/// anchors the chosen path Rust-side (the only destination `export_pdf` will ever
/// write to) and returns it for display, or `null` if the user cancelled.
/// Calling it again re-anchors: the user can change the destination freely.
#[tauri::command]
pub async fn pick_pdf_path(app: tauri::AppHandle) -> Option<String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Enregistrer en PDF")
            .add_filter("PDF", &["pdf"])
            .save_file()
            .map(|p| ensure_pdf_extension(&p.to_string_lossy()))
    })
    .await
    .unwrap_or(None);

    if let Some(path) = &picked
        && let Some(state) = app.try_state::<PdfExportPathState>()
        && let Ok(mut anchor) = state.0.lock()
    {
        // The file usually does not exist yet, so canonicalize may fail:
        // fall back to the dialog path, whose directory was picked natively.
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.into());
        *anchor = Some(canonical);
    }
    picked
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

/// Compiles `source` to PDF and writes it to the Rust-anchored export path (set by `pick_pdf_path`).
/// No `path` comes from the frontend: a forged invoke cannot choose the destination,
/// and overwriting an existing file was already confirmed by the user through the native save dialog.
#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    source: String,
    root: Option<String>,
) -> Result<(), String> {
    let dest = {
        let state = app.state::<PdfExportPathState>();
        let anchor = state
            .0
            .lock()
            .map_err(|_| "Export state poisoned".to_string())?;
        anchor.clone().ok_or_else(|| {
            "Aucune destination d'export : utilisez « Exporter le PDF sous… »".to_string()
        })?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = compile_to_pdf(root.as_deref(), &source)?;
        typst_ide_core::fs::write_atomic(dest, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
