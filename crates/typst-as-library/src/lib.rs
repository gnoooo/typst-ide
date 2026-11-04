use std::collections::HashMap;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use typst::diag::{eco_format, FileError, FileResult, PackageError, PackageResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::package::PackageSpec;
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt};
use typst_kit::fonts::FontStore;

/// Cached font search result, computed once at first compilation, reused afterwards.
/// On Linux with many system fonts, this scan can take hundreds of milliseconds.
static FONT_STORE: OnceLock<Arc<FontStore>> = OnceLock::new();

fn get_fonts() -> Arc<FontStore> {
    FONT_STORE
        .get_or_init(|| {
            let mut store = FontStore::new();
            store.extend(typst_kit::fonts::embedded());
            store.extend(typst_kit::fonts::system());
            Arc::new(store)
        })
        .clone()
}

/// Main interface that determines the environment for Typst.
pub struct TypstWrapperWorld {
    /// Root path to which files will be resolved.
    root: PathBuf,

    /// The content of a source.
    source: Source,

    /// The standard library.
    library: LazyHash<Library>,

    /// Font store (book + lazy-loaded font data).
    font_store: Arc<FontStore>,

    /// Map of all known files.
    files: Arc<Mutex<HashMap<FileId, FileEntry>>>,

    /// Cache directory (e.g. where packages are downloaded to).
    cache_directory: PathBuf,

    /// http agent to download packages.
    http: ureq::Agent,

    /// Datetime.
    time: time::OffsetDateTime,
}

impl TypstWrapperWorld {
    pub fn new(root: String, source: String) -> Self {
        let root = PathBuf::from(root);
        let font_store = get_fonts();

        Self {
            library: LazyHash::new(Library::default()),
            root,
            font_store: font_store.clone(),
            source: Source::detached(source),
            time: time::OffsetDateTime::now_utc(),
            // Flatpak honors CACHE_DIRECTORY; elsewhere prefer the user's own cache (~/.cache/typst-ide) over world-writable /tmp.
            cache_directory: std::env::var_os("CACHE_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    dirs::cache_dir()
                        .map(|dir| dir.join("typst-ide"))
                        .unwrap_or_else(std::env::temp_dir)
                }),
            http: ureq::Agent::new_with_defaults(),
            files: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Replaces the main source content, keeping all other state (file cache, fonts, etc.).
    ///
    /// Uses `Source::replace` to update the text **in-place**, preserving the `FileId`.
    /// This is critical for comemo: because the `FileId` stays stable, comemo can detect
    /// which parts of the document actually changed and reuse memoized layout/eval results
    /// for the unchanged parts. Creating a new `Source::detached()` would assign a fresh
    /// random `FileId` every call, breaking comemo's ability to do incremental work.
    pub fn reset_source(&mut self, content: &str) {
        self.source.replace(content);
        self.time = time::OffsetDateTime::now_utc();
    }

    /// Resets the file cache (imported files).
    /// Call this when the project root changes or when files on disk may have changed.
    pub fn reset_files(&mut self) {
        *self.files.lock().unwrap_or_else(|p| p.into_inner()) = HashMap::new();
    }
}

/// A File that will be stored in the HashMap.
#[derive(Clone, Debug)]
struct FileEntry {
    bytes: Bytes,
    source: Option<Source>,
    /// `(len, mtime, edge sample hash)` of the file when it was read from disk.
    /// Used to detect files modified externally (scripts, other editors) while
    /// they are cached, so the persistent world never serves stale content.
    /// The sample hash matters on filesystems with coarse mtime resolution,
    /// where a same-length rewrite can keep `(len, mtime)` identical.
    fingerprint: Option<(u64, Option<SystemTime>, u64)>,
}

/// Size of the content edges hashed into the fingerprint (first and last
/// `SAMPLE_EDGE` bytes, 8 KB read at cache-check time, still negligible).
/// shortcut: content between the two edge samples is not hashed, a rewrite
/// entirely in the middle of a larger file keeps its fingerprint, upgrade to
/// a full content hash if that case ever matters
const SAMPLE_EDGE: usize = 4096;

fn hash_sample(head: &[u8], tail: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    head.hash(&mut hasher);
    tail.hash(&mut hasher);
    hasher.finish()
}

/// Edge sample hash from full content (cache fill, bytes already read).
fn sample_from_bytes(bytes: &[u8]) -> u64 {
    let len = bytes.len();
    let head = &bytes[..len.min(SAMPLE_EDGE)];
    let tail = &bytes[len.saturating_sub(len.min(SAMPLE_EDGE))..];
    hash_sample(head, tail)
}

/// Edge sample hash from the file itself (cache hit verification).
fn sample_from_file(path: &Path, len: u64) -> std::io::Result<u64> {
    let edge = len.min(SAMPLE_EDGE as u64) as usize;
    let mut file = std::fs::File::open(path)?;
    let mut head = vec![0u8; edge];
    file.read_exact(&mut head)?;
    let mut tail = vec![0u8; edge];
    file.seek(std::io::SeekFrom::Start(len - edge as u64))?;
    file.read_exact(&mut tail)?;
    Ok(hash_sample(&head, &tail))
}

impl FileEntry {
    fn new(
        bytes: Vec<u8>,
        source: Option<Source>,
        fingerprint: Option<(u64, Option<SystemTime>, u64)>,
    ) -> Self {
        Self {
            bytes: Bytes::new(bytes),
            source,
            fingerprint,
        }
    }

    fn source(&mut self, id: FileId) -> FileResult<Source> {
        let source = if let Some(source) = &self.source {
            source
        } else {
            let contents = std::str::from_utf8(&self.bytes).map_err(|_| FileError::InvalidUtf8)?;
            let contents = contents.trim_start_matches('\u{feff}');
            let source = Source::new(id, contents.into());
            self.source.insert(source)
        };
        Ok(source.clone())
    }

    /// Whether the cached bytes still match the current on-disk state.
    ///
    /// Stats the file first (cheap), then hashes its first and last
    /// `SAMPLE_EDGE` bytes: on coarse-mtime filesystems this is what catches
    /// a same-length in-place rewrite that `(len, mtime)` would miss.
    fn is_current(&self, path: &Path) -> bool {
        let Some((len, mtime, sample)) = &self.fingerprint else {
            return false;
        };
        let Ok(meta) = std::fs::metadata(path) else {
            return false;
        };
        if meta.len() != *len || meta.modified().ok() != *mtime {
            return false;
        }
        sample_from_file(path, *len)
            .map(|sample_now| sample_now == *sample)
            .unwrap_or(false)
    }
}

impl TypstWrapperWorld {
    /// Helper to handle file requests.
    ///
    /// Requests will be either in packages or a local file.
    ///
    /// Cached entries are served only while a `stat` of the file (size + mtime)
    /// matches the fingerprint captured at read time AND its edge sample hash
    /// (first and last 4 KB) is unchanged, the belt against coarse-mtime
    /// filesystems (see `is_current`). Files rewritten on disk (e.g. an image
    /// regenerated by an external script) are re-read here, so callers never
    /// see stale bytes from the persistent world.
    fn file(&self, id: FileId) -> FileResult<FileEntry> {
        let mut files = self.files.lock().unwrap_or_else(|p| p.into_inner());
        let path = match id.root() {
            typst::syntax::VirtualRoot::Package(package) => {
                // Fetching file from package
                let package_dir = self.download_package(package)?;
                id.vpath()
                    .realize(&package_dir)
                    .map_err(|_| FileError::AccessDenied)?
            }
            typst::syntax::VirtualRoot::Project => {
                // Fetching file from disk
                id.vpath()
                    .realize(&self.root)
                    .map_err(|_| FileError::AccessDenied)?
            }
        };

        if let Some(entry) = files.get(&id) {
            if entry.is_current(&path) {
                return Ok(entry.clone());
            }
        }
        // Stale entry (or file deleted on disk): drop the cache hit and re-read.
        files.remove(&id);

        let content = std::fs::read(&path).map_err(|error| FileError::from_io(error, &path))?;
        let fingerprint = std::fs::metadata(&path)
            .map(|meta| {
                (
                    meta.len(),
                    meta.modified().ok(),
                    sample_from_bytes(&content),
                )
            })
            .ok();
        Ok(files
            .entry(id)
            .or_insert(FileEntry::new(content, None, fingerprint))
            .clone())
    }

    /// Downloads the package and returns the system path of the unpacked package.
    fn download_package(&self, package: &PackageSpec) -> PackageResult<PathBuf> {
        let package_subdir = format!("{}/{}/{}", package.namespace, package.name, package.version);
        let path = self.cache_directory.join(package_subdir);

        if is_cached(&path) {
            return Ok(path);
        }

        eprintln!("downloading {package}");
        let url = format!(
            "https://packages.typst.org/{}/{}-{}.tar.gz",
            package.namespace, package.name, package.version,
        );

        let response = retry(|| {
            let response = self
                .http
                .get(&url)
                .call()
                .map_err(|error| eco_format!("{error}"))?;

            let status = response.status();
            if !http_successful(status.into()) {
                return Err(eco_format!(
                    "response returned unsuccessful status code {status}",
                ));
            }

            Ok(response)
        })
        .map_err(|error| PackageError::NetworkFailed(Some(error)))?;

        let compressed_archive = response
            .into_body()
            .read_to_vec()
            .map_err(|error| PackageError::NetworkFailed(Some(eco_format!("{error}"))))?;
        // ???? ça a été changé du coup, possible que ça fonctionne plus
        /*
        avant:
        response
            .into_reader()
            .read_to_end(&mut compressed_archives)
            .map_err(|error| PackageError::NetworkFailed(Some(eco_format!("{error}"))))?;
         */

        let raw_archive = zune_inflate::DeflateDecoder::new(&compressed_archive)
            .decode_gzip()
            .map_err(|error| PackageError::MalformedArchive(Some(eco_format!("{error}"))))?;

        // Ensure the cache root exists so the package directory can be created.
        std::fs::create_dir_all(&self.cache_directory)
            .map_err(|error| PackageError::Other(Some(eco_format!("{error}"))))?;

        // Ne pas laisser de dépendances à moitié existantes, l'erreur est
        // propagée puisque la décompression complète dépend de ce nettoyage.
        // On a first download the package directory does not exist yet.
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|error| PackageError::Other(Some(eco_format!("{error}"))))?;
        }

        let mut archive = tar::Archive::new(raw_archive.as_slice());
        archive.unpack(&path).map_err(|error| {
            if path.exists() {
                if let Err(cleanup) = std::fs::remove_dir_all(&path) {
                    eprintln!("failed to clear {}: {cleanup}", path.display());
                }
            }
            PackageError::MalformedArchive(Some(eco_format!("{error}")))
        })?;

        std::fs::write(path.join(".ok"), b"")
            .map_err(|error| PackageError::MalformedArchive(Some(eco_format!("{error}"))))?;

        Ok(path)
    }
}

/// This is the interface we have to implement such that `typst` can compile it.
///
/// I have tried to keep it as minimal as possible
impl typst_ide::IdeWorld for TypstWrapperWorld {
    fn upcast(&self) -> &dyn typst::World {
        self
    }
}

impl typst::World for TypstWrapperWorld {
    /// Standard library.
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    /// Metadata about all known Books.
    fn book(&self) -> &LazyHash<FontBook> {
        self.font_store.book()
    }

    /// Accessing the main source file.
    fn main(&self) -> FileId {
        self.source.id()
    }

    /// Accessing a specified source file (based on `FileId`).
    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.source.id() {
            Ok(self.source.clone())
        } else {
            self.file(id)?.source(id)
        }
    }

    /// Accessing a specified file (non-file).
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.file(id).map(|file| file.bytes.clone())
    }

    /// Accessing a specified font per index of font book.
    fn font(&self, id: usize) -> Option<Font> {
        self.font_store.font(id)
    }

    /// Get the current date.
    ///
    /// Optionally, a timezone offset is given.
    fn today(&self, offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        let time = match offset {
            Some(dur) => {
                let td: time::Duration = dur.into();
                let secs = td.whole_seconds();
                let utc_offset = time::UtcOffset::from_whole_seconds(secs.try_into().ok()?).ok()?;
                self.time.checked_to_offset(utc_offset)?
            }
            None => self.time,
        };
        Some(Datetime::Date(time.date()))
    }
}

fn retry<T, E>(mut f: impl FnMut() -> Result<T, E>) -> Result<T, E> {
    if let Ok(ok) = f() {
        Ok(ok)
    } else {
        f()
    }
}

fn http_successful(status: u16) -> bool {
    // 2XX
    status / 100 == 2
}

/// A package directory is only trusted if it carries the `.ok` marker, which is written after a successful
/// extraction, pre-existing or half-extracted directories are re-downloaded instead of trusted.
fn is_cached(path: &Path) -> bool {
    path.join(".ok").exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use typst::syntax::{RootedPath, VirtualPath, VirtualRoot};

    fn project_file_id(rel: &str) -> FileId {
        RootedPath::new(VirtualRoot::Project, VirtualPath::new(rel).unwrap()).intern()
    }

    fn test_world(dir: &std::path::Path) -> (TypstWrapperWorld, PathBuf) {
        let world = TypstWrapperWorld::new(
            dir.to_string_lossy().to_string(),
            "#image(\"img.png\")".into(),
        );
        (world, dir.join("img.png"))
    }

    #[test]
    fn file_entries_are_re_read_when_disk_content_changes() {
        let dir = tempdir().unwrap();
        let (world, img_path) = test_world(dir.path());
        std::fs::write(&img_path, b"v1").unwrap();
        let id = project_file_id("img.png");

        let first = world.file(id).unwrap();
        assert_eq!(&first.bytes[..], b"v1");

        // External rewrite, e.g. a script regenerating the image in place.
        // Use a different length so the (len, mtime) fingerprint always changes
        // even on filesystems with coarse mtime resolution (CI, tmpfs, NFS).
        std::fs::write(&img_path, b"version-2").unwrap();

        // Same world, cache NOT reset: the staleness check must re-read it.
        let second = world.file(id).unwrap();
        assert_eq!(&second.bytes[..], b"version-2");
    }

    #[test]
    fn unchanged_files_are_served_from_cache() {
        let dir = tempdir().unwrap();
        let (world, img_path) = test_world(dir.path());
        std::fs::write(&img_path, b"content").unwrap();
        let id = project_file_id("img.png");

        let first = world.file(id).unwrap();
        let second = world.file(id).unwrap();
        assert_eq!(&first.bytes[..], &second.bytes[..]);
    }

    #[test]
    fn deleted_files_are_not_served_from_cache() {
        let dir = tempdir().unwrap();
        let (world, img_path) = test_world(dir.path());
        std::fs::write(&img_path, b"content").unwrap();
        let id = project_file_id("img.png");
        assert!(world.file(id).is_ok());

        std::fs::remove_file(&img_path).unwrap();
        assert!(
            world.file(id).is_err(),
            "a file deleted on disk must not be served from the cache"
        );
    }

    #[test]
    fn package_dir_without_ok_marker_is_not_trusted() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("package");
        std::fs::create_dir_all(&path).unwrap();

        assert!(
            !is_cached(&path),
            "a bare directory must not count as a cached package"
        );

        std::fs::write(path.join(".ok"), b"").unwrap();
        assert!(is_cached(&path));
    }

    #[test]
    fn edge_sample_changes_when_content_changes() {
        // Up to 2 x SAMPLE_EDGE bytes the two edge samples cover the whole
        // content, so a same-length in-place rewrite is caught deterministically.
        // Above that the gap between the two samples stays invisible (known
        // limit of the cheap edge approach)
        let old: Vec<u8> = (0..8 * 1024usize).map(|i| (i % 251) as u8).collect();
        let mut new = old.clone();
        new[4096] ^= 0xFF;
        assert_eq!(old.len(), new.len());
        assert_ne!(sample_from_bytes(&old), sample_from_bytes(&new));
    }

    #[test]
    fn edge_sample_is_stable_for_identical_content() {
        let content: Vec<u8> = (0..2048usize).map(|i| (i % 251) as u8).collect();
        assert_eq!(
            sample_from_bytes(&content.clone()),
            sample_from_bytes(&content)
        );
    }

    #[test]
    fn edge_sample_covers_small_files_entirely() {
        let a = b"v1".to_vec();
        let b = b"v2".to_vec();
        assert_eq!(a.len(), b.len());
        assert_ne!(sample_from_bytes(&a), sample_from_bytes(&b));
    }

    #[test]
    fn edge_sample_matches_between_bytes_and_disk() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("img.png");
        let content: Vec<u8> = (0..16 * 1024usize).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &content).unwrap();
        let len = std::fs::metadata(&path).unwrap().len();
        assert_eq!(
            sample_from_file(&path, len).unwrap(),
            sample_from_bytes(&content)
        );
    }
}
