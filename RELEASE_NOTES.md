# Release Notes

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
