use std::collections::HashMap;
use std::env;
#[cfg(test)]
use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use std::num::NonZeroUsize;
use typst::diag::{Severity, SourceDiagnostic};

use typst::World;
use typst::introspection::PagedPosition;
use typst::layout::{Frame, FrameItem, Point};
use typst::syntax::{LinkedNode, Side, Span, SyntaxKind};
use typst_as_library::TypstWrapperWorld;
use typst_ide::{Jump, jump_from_click};
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;

/// Returns the current working directory as a String, falling back to "."
fn current_dir() -> String {
    env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

// ## Persistent world cache ####################################################
//
// Keeps the TypstWrapperWorld alive between preview compilations.
// The world stores a HashMap of already-read files (imports, images, packages),
// so reusing it avoids redundant disk reads on every keystroke.
// When the project root changes the world is recreated from scratch.

static PREVIEW_WORLD: OnceLock<Mutex<Option<(TypstWrapperWorld, String)>>> = OnceLock::new();

fn preview_world_cache() -> &'static Mutex<Option<(TypstWrapperWorld, String)>> {
    PREVIEW_WORLD.get_or_init(|| Mutex::new(None))
}

// ## SVG page cache ############################################################
//
// Maps a 128-bit hash of each compiled Page to its rendered SVG string.
// On large documents with many static pages (title page, bibliography…),
// only pages that actually changed since the last compile are re-rendered.

static SVG_CACHE: OnceLock<Mutex<HashMap<u128, String>>> = OnceLock::new();

fn svg_cache() -> &'static Mutex<HashMap<u128, String>> {
    SVG_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A single Typst diagnostic with resolved source position, ready to be
/// serialized and sent to the frontend.
#[derive(Serialize, Clone)]
pub struct DiagnosticInfo {
    pub severity: String, // "error" | "warning"
    pub message: String,
    pub hints: Vec<String>,
    pub line: Option<u32>,       // 1-based start line
    pub column: Option<u32>,     // 1-based start column
    pub end_line: Option<u32>,   // 1-based end line
    pub end_column: Option<u32>, // 1-based end column (exclusive)
}

/// Converts a byte offset in `text` to a 1-based (line, column) pair.
/// Columns are counted in **UTF-16 code units** (Monaco's unit), not
/// Unicode code points. They agree for BMP characters and differ only for
/// astral characters (e.g. emoji), where one code point maps to two
/// UTF-16 units.
fn byte_to_line_col(text: &str, byte: usize) -> (u32, u32) {
    let safe = byte.min(text.len());
    let before = &text[..safe];
    let line = before.bytes().filter(|&b| b == b'\n').count() as u32;
    let col = before
        .rfind('\n')
        .map(|i| before[i + 1..].encode_utf16().count())
        .unwrap_or_else(|| before.encode_utf16().count()) as u32;
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
            let hints: Vec<String> = d.hints.iter().map(|h| h.v.to_string()).collect();

            // Attempt to resolve the span to a line/column in the source file
            let positions = (|| -> Option<(u32, u32, u32, u32)> {
                let id = d.span.id()?;
                let source = world.source(id).ok()?;
                let range = match d.span.get() {
                    typst::syntax::DiagSpanKind::Number { num, sub_range, .. } => {
                        source.range(num, sub_range)?
                    }
                    typst::syntax::DiagSpanKind::Range { range, .. } => range,
                    typst::syntax::DiagSpanKind::Detached => return None,
                };
                let text = source.text();
                let (l, c) = byte_to_line_col(text, range.start);
                let (el, ec) = byte_to_line_col(text, range.end);
                Some((l, c, el, ec))
            })();

            let (line, column, end_line, end_column) = match positions {
                Some((l, c, el, ec)) => (Some(l), Some(c), Some(el), Some(ec)),
                None => (None, None, None, None),
            };

            DiagnosticInfo {
                severity,
                message,
                hints,
                line,
                column,
                end_line,
                end_column,
            }
        })
        .collect()
}

/// Position in the rendered preview corresponding to a cursor position in the source.
#[derive(Serialize, Clone)]
pub struct JumpPos {
    pub page: usize, // 1-based page number
    pub x: f64,      // x coordinate in pt
    pub y: f64,      // y coordinate in pt
}

/// Per-phase timing breakdown for a single compilation, in milliseconds.
#[derive(Serialize, Clone)]
pub struct CompileTimings {
    /// Time to construct the Typst world (includes font cache warmup on first call)
    pub world_ms: u64,
    /// Time spent inside `typst::compile` (layout + rendering to document)
    pub compile_ms: u64,
    /// Time spent converting pages to SVG strings
    pub svg_ms: u64,
    /// Total wall-clock time for the whole function
    pub total_ms: u64,
}

/// A single rendered page returned by `compile_to_preview_html`.
/// The frontend uses `hash` to detect which pages actually changed between compilations
/// and skips DOM updates for unchanged pages, avoiding redundant browser re-renders.
#[derive(Serialize)]
pub struct RenderedPage {
    /// SVG markup for this page (just the `<svg>…</svg>` element, no wrapper div).
    pub svg: String,
    /// Hex-encoded 128-bit hash of the compiled `Page` struct.
    /// Stable across compilations as long as the page content is identical.
    pub hash: String,
}

/// Result returned by `compile_to_preview_html`.
#[derive(Serialize)]
pub struct PreviewResult {
    /// Individual rendered pages.  The frontend assembles the full HTML on first load
    /// and performs targeted per-div DOM updates on subsequent compilations.
    pub pages: Vec<RenderedPage>,
    pub jump_pos: Option<JumpPos>,
    pub timings: CompileTimings,
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
/// in `text`.
fn monaco_pos_to_byte(text: &str, line: u32, column: u32) -> usize {
    // Advance to the start of the target line (1-based)
    let mut current_line = 1u32;
    let mut byte_pos = 0usize;
    for ch in text.chars() {
        if current_line == line {
            break;
        }
        byte_pos += ch.len_utf8();
        if ch == '\n' {
            current_line += 1;
        }
    }
    // Advance (column - 1) UTF-16 units within the line
    let line_text = &text[byte_pos..];
    let mut utf16_consumed = 0u32;
    let target_utf16 = column.saturating_sub(1);
    for ch in line_text.chars() {
        if ch == '\n' {
            break;
        }
        let ch_utf16 = ch.len_utf16() as u32;
        if utf16_consumed + ch_utf16 > target_utf16 {
            break;
        }
        utf16_consumed += ch_utf16;
        byte_pos += ch.len_utf8();
    }
    byte_pos
}

/// Search a single frame for the glyph whose `glyph.span.1` (offset within span)
/// is closest to `target_offset`. Returns the distance and the position.
fn best_glyph_in_frame(frame: &Frame, span: Span, target_offset: u16) -> Option<(u16, Point)> {
    let mut best_global: Option<(u16, Point)> = None;

    for &(mut pos, ref item) in frame.items() {
        if let FrameItem::Group(group) = item {
            if let Some((dist, point)) = best_glyph_in_frame(&group.frame, span, target_offset) {
                let candidate = (dist, pos + point.transform(group.transform));
                if best_global.as_ref().is_none_or(|(d, _)| dist < *d) {
                    best_global = Some(candidate);
                }
            }
        } else if let FrameItem::Text(text) = item {
            for glyph in &text.glyphs {
                if glyph.span.0 == span {
                    let dist = target_offset.abs_diff(glyph.span.1);
                    if best_global.as_ref().is_none_or(|(d, _)| dist < *d) {
                        best_global = Some((dist, pos));
                    }
                }
                pos.x += glyph.x_advance.at(text.size);
            }
        }
    }

    best_global
}

/// Find the exact rendered position of the cursor in the document.
///
/// Unlike `typst_ide::jump_from_cursor` which matches by span identity only,
/// this function also matches the byte offset *within* the span (`glyph.span.1`),
/// giving precise cursor placement for multi-line text nodes that wrap across pages.
///
/// Critically, it examines ALL pages and picks the *closest* glyph match by
/// `glyph.span.1` distance — not the first page that happens to contain the span.
fn find_precise_cursor_position(
    document: &PagedDocument,
    source: &typst::syntax::Source,
    cursor: usize,
) -> Option<JumpPos> {
    let root = LinkedNode::new(source.root());

    let node = root
        .leaf_at(cursor, Side::Before)
        .filter(|n| matches!(n.kind(), SyntaxKind::Text | SyntaxKind::MathText))
        .or_else(|| {
            root.leaf_at(cursor, Side::After)
                .filter(|n| matches!(n.kind(), SyntaxKind::Text | SyntaxKind::MathText))
        })?;

    let span = node.span();
    let range = node.range();
    let target_offset = cursor.saturating_sub(range.start) as u16;

    // Search ALL pages, pick the one with the smallest glyph offset distance.
    let mut best: Option<(u16, usize, Point)> = None;

    for (page_idx, page) in document.pages().iter().enumerate() {
        if let Some((dist, point)) = best_glyph_in_frame(&page.frame, span, target_offset) {
            let is_better = best.as_ref().is_none_or(|(d, ..)| dist < *d);
            if is_better {
                best = Some((dist, page_idx, point));
            }
        }
    }

    let (_, page_idx, point) = best?;
    Some(JumpPos {
        page: page_idx + 1,
        x: point.x.to_pt(),
        y: point.y.to_pt(),
    })
}

/// Creates a default world (paged target) with the given content
pub fn create_default_world(content: &str) -> TypstWrapperWorld {
    TypstWrapperWorld::new(current_dir(), content.to_owned())
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
///
/// ## Performance optimisations
///
/// 1. **Persistent world**: the `TypstWrapperWorld` (which caches imported files,
///    package downloads, etc.) is kept alive in a global `Mutex` between calls.
///    On the same project root it is reused — only the main source is swapped via
///    `reset_source`.  When the root changes the world is recreated from scratch.
///
/// 2. **SVG page cache**: each compiled `Page` is hashed with `typst_utils::hash128`.
///    The SVG string for unchanged pages is returned from the cache without
///    calling `typst_svg::svg` again, which is the most expensive per-page step.
pub fn compile_to_preview_html(
    root: Option<&str>,
    content: &str,
    cursor: Option<(u32, u32)>,
) -> Result<PreviewResult, Vec<DiagnosticInfo>> {
    let t_total = Instant::now();

    let root_str = root.map(|r| r.to_owned()).unwrap_or_else(current_dir);

    // 1. Acquire / update the persistent world.
    //    The mutex guard is scoped to compile+diagnostics only and dropped
    //    BEFORE the SVG rendering phase, so a concurrent call to
    //    `invalidate_preview_file_cache` / `resolve_click` does not stall
    //    behind the whole compile+render pipeline.
    let t_world = Instant::now();
    let (document, jump_pos, world_ms, compile_ms) = {
        let mut world_guard = preview_world_cache().lock().unwrap();
        match world_guard.as_mut() {
            Some((world, cached_root)) if *cached_root == root_str => {
                // Same project root: update only the source; keep file cache warm.
                world.reset_source(content);
            }
            _ => {
                // First compile or root changed: create a fresh world.
                let new_world = create_world_with_root(&root_str, content);
                *world_guard = Some((new_world, root_str));
            }
        }
        let (world, _) = world_guard.as_mut().unwrap();
        let world_ms = t_world.elapsed().as_millis() as u64;

        // 2. Compile
        // comemo automatically memoizes internal typst functions (eval, layout…) using
        // `Tracked<World>` access tracking. Because we reuse the same world with a stable
        // FileId (via Source::replace), comemo can reuse results for unchanged parts of the
        // document. evict(30) keeps the cache bounded: entries not hit in 30 compilations
        // are evicted, preventing unbounded memory growth.
        let t_compile = Instant::now();
        let document: PagedDocument = typst::compile(world as &_)
            .output
            .map_err(|errors| collect_diagnostics(&errors, world))?;
        typst::comemo::evict(30);
        let compile_ms = t_compile.elapsed().as_millis() as u64;

        // Compute the preview jump position corresponding to the editor cursor
        let jump_pos = cursor.and_then(|(line, col)| {
            let source = world.source(world.main()).ok()?;
            let offset = monaco_pos_to_byte(source.text(), line, col);
            find_precise_cursor_position(&document, &source, offset)
        });

        (document, jump_pos, world_ms, compile_ms)
    };

    // 3. Render pages to SVG (with per-page cache)
    let t_svg = Instant::now();
    let mut svg_guard = svg_cache().lock().unwrap();
    let pages: Vec<RenderedPage> = document
        .pages()
        .iter()
        .map(|page| {
            let hash = typst_utils::hash128(page);
            let svg = svg_guard
                .entry(hash)
                .or_insert_with(|| {
                    typst_svg::svg(
                        page,
                        &typst_svg::SvgOptions {
                            render_bleed: false,
                            pretty: false,
                        },
                    )
                })
                .clone();
            RenderedPage {
                svg,
                hash: format!("{hash:032x}"),
            }
        })
        .collect();
    // Evict SVG cache entries for pages no longer in this document.
    let current_hashes: std::collections::HashSet<u128> =
        document.pages().iter().map(typst_utils::hash128).collect();
    svg_guard.retain(|k, _| current_hashes.contains(k));
    drop(svg_guard);
    let svg_ms = t_svg.elapsed().as_millis() as u64;

    let total_ms = t_total.elapsed().as_millis() as u64;
    Ok(PreviewResult {
        pages,
        jump_pos,
        timings: CompileTimings {
            world_ms,
            compile_ms,
            svg_ms,
            total_ms,
        },
    })
}

/// Result of resolving a click in the preview back to a source position.
#[derive(Serialize)]
pub struct ClickResult {
    pub line: u32,
    pub column: u32,
}

/// Resolves a click on the rendered preview to a source position.
///
/// Uses the persistent preview world (same cache as `compile_to_preview_html`).
/// The source is re-compiled to find the exact glyph under `(page, x, y)`;
/// comemo's memoization makes this near-instant when the source hasn't changed.
pub fn resolve_click(
    root: Option<&str>,
    content: &str,
    page: usize,
    x: f64,
    y: f64,
) -> Option<ClickResult> {
    let root_str = root.map(|r| r.to_owned()).unwrap_or_else(current_dir);
    let mut world_guard = preview_world_cache().lock().ok()?;
    let (world, cached_root) = world_guard.as_mut()?;

    // Ensure the world has the correct root and source.
    if *cached_root != root_str {
        return None;
    }
    world.reset_source(content);

    let document: PagedDocument = match typst::compile(world as &_).output {
        Ok(doc) => doc,
        Err(_) => return None,
    };
    let pos = PagedPosition {
        page: NonZeroUsize::new(page)?,
        point: Point::new(typst::layout::Abs::pt(x), typst::layout::Abs::pt(y)),
    };
    let jump = jump_from_click(world, &document, &pos)?;
    let (file_id, offset) = match jump {
        Jump::File(id, off) => (id, off),
        Jump::Url(_) | Jump::Position(_) => return None,
    };
    let source = world.source(file_id).ok()?;
    let (line, column) = byte_to_line_col(source.text(), offset);
    Some(ClickResult { line, column })
}

/// Clears the file cache of the persistent preview world.
///
/// Call this after the user saves a file that is imported by the main document
/// (e.g. a `.typ` module, an image, a data file) so that the next compilation
/// re-reads the updated content from disk.
pub fn invalidate_preview_file_cache() {
    if let Some(guard) = PREVIEW_WORLD.get()
        && let Ok(mut opt) = guard.lock()
        && let Some((world, _)) = opt.as_mut()
    {
        world.reset_files();
    }
}

/// Compiles Typst source to raw PDF bytes
/// `root` should be the open project directory.
pub fn compile_to_pdf(root: Option<&str>, content: &str) -> Result<Vec<u8>, String> {
    let world = match root {
        Some(r) => create_world_with_root(r, content),
        None => create_default_world(content),
    };
    let document: PagedDocument = typst::compile(&world)
        .output
        .map_err(|errors| format_diagnostics(&errors))?;

    typst_pdf::pdf(&document, &PdfOptions::default()).map_err(|errors| format_diagnostics(&errors))
}

/// Compiles a Typst document to PDF and writes it to the specified output path
/// (test-only; kept here because it documents the canonical end-to-end
///  flow and avoids duplicating the wiring in the test body.)
#[cfg(test)]
fn compile(
    world: &TypstWrapperWorld,
    output: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let document = typst::compile(world).output.expect("Error compiling typst");

    let pdf = typst_pdf::pdf(&document, &PdfOptions::default()).expect("Error exporting PDF");
    fs::write(output, pdf).expect("Error writing PDF.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_extract::extract_text;
    use tempfile::tempdir;

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

    #[test]
    fn byte_to_line_col_uses_utf16_units() {
        // Monaco uses UTF-16 columns. The previous implementation used
        // Unicode chars, which differs for astral characters (emoji etc.)
        // that take two UTF-16 code units. Lock in the UTF-16 contract.
        let text = "ab😀cd"; // '😀' (U+1F600) = 4 UTF-8 bytes, 2 UTF-16 units
        let (line, col_before) = byte_to_line_col(text, 2); // before the emoji
        assert_eq!((line, col_before), (1, 3)); // 1-based, col 3
        let (line, col_after) = byte_to_line_col(text, 6); // after the emoji
        assert_eq!((line, col_after), (1, 5)); // +2 UTF-16 units
    }
}
