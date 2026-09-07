// Misc commands: webview zoom and font helpers

/// Sets the WebView zoom factor (1.0 = 100%, 1.5 = 150%, etc.)
#[tauri::command]
pub fn set_webview_zoom(window: tauri::WebviewWindow, factor: f64) -> Result<(), String> {
    window.set_zoom(factor).map_err(|e| e.to_string())
}

/// Checks whether a font family name is available on the system
#[tauri::command]
pub fn font_exists(name: String) -> bool {
    use fontdb::{Database, Family, Query};

    let mut db = Database::new();
    db.load_system_fonts();
    db.query(&Query {
        families: &[Family::Name(&name)],
        ..Default::default()
    })
    .is_some()
}

/// Returns the closest matching font family name for a given input,
/// using Levenshtein distance. Returns `None` if no close match is found
/// (edit distance > 5 after normalisation).
#[tauri::command]
pub fn suggest_font(name: String) -> Option<String> {
    use fontdb::Database;
    use std::collections::BTreeSet;
    use std::sync::OnceLock;

    static FAMILIES: OnceLock<Vec<String>> = OnceLock::new();
    let families = FAMILIES.get_or_init(|| {
        let mut set = BTreeSet::new();
        let mut db = Database::new();
        db.load_system_fonts();
        for face in db.faces() {
            for (family, _) in &face.families {
                set.insert(family.clone());
            }
        }
        set.into_iter().collect()
    });

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
