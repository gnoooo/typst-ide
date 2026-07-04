use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use typst::diag::{eco_format, FileError, FileResult, PackageError, PackageResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::package::PackageSpec;
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Feature, Features, Library, LibraryExt};
use typst_kit::fonts::FontStore;

/// Cached font search result — computed once at first compilation, reused afterwards.
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
            cache_directory: std::env::var_os("CACHE_DIRECTORY")
                .map(|os_path| os_path.into())
                .unwrap_or(std::env::temp_dir()),
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
        *self.files.lock().unwrap() = HashMap::new();
    }

    /// Changes the root path and clears the file cache.
    pub fn set_root(&mut self, root: &str) {
        self.root = PathBuf::from(root);
        self.reset_files();
    }

    /// Creates a world configured for HTML export.
    /// This enables the `Feature::Html` flag in the standard library,
    /// which is required to compile to `HtmlDocument` via `typst::compile`.
    pub fn new_for_html(root: String, source: String) -> Self {
        let root = PathBuf::from(root);
        let font_store = get_fonts();
        let features: Features = [Feature::Html].into_iter().collect();
        let library = Library::builder().with_features(features).build();

        Self {
            library: LazyHash::new(library),
            root,
            font_store: font_store.clone(),
            source: Source::detached(source),
            time: time::OffsetDateTime::now_utc(),
            cache_directory: std::env::var_os("CACHE_DIRECTORY")
                .map(|os_path| os_path.into())
                .unwrap_or(std::env::temp_dir()),
            http: ureq::Agent::new_with_defaults(),
            files: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// A File that will be stored in the HashMap.
#[derive(Clone, Debug)]
struct FileEntry {
    bytes: Bytes,
    source: Option<Source>,
}

impl FileEntry {
    fn new(bytes: Vec<u8>, source: Option<Source>) -> Self {
        Self {
            bytes: Bytes::new(bytes),
            source,
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
}

impl TypstWrapperWorld {
    /// Helper to handle file requests.
    ///
    /// Requests will be either in packages or a local file.
    fn file(&self, id: FileId) -> FileResult<FileEntry> {
        let mut files = self.files.lock().map_err(|_| FileError::AccessDenied)?;
        if let Some(entry) = files.get(&id) {
            return Ok(entry.clone());
        }
        let path = match id.root() {
            typst::syntax::VirtualRoot::Package(package) => {
                // Fetching file from package
                let package_dir = self.download_package(package)?;
                id.vpath().realize(&package_dir)
                    .map_err(|_| FileError::AccessDenied)?
            }
            typst::syntax::VirtualRoot::Project => {
                // Fetching file from disk
                id.vpath().realize(&self.root)
                    .map_err(|_| FileError::AccessDenied)?
            }
        };

        let content = std::fs::read(&path).map_err(|error| FileError::from_io(error, &path))?;
        Ok(files
            .entry(id)
            .or_insert(FileEntry::new(content, None))
            .clone())
    }

    /// Downloads the package and returns the system path of the unpacked package.
    fn download_package(&self, package: &PackageSpec) -> PackageResult<PathBuf> {
        let package_subdir = format!("{}/{}/{}", package.namespace, package.name, package.version);
        let path = self.cache_directory.join(package_subdir);

        if path.exists() {
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
        
        let mut archive = tar::Archive::new(raw_archive.as_slice());
        archive.unpack(&path).map_err(|error| {
            _ = std::fs::remove_dir_all(&path);
            PackageError::MalformedArchive(Some(eco_format!("{error}")))
        })?;

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
