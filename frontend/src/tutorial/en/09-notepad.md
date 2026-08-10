# The notepad

^sticky_note_2^ The **notepad** stores reusable snippets: `#import` modules, functions, page templates...

Each note has a scope:

- ^public^ **Global**: available across all your projects;
- ^folder^ **Project**: available only in the current project.

Open it via the ^sticky_note_2^ toolbar button or **Edit** > **Open notepad**. Search a note with the search bar, then **insert** it at the editor cursor.

```typst
#import "@preview/hydra:0.3.0": hydra

#hydra(color: rgb("#007acc"), level: 1)
```