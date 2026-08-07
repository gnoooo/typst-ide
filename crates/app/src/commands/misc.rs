// Misc commands: webview zoom and font helpers

/// Sets the WebView zoom factor (1.0 = 100%, 1.5 = 150%, etc.)
#[tauri::command]
pub fn set_webview_zoom(window: tauri::WebviewWindow, factor: f64) -> Result<(), String> {
    window.set_zoom(factor).map_err(|e| e.to_string())
}

/// Checks whether a font family name is available on the system
#[tauri::command]
pub fn font_exists(name: String) -> bool {
    use font_kit::family_name::FamilyName;
    use font_kit::properties::Properties;
    use font_kit::source::SystemSource;
    SystemSource::new()
        .select_best_match(&[FamilyName::Title(name)], &Properties::new())
        .is_ok()
}

/// Returns the closest matching font family name for a given input,
/// using Levenshtein distance. Returns `None` if no close match is found
/// (edit distance > 5 after normalisation).
#[tauri::command]
pub fn suggest_font(name: String) -> Option<String> {
    use std::collections::BTreeSet;
    use std::sync::OnceLock;
    use font_kit::source::SystemSource;

    static FAMILIES: OnceLock<Vec<String>> = OnceLock::new();
    let families = FAMILIES.get_or_init(|| {
        let mut set = BTreeSet::new();
        if let Ok(handles) = SystemSource::new().all_fonts() {
            for handle in &handles {
                if let Ok(font) = handle.load() {
                    set.insert(font.family_name().to_string());
                }
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