use std::env;
use std::fs;

use serde::Serialize;
use typst::diag::{SourceDiagnostic, Severity};
use typst::layout::PagedDocument;
use typst::World;
use typst_as_library::TypstWrapperWorld;
use typst_pdf::PdfOptions;
use typst_ide;

/// Returns the current working directory as a String, falling back to "."
fn current_dir() -> String {
    env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

/// A single Typst diagnostic with resolved source position, ready to be
/// serialized and sent to the frontend.
#[derive(Serialize, Clone)]
pub struct DiagnosticInfo {
    pub severity: String,   // "error" | "warning"
    pub message: String,
    pub hints: Vec<String>,
    pub line: Option<u32>,       // 1-based start line
    pub column: Option<u32>,     // 1-based start column
    pub end_line: Option<u32>,   // 1-based end line
    pub end_column: Option<u32>, // 1-based end column (exclusive)
}

/// Converts a byte offset in `text` to a 1-based (line, column) pair.
fn byte_to_line_col(text: &str, byte: usize) -> (u32, u32) {
    let safe = byte.min(text.len());
    let before = &text[..safe];
    let line = before.bytes().filter(|&b| b == b'\n').count() as u32;
    let col = before
        .rfind('\n')
        .map(|i| before[i + 1..].chars().count())
        .unwrap_or_else(|| before.chars().count()) as u32;
    (line + 1, col + 1)
}

/// Converts a slice of Typst diagnostics to serializable `DiagnosticInfo`s,
/// resolving each span to a line/column position in the source.
fn collect_diagnostics(
    diagnostics: &[SourceDiagnostic],
    world: &TypstWrapperWorld,
) -> Vec<DiagnosticInfo> {
    diagnostics
        .iter()
        .map(|d| {
            let severity = match d.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            }
            .to_string();
            let message = d.message.to_string();
            let hints: Vec<String> = d.hints.iter().map(|h| h.to_string()).collect();

            // Attempt to resolve the span to a line/column in the source file
            let positions = (|| -> Option<(u32, u32, u32, u32)> {
                let id = d.span.id()?;
                let source = world.source(id).ok()?;
                let range = source.range(d.span)?;
                let text = source.text();
                let (l, c) = byte_to_line_col(text, range.start);
                let (el, ec) = byte_to_line_col(text, range.end);
                Some((l, c, el, ec))
            })();

            let (line, column, end_line, end_column) = match positions {
                Some((l, c, el, ec)) => (Some(l), Some(c), Some(el), Some(ec)),
                None => (None, None, None, None),
            };

            DiagnosticInfo { severity, message, hints, line, column, end_line, end_column }
        })
        .collect()
}

/// Position in the rendered preview corresponding to a cursor position in the source.
#[derive(Serialize, Clone)]
pub struct JumpPos {
    pub page: usize,  // 1-based page number
    pub x: f64,       // x coordinate in pt
    pub y: f64,       // y coordinate in pt
}

/// Result returned by compile_to_preview_html, bundling the HTML and an optional
/// jump position so the frontend can scroll the preview to the current cursor.
#[derive(Serialize)]
pub struct PreviewResult {
    pub html: String,
    pub jump_pos: Option<JumpPos>,
}

/// Formats a slice of Typst diagnostics into a single user-facing string
/// (kept for compile_to_pdf which doesn't need structured output)
fn format_diagnostics(diagnostics: &[SourceDiagnostic]) -> String {
    diagnostics
        .iter()
        .map(|d| d.message.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Converts a Monaco-style cursor (1-based line, 1-based UTF-16 column) to a UTF-8 byte offset
/// in `text`. This is what `typst_ide::jump_from_cursor` expects.
fn monaco_pos_to_byte(text: &str, line: u32, column: u32) -> usize {
    // Advance to the start of the target line (1-based)
    let mut current_line = 1u32;
    let mut byte_pos = 0usize;
    for ch in text.chars() {
        if current_line == line { break; }
        byte_pos += ch.len_utf8();
        if ch == '\n' { current_line += 1; }
    }
    // Advance (column - 1) UTF-16 units within the line
    let line_text = &text[byte_pos..];
    let mut utf16_consumed = 0u32;
    let target_utf16 = column.saturating_sub(1);
    for ch in line_text.chars() {
        if ch == '\n' { break; }
        let ch_utf16 = ch.len_utf16() as u32;
        if utf16_consumed + ch_utf16 > target_utf16 { break; }
        utf16_consumed += ch_utf16;
        byte_pos += ch.len_utf8();
    }
    byte_pos
}

/// Creates a default world (paged target) with the given content
pub fn create_default_world(content: &str) -> TypstWrapperWorld {
    TypstWrapperWorld::new(current_dir(), content.to_owned())
}

/// Creates a world configured for HTML export (`Feature::Html` enabled)
pub fn create_html_world(content: &str) -> TypstWrapperWorld {
    TypstWrapperWorld::new_for_html(current_dir(), content.to_owned())
}

/// Creates a world rooted at a custom path
pub fn create_world_with_root(root: &str, content: &str) -> TypstWrapperWorld {
    TypstWrapperWorld::new(root.to_owned(), content.to_owned())
}

/// Compiles Typst source to a preview HTML document
///
/// Returns structured diagnostics on error so the frontend can display
/// squiggly underlines via Monaco's `setModelMarkers` API.
/// `root` should be the open project directory so that relative file paths
/// (images, imports…) are resolved against it instead of the process cwd.
pub fn compile_to_preview_html(root: Option<&str>, content: &str, cursor: Option<(u32, u32)>) -> Result<PreviewResult, Vec<DiagnosticInfo>> {
    let world = match root {
        Some(r) => create_world_with_root(r, content),
        None    => create_default_world(content),
    };

    let document: PagedDocument = typst::compile(&world)
        .output
        .map_err(|errors| collect_diagnostics(&errors, &world))?;

    // Compute the preview jump position corresponding to the editor cursor
    let jump_pos = cursor.and_then(|(line, col)| {
        let source = world.source(world.main()).ok()?;
        let offset = monaco_pos_to_byte(source.text(), line, col);
        // jump_from_cursor returns a Vec; take the first result (most relevant)
        typst_ide::jump_from_cursor(&document, &source, offset)
            .into_iter()
            .next()
            .map(|pos| JumpPos {
                page: pos.page.get(),
                x:    pos.point.x.to_pt(),
                y:    pos.point.y.to_pt(),
            })
    });

    let pages_html: String = document
        .pages
        .iter()
        .map(|page| format!("<div class=\"page\">{}\n</div>", typst_svg::svg(page)))
        .collect::<Vec<_>>()
        .join("\n");

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
      background: #d8d8d8;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1.5rem;
      gap: 1.5rem;
    }}
    .page {{
      background: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }}
    .page svg {{
      display: block;
    }}
  </style>
</head>
<body>
{pages_html}
</body>
</html>
"#
    );

    Ok(PreviewResult { html, jump_pos })
}

/// Compiles Typst source to raw PDF bytes
/// `root` should be the open project directory.
pub fn compile_to_pdf(root: Option<&str>, content: &str) -> Result<Vec<u8>, String> {
    let world = match root {
        Some(r) => create_world_with_root(r, content),
        None    => create_default_world(content),
    };
    let document: PagedDocument = typst::compile(&world)
        .output
        .map_err(|errors| format_diagnostics(&errors))?;
    
    typst_pdf::pdf(&document, &PdfOptions::default())
        .map_err(|errors| format_diagnostics(&errors))
}

/// Compiles a Typst document to PDF and writes it to the specified output path
pub fn compile(world: &TypstWrapperWorld, output: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    let document = typst::compile(world)
        .output
        .expect("Error compiling typst");

    let pdf = typst_pdf::pdf(&document, &PdfOptions::default()).expect("Error exporting PDF");
    fs::write(output, pdf).expect("Error writing PDF.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use pdf_extract::extract_text;

    #[test]
    fn test_compile() {
        let dir = tempdir().unwrap();
        let content = "= Writing a test".to_owned();
        
        let world = create_default_world(&content);
        let output_path = dir.path().join("test_output.pdf");
        
        let result = compile(&world, &output_path);
        assert!(result.is_ok());

        let extracted_text = extract_text(&output_path).expect("Error extracting text from PDF");
        assert!(extracted_text.contains("Writing a test"));
    }

}