# Release Notes

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
