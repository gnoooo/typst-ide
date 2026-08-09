// Integration tests for the Tauri commands, using tauri::test mock apps.
// They exercise the full command layer (state injection, SQLite) without
// spawning a real window.

use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tokio::sync::Semaphore;

use crate::state::{BibliographyDbState, CompileState, HistoryDbState, NotesDbState};
use typst_ide_core::database::{bibliography_db, history_db, notes_db};

/// Builds a mock Tauri app with in-memory SQLite databases for all three stores.
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    let notes = notes_db::init_db(":memory:").unwrap();
    let history = history_db::init_db(":memory:").unwrap();
    let bibliography = bibliography_db::init_db(":memory:").unwrap();

    mock_builder()
        .manage(NotesDbState(Mutex::new(notes)))
        .manage(HistoryDbState(Mutex::new(history)))
        .manage(BibliographyDbState(Mutex::new(bibliography)))
        .manage(CompileState(Arc::new(Semaphore::new(1))))
        .build(mock_context(noop_assets()))
        .unwrap()
}

#[test]
fn notes_crud_through_commands() {
    let app = mock_app();

    let added = crate::commands::db::add_note(
        app.state::<NotesDbState>(),
        "My Todo".into(),
        "#outline()".into(),
        "global".into(),
        None,
    );
    assert!(added.is_ok());

    let notes = crate::commands::db::get_all_notes(app.state::<NotesDbState>()).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].title, "My Todo");
    assert_eq!(notes[0].content, "#outline()");

    crate::commands::db::delete_note(app.state::<NotesDbState>(), notes[0].id.clone()).unwrap();
    let empty = crate::commands::db::get_all_notes(app.state::<NotesDbState>()).unwrap();
    assert!(empty.is_empty());
}

#[test]
fn notes_are_scoped_per_project() {
    let app = mock_app();

    let project_id = crate::commands::db::get_current_project_id("/tmp/a".into());

    let _ = crate::commands::db::add_note(
        app.state::<NotesDbState>(),
        "Global".into(),
        "g".into(),
        "global".into(),
        None,
    );
    let _ = crate::commands::db::add_note(
        app.state::<NotesDbState>(),
        "Project note".into(),
        "p".into(),
        "project".into(),
        Some(project_id.clone()),
    );

    let project =
        crate::commands::db::get_project_notes(app.state::<NotesDbState>(), "/tmp/a".into())
            .unwrap();
    assert_eq!(project.len(), 1);
    assert_eq!(project[0].project_id.as_deref(), Some(project_id.as_str()));

    let global = crate::commands::db::get_global_notes(app.state::<NotesDbState>()).unwrap();
    assert_eq!(global.len(), 1);
    assert!(global[0].project_id.is_none());
}

#[test]
fn history_crud_through_commands() {
    let app = mock_app();

    let inserted = crate::commands::db::add_history_entry(
        app.state::<HistoryDbState>(),
        "My report".into(),
        "/home/user/report".into(),
    )
    .unwrap();
    assert!(inserted);

    let history = crate::commands::db::get_history(app.state::<HistoryDbState>()).unwrap();
    assert_eq!(history.len(), 1);

    crate::commands::db::update_history_entry(
        app.state::<HistoryDbState>(),
        history[0].id.clone(),
        "Renamed report".into(),
        "/home/user/report-renamed".into(),
    )
    .unwrap();

    let updated = crate::commands::db::get_history(app.state::<HistoryDbState>()).unwrap();
    assert_eq!(updated[0].name, "Renamed report");

    crate::commands::db::delete_history_entry(app.state::<HistoryDbState>(), history[0].id.clone())
        .unwrap();
    assert!(
        crate::commands::db::get_history(app.state::<HistoryDbState>())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn bibliography_crud_through_commands() {
    let app = mock_app();

    let inserted = crate::commands::db::add_bibliography_entry(
        app.state::<BibliographyDbState>(),
        "IEEEA".into(),
        "ieee".into(),
        "bibs/main.bib".into(),
        "/home/user/report".into(),
        true,
    )
    .unwrap();
    assert!(inserted);

    let bibs = crate::commands::db::get_bibliography(
        app.state::<BibliographyDbState>(),
        "/home/user/report".into(),
    )
    .unwrap();
    assert_eq!(bibs.len(), 1);
    assert_eq!(bibs[0].title, "IEEEA");

    crate::commands::db::update_bibliography_entry(
        app.state::<BibliographyDbState>(),
        bibs[0].id.clone(),
        "Zotero".into(),
        "apa".into(),
        "bibs/zotero.bib".into(),
        false,
    )
    .unwrap();

    let updated = crate::commands::db::get_bibliography(
        app.state::<BibliographyDbState>(),
        "/home/user/report".into(),
    )
    .unwrap();
    assert_eq!(updated[0].style, "apa");

    crate::commands::db::delete_bibliography_entry(
        app.state::<BibliographyDbState>(),
        bibs[0].id.clone(),
    )
    .unwrap();
    assert!(
        crate::commands::db::get_bibliography(
            app.state::<BibliographyDbState>(),
            "/home/user/report".into(),
        )
        .unwrap()
        .is_empty()
    );
}

#[test]
fn project_id_is_deterministic() {
    let a = crate::commands::db::get_current_project_id("/tmp/project".into());
    let b = crate::commands::db::get_current_project_id("/tmp/project".into());
    let c = crate::commands::db::get_current_project_id("/tmp/other".into());
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert_eq!(a.len(), 64); // hex-encoded SHA-256
}

#[test]
fn suggest_font_returns_none_for_unknown_names() {
    // Iterating the font families must not panic, and a garbage name is far
    // from any real family (edit distance > 5).
    assert!(crate::commands::misc::suggest_font("zzzzz_not_a_font".into()).is_none());
}

#[test]
fn preview_compiles_valid_source_and_diagnostics_for_bad_source() {
    let app = mock_app();

    let result = crate::commands::preview::render_preview(
        app.state::<CompileState>(),
        "Hello world".into(),
        None,
        None,
    );
    let pages = tauri::async_runtime::block_on(result)
        .unwrap_or_else(|_| panic!("valid source should compile"));
    assert!(!pages.pages.is_empty());
    assert!(pages.pages[0].svg.starts_with("<svg"));

    let errors = tauri::async_runtime::block_on(crate::commands::preview::render_preview(
        app.state::<CompileState>(),
        "#let : not valid".into(),
        None,
        None,
    ));
    match errors {
        Ok(_) => panic!("invalid source should not compile"),
        Err(errors) => {
            assert!(!errors.is_empty());
            assert_eq!(errors[0].severity, "error");
        }
    }
}
