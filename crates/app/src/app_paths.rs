//! TEMPORARY MIGRATION (tag: `temp-migration-com.typst.ide`).
//! Remove this module and its call in `main.rs` once the transition is over.
//!
//! One-time migration from the legacy Tauri identifier `com.typst.ide` to
//! the Flathub-aligned `io.github.gnoooo.typst-ide`.
//!
//! Tauri derives the app config/data directories from the identifier, and on
//! Linux/Windows the webview data directory (localStorage, cookies, cache) is
//! `app_local_data_dir`. The migration MUST run before Tauri creates the main
//! window, because that is when the webview data directory is opened. Running
//! it from the `setup` hook would be too late.
//!
//! The migration copies the old contents into the new directories, never
//! overwrites non-empty destination files, and writes a marker so it only runs
//! once. The old directories are kept as a backup.

use std::fs;
use std::io;
use std::path::Path;

const LEGACY_ID: &str = "com.typst.ide";
const NEW_ID: &str = "io.github.gnoooo.typst-ide";
const MIGRATION_MARKER: &str = ".migrated-from-com.typst.ide";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct MigrationReport {
    pub copied_files: usize,
    pub skipped: bool,
}

/// Copies legacy config/data/webview data to the new identifier directories.
///
/// Returns `Ok(report.skipped = true)` when the one-time marker is already
/// present. Empty legacy directories are ignored. A failure leaves the old
/// directories untouched and does not write the marker, so the next launch
/// retries the migration.
pub fn migrate_legacy_data() -> Result<MigrationReport, String> {
    let config_root = dirs::config_dir().ok_or("cannot resolve the config directory")?;
    let data_root = dirs::data_dir().ok_or("cannot resolve the data directory")?;
    let local_data_root =
        dirs::data_local_dir().ok_or("cannot resolve the local data directory")?;

    migrate_roots(&config_root, &data_root, &local_data_root)
}

/// Testable core of [`migrate_legacy_data`], parameterized by the platform
/// base directories.
fn migrate_roots(
    config_root: &Path,
    data_root: &Path,
    local_data_root: &Path,
) -> Result<MigrationReport, String> {
    let new_config = config_root.join(NEW_ID);
    let marker = new_config.join(MIGRATION_MARKER);
    if marker.exists() {
        return Ok(MigrationReport {
            skipped: true,
            ..Default::default()
        });
    }

    // On Linux and macOS `data_dir` and `data_local_dir` are the same root,
    // so the two pairs are identical and must be deduplicated.
    let mut pairs = vec![
        (config_root.join(LEGACY_ID), new_config.clone()),
        (data_root.join(LEGACY_ID), data_root.join(NEW_ID)),
        (
            local_data_root.join(LEGACY_ID),
            local_data_root.join(NEW_ID),
        ),
    ];
    pairs.sort();
    pairs.dedup();

    let mut report = MigrationReport::default();
    let mut migrated_any = false;

    for (old, new) in pairs {
        if old == new || !has_files(&old).map_err(|e| format!("{}: {e}", old.display()))? {
            continue;
        }
        copy_missing(&old, &new, &mut report)
            .map_err(|e| format!("cannot migrate {} to {}: {e}", old.display(), new.display()))?;
        migrated_any = true;
    }

    if migrated_any {
        fs::create_dir_all(&new_config).map_err(|e| format!("{}: {e}", new_config.display()))?;
        fs::write(&marker, format!("Migrated from {LEGACY_ID} to {NEW_ID}.\n"))
            .map_err(|e| format!("{}: {e}", marker.display()))?;
    }

    Ok(report)
}

/// True when `dir` contains at least one regular file, recursively.
/// Empty directories and symlinks alone do not trigger a migration.
fn has_files(dir: &Path) -> io::Result<bool> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };

    for entry in entries {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_file() {
            return Ok(true);
        }
        if file_type.is_dir() && has_files(&entry.path())? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Recursively copies missing entries from `src` into `dst`.
/// Non-empty destination files are never overwritten; zero-byte files (left
/// by an interrupted previous run) are replaced.
fn copy_missing(src: &Path, dst: &Path, report: &mut MigrationReport) -> io::Result<()> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry.file_type()?;

        // Never follow a symlink out of the legacy tree.
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            copy_missing(&src_path, &dst_path, report)?;
        } else if file_type.is_file() {
            if dst_path.exists() {
                if !dst_path.is_file() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!("destination is not a file: {}", dst_path.display()),
                    ));
                }
                if fs::metadata(&dst_path)?.len() > 0 {
                    continue;
                }
                fs::remove_file(&dst_path)?;
            }
            copy_file_atomic(&src_path, &dst_path)?;
            report.copied_files += 1;
        }
    }

    Ok(())
}

/// Copies one file through a temporary sibling, so an interrupted copy never
/// leaves a truncated destination file.
fn copy_file_atomic(src: &Path, dst: &Path) -> io::Result<()> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }

    let name = dst
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = dst.with_file_name(format!(".{name}.{}.{nonce}.migrating", std::process::id()));

    fs::copy(src, &tmp)?;
    match fs::rename(&tmp, dst) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn copies_files_and_nested_directories() {
        let old = tempdir().unwrap();
        let new = tempdir().unwrap();
        fs::create_dir_all(old.path().join("templates/demo")).unwrap();
        fs::write(old.path().join("theme.json"), "{\"light\":{}}").unwrap();
        fs::write(old.path().join("templates/demo/lib.typ"), "#let x = 1").unwrap();

        let mut report = MigrationReport::default();
        copy_missing(old.path(), new.path(), &mut report).unwrap();

        assert_eq!(report.copied_files, 2);
        assert_eq!(
            fs::read_to_string(new.path().join("theme.json")).unwrap(),
            "{\"light\":{}}"
        );
        assert_eq!(
            fs::read_to_string(new.path().join("templates/demo/lib.typ")).unwrap(),
            "#let x = 1"
        );
    }

    #[test]
    fn never_overwrites_non_empty_destination_files() {
        let old = tempdir().unwrap();
        let new = tempdir().unwrap();
        fs::write(old.path().join("theme.json"), "old").unwrap();
        fs::write(new.path().join("theme.json"), "new").unwrap();

        let mut report = MigrationReport::default();
        copy_missing(old.path(), new.path(), &mut report).unwrap();

        assert_eq!(report.copied_files, 0);
        assert_eq!(
            fs::read_to_string(new.path().join("theme.json")).unwrap(),
            "new"
        );
    }

    #[test]
    fn replaces_zero_byte_destination_files() {
        let old = tempdir().unwrap();
        let new = tempdir().unwrap();
        fs::write(old.path().join("notes.db"), "data").unwrap();
        fs::write(new.path().join("notes.db"), "").unwrap();

        let mut report = MigrationReport::default();
        copy_missing(old.path(), new.path(), &mut report).unwrap();

        assert_eq!(report.copied_files, 1);
        assert_eq!(
            fs::read_to_string(new.path().join("notes.db")).unwrap(),
            "data"
        );
    }

    #[test]
    fn ignores_empty_directories_and_symlinks() {
        let old = tempdir().unwrap();
        fs::create_dir_all(old.path().join("empty")).unwrap();
        assert!(!has_files(old.path()).unwrap());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", old.path().join("link")).unwrap();
            assert!(!has_files(old.path()).unwrap());
        }
    }

    #[test]
    fn migrates_all_roots_once_and_writes_marker() {
        let root = tempdir().unwrap();
        let config_root = root.path().join("config");
        let data_root = root.path().join("data");
        let local_root = root.path().join("local");

        let old_config = config_root.join(LEGACY_ID);
        let old_data = data_root.join(LEGACY_ID);
        let old_local = local_root.join(LEGACY_ID);
        fs::create_dir_all(&old_config).unwrap();
        fs::create_dir_all(&old_data).unwrap();
        fs::create_dir_all(old_local.join("localstorage")).unwrap();
        fs::write(old_config.join("theme.json"), "theme").unwrap();
        fs::write(old_data.join("notes.db"), "notes").unwrap();
        fs::write(old_local.join("localstorage/app"), "settings").unwrap();

        let report = migrate_roots(&config_root, &data_root, &local_root).unwrap();
        assert!(!report.skipped);
        assert_eq!(report.copied_files, 3);

        assert_eq!(
            fs::read_to_string(config_root.join(NEW_ID).join("theme.json")).unwrap(),
            "theme"
        );
        assert_eq!(
            fs::read_to_string(data_root.join(NEW_ID).join("notes.db")).unwrap(),
            "notes"
        );
        assert_eq!(
            fs::read_to_string(local_root.join(NEW_ID).join("localstorage/app")).unwrap(),
            "settings"
        );
        assert!(config_root.join(NEW_ID).join(MIGRATION_MARKER).exists());

        // The marker prevents a second migration, even if old files appear later.
        fs::write(old_config.join("late.json"), "late").unwrap();
        let second = migrate_roots(&config_root, &data_root, &local_root).unwrap();
        assert!(second.skipped);
        assert!(!config_root.join(NEW_ID).join("late.json").exists());
    }

    #[test]
    fn empty_legacy_directories_do_not_write_the_marker() {
        let root = tempdir().unwrap();
        let config_root = root.path().join("config");
        let data_root = root.path().join("data");
        let local_root = root.path().join("local");
        fs::create_dir_all(config_root.join(LEGACY_ID)).unwrap();

        let report = migrate_roots(&config_root, &data_root, &local_root).unwrap();
        assert!(!report.skipped);
        assert!(!config_root.join(NEW_ID).join(MIGRATION_MARKER).exists());
    }

    #[test]
    fn deduplicates_data_and_local_data_roots() {
        let root = tempdir().unwrap();
        let config_root = root.path().join("config");
        let shared_root = root.path().join("shared");
        let old_data = shared_root.join(LEGACY_ID);
        fs::create_dir_all(&old_data).unwrap();
        fs::write(old_data.join("history.db"), "history").unwrap();

        let report = migrate_roots(&config_root, &shared_root, &shared_root).unwrap();
        assert_eq!(report.copied_files, 1);
        assert_eq!(
            fs::read_to_string(shared_root.join(NEW_ID).join("history.db")).unwrap(),
            "history"
        );
    }
}
