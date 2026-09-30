# Release Notes

## Unreleased

### New / Fixes

- **Linux AppImage is back** : the AppImage is built and published again (`typst-ide-<version>-x86_64.AppImage`), fixed for modern distributions. The runtime now prefers the system `webkit2gtk-4.1` (like the `.deb`/`.rpm`), so the preview follows the editor cursor again on Wayland/Mesa systems, while falling back to the bundled WebKitGTK on hosts without it. It follows the AppImage conventions: host-owned libraries (Wayland, GL, ...) are not bundled, AppStream metadata and a proper `.desktop` are embedded, and update information (`gh-releases-zsync`) plus a `.zsync` are published for AppImageUpdate.
- **`manage.sh build`** now builds bundles: `./manage.sh build [appimage|deb|rpm|nsis|windows|all]`, with `--target` and a reproducible `--container` mode (Ubuntu 22.04 via podman/docker, the same base as the CI). On the host, `all` cross-compiles the Windows NSIS installer and portable executable with MinGW when the toolchain is installed; in the container, Windows is cross-compiled to MSVC with `cargo-xwin` (self-contained portable, CI parity) with no host dependency at all. See `docs/appimage.md` and `docs/windows-build.md`.

## v1.6.9

### Fixes

- **Split resize no longer gets stuck** : dragging the editor/preview handle stopped working as soon as the cursor crossed the preview iframe, which swallowed `mousemove`/`mouseup` (the drag stayed "pressed" until the pointer reached the toolbar). Iframe hit-testing is now disabled for the duration of the drag and the drag is cancelled when the window loses focus, so the handle follows the cursor everywhere and the preview can be shrunk freely.

## v1.6.8

### New in v1.6.8

- **Dark theme** : a "Dark theme" checkbox in the **Help** menu switches the whole interface (light remains the default). The palette is a soft slate blue rather than pure black; the Monaco editor background and syntax colors are aligned with it, and the preview window follows theme changes live. All UI colors were tokenized (no more hardcoded colors in CSS/JS), notepad included.

## v1.6.7

### New in v1.6.7

- **Preview in a separate window** : the compiled preview can be detached into its own window (checkbox in the **View** menu or toolbar button). The main window then gives all its space to the editor; closing the preview window (X or the "re-embed" button) restores the split layout, detected Rust-side so an abrupt close still restores it. The dedicated window has its own toolbar (zoom, compile, save PDF, re-embed), keeps click-to-source working, and reuses the saved webview zoom.
- **Windows portable executable** : the release CI now publishes, alongside the NSIS installer, the raw standalone `.exe` produced by the same build (no installation required).

### Improvements

- **Preview window chrome unified with the main window** : flat toolbar (no more card-like border/radius), rounded content panel, title `Typst IDE : Preview`.

### For developers

- `Cargo.lock` is now committed for reproducible builds.
- The disk-cache staleness test now uses contents of different lengths, so the (size, mtime) fingerprint always changes on filesystems with coarse mtime resolution (CI, tmpfs, NFS).

## v1.6.6

### New in v1.6.6

- **Configuration export / import** : the whole user configuration can be exported to a single JSON file and re-imported elsewhere (Help menu). The picker modal lets you include or exclude each section such as: Settings (theme, language, auto-compile, console options, editor font, webview zoom), Markers, Notes, History and local Templates ; and greys out the ones with nothing to share. Import is incremental and never destructive: notes and history merge without duplicates, existing template files are skipped, and unknown settings are ignored (forward-compatible format).

## v1.6.5

### Improvements

- **Much faster release builds** : the release profile used fat LTO (`lto = true`, `codegen-units = 1`), which deferred all cross-crate optimization to a single-threaded link phase. It now uses **thin LTO** (parallel) with the default codegen units, **`panic = "abort"`**, and the **`lld` linker** on Linux (via `.cargo/config.toml` and the `PKGBUILD`, with `lld` as a new makedependency). Measured cold release build: **~10 min → ~3 min 45 s** on a 8-core/16-thread machine with performance power mode (the slowest phase being mono-threaded, the gain is proportionally even larger on low-core machines).
- **Lighter font stack** : `font-kit` was replaced by `fontdb` (already in the dependency graph via `typst-kit`) for the `font_exists`/`suggest_font` commands, about **12 crates removed** (including two C libraries (`freetype`, `fontconfig`) that had to be compiled). `suggest_font` also no longer loads every font file to read family names, making font suggestions faster.

### For developers

- **Tradeoff to be aware of**: the release binary grew from ~47 MB to ~53 MB (+13%, still stripped) in exchange for the build speed.
- **Release profile now**: `opt-level = "z"`, `lto = "thin"`, `strip = true`, `panic = "abort"`.

## v1.6.4

### Fixes

- **Jump from the preview works again** : clicking a page in the preview jumps to the corresponding source line, the `allow-scripts` WebView setting was restored after it had silently disabled the click handler.


## v1.6.3

### New in v1.6.3
- **Renamed to "markers"** : the comment/keytag feature is now called **markers** everywhere (menus, marker book, manager, EN/FR translations).
- **Keyboard shortcuts** : `Ctrl + Shift + M` inserts a marker at the cursor, `Ctrl + Alt + M` opens the marker book. Both are reliable on French/ISO layouts where WebKitGTK swallows AltGr combinations (global capture with a keypress fallback and a double-fire guard).
- **Wider dropdown menus** : navbar dropdowns are large enough for label + shortcut key-caps (e.g. `ctrl alt M`) and their rows no longer wrap.

### Fixes

- **Decoration lifecycle** : marker highlights (and their stylesheet) are purged when the editor model is replaced or the editor is disposed, so no stale highlight survives a file switch.

### Internals

- **Refactor for testability** : pure modules extracted (`styles`, marker-book row builder, manager validation) and covered by new jsdom DOM tests (75 tests in total).

## v1.6.2

### New in v1.6.2

- **Context-aware marker detection** : markers are now found through the Monaco tokenizer, so `//` inside a string literal, an URL or raw code is never mistaken for a comment (no more false positives). Multi-line block comments (`/* … */`) are supported too, and the Monarch tokenizer now colors them correctly in the editor.
- **Visual markers** : the marker line is highlighted in the marker color with the tag in **bold**; a colored **dot** appears in the editor gutter (centered, never overflowing the row) and a **stripe** in the scrollbar; hovering the line shows the keyword and the marker message.

## v1.6.0

### New in v1.6.0

- **Markers (keytags)** : a modular comment-marker system. Write `// TODO: message` (or `/* FIXME: … */`) and Typst IDE recognizes it:
  - Five markers ship by default (`TODO`, `NOTE`, `COMMENT`, `FIXME`, `WARNING`), each with its own highlight color, fully customizable (keyword, label, color, enable/disable, reset to defaults).
  - Matching lines are highlighted, and the **marker book** (toolbar button or **Edit** menu) lists every marker of the current document: search, filter by marker, click to jump to the line.
  - **Add a marker** inserts `// KEYTAG: ` at the cursor (with a picker when several markers are enabled).
  - Marker lines also get a **glyph-margin dot** and a **scrollbar stripe**.

## v1.5.2

### Fixes

- **Images and imported files updated outside Typst IDE** : a file (image, module…) rewritten on disk by an external script or editor is detected and re-read, the persistent Typst world no longer serves stale cached bytes (size + modification-time check on every cache access). The preview also refreshes when the window regains focus, without requiring a keystroke.

## v1.5.1

### New in v1.5.1

- **PDF export** : the `.pdf` extension is appended automatically when the user only types a file name (and is not duplicated if already present).

### Improvements

- **Security/audit pass** : modal, history, notepad and bibliography windows are built with `textContent` instead of `innerHTML` (XSS hardening), a symlink-escape guard was added to file operations, and dead preview-worker code was removed.

### For developers

- **Tests + CI** : Rust unit/integration tests (via `tauri::test` mock apps), frontend unit tests (vitest), a PR CI workflow (build + tests) with clippy and `npm audit`, proper error handling replacing the database `.expect(...)` calls, and leftover debug `eprintln!` removed.

## v1.5.0

### New in v1.5.0

- **Tutorial (EN/FR)** : a 13-page interactive tutorial opens on first launch (welcome, projects, formatting, structures, images, preview, console, PDF export, notepad, files, bibliography, templates, keyboard shortcuts). Key UI elements are highlighted on screen while they are explained.
- **Enhanced Typst syntax highlighting** : the Monaco tokenizer was rewritten with a dedicated rule set for all Typst constructs (headings, math, code, comments, strings, markup…), giving a much richer highlight in the editor.
- **File manager polish** : the image preview thumbnail is now shown on the file name only, instead of the entire row.

### Improvements

- **Edits stay fluid while the document compiles** : preview DOM updates are now chunked (the SVG pages are written one batch at a time, yielding to the event loop in between), the compile-to-compile throttle gap adapts to the document size (100–400 ms), `invalidate_file_cache` no longer runs on the main thread, and the shared preview-world mutex is released before the SVG rendering phase. Typing during a recompilation is no longer blocked by the preview re-render.

### Internals

- **Bibliography without database** : the bibliography no longer lives in SQLite; entries are now read and written directly from/to the `.bib` files of the project. The bibliography database module was removed.

## v1.4.3

### New in v1.4.3

- **Rectangle dialog redesigned** : border and radius are now two independent settings (`border` + color picker, `radius` + unit selector), with more sensible defaults (no border by default, fill color set to black). The `%` unit no longer appears where it makes no sense.

### Fixes

- **Tailwind CSS finally works** : the app was compiled with the old Tailwind v3 directives; it now uses the v4 syntax (`@import "tailwindcss"`) with the daisyUI plugin, and the utility classes actually get generated. The inject-tailwind script keeps the `public/css/output.css` link working in the built app.

## v1.4.2

### New in v1.4.2

- **Insert an image with a caption (`#figure`)** : the structures dropdown (`#` menu) now includes a "figure" entry. Pick an image through a native, image-only file dialog (or type its path directly), get a live preview when your image is chosen, add a caption, and it inserts `#figure(image("images/..."), caption: [...])` at the cursor. The chosen image is copied into the project's `images/` folder (duplicate names are automatically deduplicated) and the inserted path always matches that location.
- **`manage.sh bump` with version keywords** : `./manage.sh bump major|minor|patch|premajor|preminor|prepatch|prerelease` now auto-increments the current version instead of requiring an explicit version string. Existing features (consistency check, `--dry-run`) still apply.

### Fixes

- The figure insert dialog no longer shows "not implemented".

## v1.4.1

### Fixes

- Tooltips of the structures (`#`) dropdown buttons now display correctly.

## v1.4.0

### New in v1.4.0

- **Templates** : browse, create, edit, rename and delete templates stored in a dedicated templates directory. Templates can gather a document set and, when applied to a project, they can import the associated `images/` and fonts folders. The library is searchable and the whole flow is available from the main menus.

### Already available

- Typst compilation with live preview (HTML, inline SVGs)
- PDF export
- Bibliography management (SQLite-backed sources and entries)
- Notepad with global and per-project notes, plus search
- Zoom for editor and preview
- Image paste into documents
- Insert table, grid, rectangle and figure (image with caption)
- Translated shortcuts (EN/FR)
- Packages for Debian/Ubuntu (`.deb`), Fedora/Red Hat (`.rpm`), Arch Linux (PKGBUILD) and Windows (NSIS installer)

## v1.3.0

Typst IDE is a modern, local-first Typst editor built with Tauri 2 and Rust, a fast and lightweight replacement for the old Electron-based Typst Studio. Write documents with live preview, everything stays on your machine.

### New in v1.3.0

- **File manager upgraded** : dynamic file tree, right-click actions (create, delete, rename, move, import), drag & drop, and file-type icons. The code is now split into small modules (`tree`, `operations`, `context-menu`, `drag-drop`, `state`, etc.) for easier maintenance.
- **External change detection** : if the currently open file is modified outside the IDE (VS Code, another editor, etc.), two buttons let you overwrite the external changes or reload the file from disk. Detection is done with a FNV-1a 64 hash, shared between Rust and the frontend.
- **Toolbar tooltips** : every toolbar button now has a tooltip (translated in English and French).
- **Improved compilation console** : new "show on error" option, plus a list of error messages you can choose to ignore (by expression) so recurring warnings stop auto-opening the console.
- **Uniformized i18n** : English and French translation data reorganized and deduplicated (FR first, EN aligned).

### For developers

- **Rust refactor** : the 900-line `main.rs` was split into dedicated `commands/` modules: `fs`, `db`, `preview`, `export`, `misc`, `bibliography`.
- **`manage.sh`** : new dev script for version info, version bump, checks (versions consistency, rustfmt, `cargo check`), tests, build and dev runs.
- **Git hooks** : `pre-commit` and `pre-push` hooks check version consistency and formatting before committing/pushing.

### Already available

- Typst compilation with live preview (HTML, inline SVGs)
- PDF export
- Bibliography management (SQLite-backed sources and entries)
- Notepad with global and per-project notes, plus search
- Zoom for editor and preview
- Image paste into documents
- Insert table, grid and rectangle
- Translated shortcuts (EN/FR)
- Packages for Debian/Ubuntu (`.deb`), Fedora/Red Hat (`.rpm`), Arch Linux (PKGBUILD) and Windows (NSIS installer)
