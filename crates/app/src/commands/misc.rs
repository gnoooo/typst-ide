// Misc commands: webview zoom and font helpers

/// Sets the WebView zoom factor (1.0 = 100%, 1.5 = 150%, etc.)
#[tauri::command]
pub fn set_webview_zoom(window: tauri::WebviewWindow, factor: f64) -> Result<(), String> {
    window.set_zoom(factor).map_err(|e| e.to_string())
}

/// Loads the system fonts into `db`. Inside a Flatpak sandbox the host
/// fonts are mounted read-only at `/run/host/fonts` and are not part of the
/// system font directories, so they are loaded explicitly when present.
fn load_fonts(db: &mut fontdb::Database) {
    db.load_system_fonts();
    for dir in ["/run/host/fonts", "/run/host/fonts-cache"] {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            db.load_fonts_dir(path);
        }
    }
}

/// Returns "fr" if the system locale is French, "en" otherwise.
/// Reads the locale env vars (LANGUAGE > LC_ALL > LC_MESSAGES > LANG)
/// LANGUAGE comes first because gettext gives it priority over LC_* for UI text.
#[tauri::command]
pub fn system_lang() -> &'static str {
    lang_from_env(
        std::env::var("LANGUAGE")
            .ok()
            .filter(|v| !v.trim().is_empty() && v.trim() != "C")
            .or_else(|| {
                ["LC_ALL", "LC_MESSAGES", "LANG"]
                    .into_iter()
                    .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()))
            }),
    )
}

pub fn lang_from_env(val: Option<String>) -> &'static str {
    match val.as_deref().map(str::trim) {
        Some(v) if v.starts_with("fr") => "fr",
        _ => "en",
    }
}

/// The system font family names, scanned once. `font_exists` and
/// `suggest_font` share this list: loading the system fonts is expensive
/// (done again on every `font_exists` call before this cache existed).
fn system_families() -> &'static Vec<String> {
    use fontdb::Database;
    use std::collections::BTreeSet;
    use std::sync::OnceLock;

    static FAMILIES: OnceLock<Vec<String>> = OnceLock::new();
    FAMILIES.get_or_init(|| {
        let mut set = BTreeSet::new();
        let mut db = Database::new();
        load_fonts(&mut db);
        for face in db.faces() {
            for (family, _) in &face.families {
                set.insert(family.clone());
            }
        }
        set.into_iter().collect()
    })
}

/// Checks whether a font family name is available on the system
#[tauri::command]
pub fn font_exists(name: String) -> bool {
    let name = name.trim().to_lowercase();
    system_families().iter().any(|f| f.to_lowercase() == name)
}

/// Returns the closest matching font family name for a given input,
/// using Levenshtein distance. Returns `None` if no close match is found
/// (edit distance > 5 after normalisation).
#[tauri::command]
pub fn suggest_font(name: String) -> Option<String> {
    let families = system_families();

    let normalise = |s: &str| s.to_lowercase().replace([' ', '-', '_'], "");

    let input = normalise(&name);

    families
        .iter()
        .map(|f| {
            let dist = strsim::levenshtein(&input, &normalise(f));
            (f, dist)
        })
        .filter(|(_, d)| *d <= 5)
        .min_by_key(|(_, d)| *d)
        .map(|(fam, _)| fam.clone())
}

#[cfg(test)]
mod tests {
    use super::{font_exists, system_families};

    /// The scan is shared: any family returned by `system_families` must be
    /// answered "exists" by `font_exists`, whatever the system fonts are.
    #[test]
    fn font_exists_accepts_cached_family_names() {
        let first = system_families().first().cloned();
        let Some(name) = first else {
            return; // a machine with no font at all cannot contradict the cache
        };
        assert!(font_exists(name));
        assert!(!font_exists("\n no-such-font-\u{1F4A9}".to_string()));
    }
}
