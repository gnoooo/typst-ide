# Contre-audit indépendant — Typst IDE

> **Méthode** : relecture directe du code (tous les fichiers cités ont été ouverts et vérifiés ligne par ligne), sans présumer de l'exactitude des deux rapports précédents (`docs/audit-1.md`, `docs/audit-2.md`, désignés ci-après « GLM »). Plusieurs affirmations de GLM ont été **infirmées ou re-graduées** après re-traçage des chemins d'exécution.
>
> Aucun fichier de code n'a été modifié durant ce contre-audit.

---

## 1. Modèle mental du projet

Application desktop locale (Tauri 2) : un frontend JS vanilla + Monaco communique avec un backend Rust via IPC (`invoke`). Trois crates : `app` (commandes Tauri, état), `core` (compilation Typst via monde persistant + cache SVG, SQLite notes/history, parsing `.bib`), `typst-as-library` (fork implémentant `typst::World`). Le flux principal : frappe → debounce adaptatif → `render_preview` (sémaphore Rust = 1) → SVG par page → MAJ DOM incrémentale dans une iframe blob. Le reste (historique, notes, bibliographie, templates, gestionnaire de fichiers) est du CRUD classique frontend → commandes Rust → disque/SQLite.

---

## 2-3. Contre-audit & vérification des affirmations GLM

### A. Sécurité (XSS) — CONFIRMÉ, et même étendu

Famille XSS confirmée : `history.js:238-245` (contenu `main.typ` brut → `innerHTML`), `sources.js:78-117` (données `.bib` → `innerHTML`/attributs `value=`), `modal.js:133` via `t()` non échappé (noms de fichiers dans les `showConfirm` de `operations.js:33,180,293` et `sources.js:138`). Absence de CSP confirmée (`tauri.conf.json` sans clé `security`), `withGlobalTauri: true` confirmé, commandes FS non scopées confirmées.

**Sinks manqués par GLM** :
- `modal.js:52` — `header.innerHTML = \`<h2>${title}</h2>\``, et deux appelants passent des données contrôlées par le contenu des fichiers : `sources.js:278` (`title: \`${filepath.split('/').pop()}\`` — **nom de fichier `.bib`**) et `notepad.js:310` (`title: note.title`). Un `.bib` nommé `<img src=x onerror=…>.bib` déclenche l'XSS dès l'ouverture de la vue sources.
- `bibliography.js:261` — `t('bib.raw_edit_title', { name: entry.path.split('/').pop() })` → titre → même sink.

**SOLUTION À REVOIR (important)** : GLM recommande de faire échapper les paramètres **dans `t()`**. C'est une mauvaise idée : `showToast` et `applyI18n` injectent le résultat de `t()` via `textContent` — échapper dans `t()` y afficherait des entités littérales (`&lt;`) dès qu'un paramètre contient `<`. **La bonne solution est l'échappement aux ~15 sinks `innerHTML`/attributs** (+ `createElement`/`textContent` pour les 3-4 builders de liste critiques), pas dans `t()`.

Nuances sur la gravité (app locale) : pas d'attaquant distant ; il faut que l'utilisateur ouvre un contenu non fiable (projet cloné, `.bib` téléchargé) **et** une interaction (ouvrir la vue sources, cliquer « Supprimer » sur un fichier piégé, cliquer l'œil dans l'historique). Ça reste le cœur du métier de l'app (éditer des projets venus d'ailleurs) → **P0 maintenu**, mais avec ce cadre honnête.

- `notepad` XSS (S3) : GLM-2 a raison d'avoir rétrogradé — les notes sont en SQLite locale, non transportées par les projets. P2.
- iframe `allow-scripts` : non vérifié si `typst-svg` peut émettre du `<script>` — **incertain**, défense en profondeur. Retirer `allow-scripts` est sans risque (le handler de clic est attaché depuis le parent).

### B. Bugs — re-graduations significatives

| Claim GLM | Verdict | Justification |
|---|---|---|
| `history.js:101,162` guillemet non fermé → « modal dégradé » | **CONFIRMÉ MAIS PIRE** | Par parsing HTML5, la valeur d'attribut non terminée **avale le `<p>` et le `<button>`** dans le tag du div : `#history-entry-path-btn` n'existe pas dans le DOM → `history.js:108` et `:169` font `null.addEventListener` → **TypeError**. Les fonctionnalités « Ajouter à l'historique » et « Modifier une entrée » (câblées : `history.js:271,300-303`) **crashent silencieusement**. Ce n'est pas cosmétique, c'est une feature morte. (Confiance : élevée, par spec HTML5 ; non exécuté dans un navigateur ici.) |
| Race scheduler `preview.js:336-343` | **CONFIRMÉ MAIS À NUANCER** (P2) | Re-traçage complet : debounce ≥ gap **toujours** (mêmes seuils), donc le chemin purement debouncé ne peut pas entrer dans la branche throttle. La race n'est atteignable que via `forceCompile()` ou le re-schedule du `finally`. Conséquence réelle : compile redondante + interleaving possible des updates chunkées → pages transitoirement mixtes, **auto-guéri à la frappe suivante**. Le sémaphore Rust sérialise, le résultat final est correct. |
| `loadHtml` `Promise(async)` → gel du scheduler | **NON CONFIRMÉ en pratique (défaut latent)** | Point clé manqué par GLM : `initPreview` n'est appelé **qu'une seule fois** (`main.js:144`), au démarrage, avec un éditeur vide → HTML minuscule → chemin Blob **main-thread**, jamais le worker (seuil 512 Ko jamais atteint). `_frameInitialized` n'est jamais remis à faux → le chemin first-load ne s'exécute qu'une fois, sur du contenu vide. **Le hang est inatteignable dans les flux actuels** ; le worker `preview-worker.js` est de facto du code mort. Le défaut reste réel si le code évolue → fix opportuniste. P3. |
| Race #3 (switch projet pendant first-load) | **FAUX POSITIF** | Impossible : `initPreview` jamais rappelé après le démarrage. À retirer. |
| `project.js:106` / `structures.js:666` optional-chaining → « peut crasher `main()` » | **FAUX POSITIF (en pratique)** | `#open-project-btn` existe (`index.html:310`), `#structures-menu` existe (`index.html:335`). Aucun crash possible aujourd'hui → P3 durcissement seulement. |
| `project.js:20` `JSON.parse` → crash démarrage | **CONFIRMÉ MAIS À NUANCER** (P3) | La clé n'a jamais été écrite que par l'app en JSON valide ; il faudrait une corruption externe. Probabilité négligeable. La ligne est morte → supprimer. |
| `getCurrentProject().path` sans garde (`bibliography.js:111,218`, etc.) | **FAUX POSITIF** | Aucun chemin d'exécution ne remet `currentProject` à `null` (pas de « close project »), et `openBibliography` garde déjà (`bibliography.js:154`). Non-issues. |
| `structures.js:141,290` off-by-one → « Typst malformé » | **CONFIRMÉ MAIS IMPACT COSMÉTIQUE** | Typst est insensible aux espaces dans les listes d'arguments : le code généré compile à l'identique. Seule l'indentation est moche. P3, pas P1. |
| `i18n t()` 1re occurrence — « latent, aucune trad ne le déclenche » | **ERREUR DE GLM : déclenché en prod** | `template.instantiate_confirm_message` utilise `{name}` **deux fois** (fr+en) → la 2e reste littérale `{name}` affichée à l'utilisateur dans la confirmation (`instantiate.js:24`). Cosmétique, réel. P3. |
| `modal.js` `closeAll()` fuite de promesses | **CONFIRMÉ MAIS À NUANCER** (P3) | Quasi-inatteignable : tant qu'une modale est au-dessus, l'overlay bloque les clics vers la modale sous-jacente. |
| Deux chemins PDF divergents | **À PRÉCISER** | En réalité `exportPDF` (Blob) est **mort** : `onExportPDF` n'est invoqué nulle part (`shortcuts.js` ne lie **jamais** Ctrl+S — pas de `KeyS`). **Le Ctrl+S annoncé dans le README ne fait rien.** Un seul chemin vivant (`savePdf` toolbar). Doc mensongère + code mort. P2. |
| `file-sync.js:79` | FAUX POSITIF (déjà retiré par GLM-2, confirmé) | Le module est correct. |
| `toolbar.js:154` off-by-one | CONFIRMÉ, trivial | + constat associé : `writeToConsole("success", …)` à **chaque compile** (`main.js:154`) → spam de log qui noie les erreurs. |
| Match sur chaînes FR (`operations.js:192,213`, `form.js:206,224`, `instantiate.js:33`) | CONFIRMÉ | — |
| `sources.js:222` selector injection | CONFIRMÉ | — |
| `tree.js:339-389` tooltip orphelin | CONFIRMÉ | — |
| `notepad.js:188,260` non-awaited ; `bibliography.js:279-289` toast menteur | CONFIRMÉ | — |
| Boucle de symlink `collect_entries` (`fs.rs:135-175`) | CONFIRMÉ | + il traverse aussi les symlinks pointant **hors projet** (listing de répertoires externes). |
| Code mort (`core/fs/files.rs`, `core/main.rs`, `compile()`, `compiler/export.rs`, `editor.js#handleImagePaste`) | CONFIRMÉ | — |
| Perf (`tree.js:128-153` O(n·depth), `compile.rs:380-411` double hash, `toolbar.js:190` rect/mousemove) | CONFIRMÉ, tous mineurs | — |

### C. Ce que GLM a manqué (nouveaux problèmes)

1. **Séparateurs de chemins Windows — P1.** `fs.rs:150-154` (`collect_entries`) et `import_image_dialog` (`fs.rs:298-302`) produisent `relative_path` via `strip_prefix(...).to_string_lossy()` → séparateurs **natifs** (`images\photo.png` sous Windows). Le frontend fait `relative_path.split("/")` (`tree.js:132`), `lastIndexOf("/")` (`utils.js:9`), `startsWith(folderPath + "/")` (`utils.js:14`). Sous Windows → arborescence **plate**, dossiers imbriqués cassés, chemins de move/rename incohérents. **L'installeur Windows est publié** (`release.yml` nsis + README). Confiance : élevée (comportement standard de `std::path` ; non testé sur machine Windows). Fix trivial : `.replace('\\', "/")` côté Rust. **Meilleur ROI de tout l'audit.**
2. **`rename_template` ne valide pas `name` — P2.** `templates.rs:163` : `let old = root.join(&name)` sans `validate_template_name` → `..` → renommage d'un répertoire arbitraire. Seul `new_name` est validé.
3. **Chemin d'écriture `.bib` corrompt les données — P1 (intégrité).** (a) `build_bib_entry` (`bibliography.rs:153`) écrit `key = "value"` sans échapper les `"` → un titre contenant `"` produit un `.bib` **invalide** ; (b) `parse_entries` (`bibliography.rs:75`) ignore les lignes de continuation sans `=` → **les champs multi-lignes (abstract, note…) sont tronqués silencieusement** lors d'un edit-save via `replace_whole_bib_source` ; (c) les wrappers Tauri (`commands/bibliography.rs:73-99`) avalent **toutes** les erreurs en `Ok(false)` et le frontend ignore le retour (`sources.js:166`) → échec d'écriture invisible.
4. **Ctrl+/ probablement inopérant hors WebKitGTK — P2 (à vérifier).** Le handler global capture-phase (`shortcuts.js:148-155`) appelle `preventDefault` mais pas `stopPropagation` → Monaco reçoit aussi l'événement sur les plateformes où il n'est pas avalé → double toggle = aucun effet (QWERTY Windows/macOS). Non testé — à valider sur Windows.
5. **`devtools` + `test` dans les deps de production — P2/P3.** `crates/app/Cargo.toml:14` : `features = ["devtools", "test"]` → devtools accessibles dans les builds release (console → IPC complet), et l'API de test compilée dans le binaire. `test` devrait être en dev-dependencies, `devtools` en debug seulement.
6. **`create_project` accepte `..` — P3.** `INVALID_NAME` bloque `/` mais pas `..` ; `fs.rs:30` fait `base_path.join("..")` → écrit `main.typ` dans le parent. Quasi-benin.
7. **Colonne click→source en code points vs UTF-16 — P3.** `byte_to_line_col` (`compile.rs:67-76`) compte des caractères ; Monaco attend des unités UTF-16 (`main.js:163`). Décalage sur lignes avec caractères astraux (emoji).
8. **Divers P3** : `preview.js:475` lit `#zoom-input` (inexistant — l'id réel est `zoom-preview-input`, `index.html:353`) → code mort ; `console.log("[Profiling]…")` à chaque compile (`preview.js:651`) ; `shortcuts.js:48` utilise le global `window.monaco` sans import (couplage implicite) ; `check_if_entry_exists` retourne un booléen inversé par rapport à son nom (`bibliography.rs:126-136`) ; `openHistory` sans try/catch (`history.js:278`).

---

## 4. Challenge des recommandations GLM

- **« Faire échapper les paramètres dans `t()` » → SOLUTION À REVOIR** (régression textContent, voir §A). Échapper aux sinks.
- **« Helper `h()` hyperscript / bus d'événements / rewrite du scheduler / état world par session / DOMPurify tutoriel / renommer le crate » → refus confirmé** : sur-ingénierie pour ce projet. L'échappement ciblé suffit.
- **« Scoping FS »** : confirmé, per-commande avec exemption des chemins issus des pickers (`export_pdf`, `save_file` brut). En production, à faire **après** le fix XSS (défense en profondeur, pas correctif primaire).
- **« CSP »** : confirmé, avec le bon ordre (migrer les 6 `onclick` inline d'abord : `index.html:286,292` + `structures.js:106,255,462,612`).
- **« Race scheduler P1 »** : à rétrograder P2. Le sémaphore Rust rend le résultat final correct ; coût = une compile perdue + glitch transitoire rare. Fix cheap dans la même passe que la robustesse worker.
- **Suppression du worker `preview-worker.js`** : à envisager carrément (chemin inatteignable aujourd'hui) plutôt que le fiabiliser — simplification > réparation d'un code non exécuté. À discuter.

---

## 5-6. Liste consolidée & priorités finales

### P0
1. **XSS systémique** — *confirmé par les deux analyses, étendu par celle-ci (titres de modales).* Cause racine : interpolation non échappée dans `innerHTML`/attributs. Fix : `escapeHtml`/`escapeAttr` aux sinks + `createElement`/`textContent` pour `buildNoteElement`, `rebuildSourcesList`, `buildHistoryEntry`, `viewHistoryEntry` ; titres de modales en `textContent`. Effort moyen, régression faible si ciblé. Tests : jsdom + payloads adverses sur chaque builder.

### P1 (strict)
2. **`history.js:101,162` — features add/edit historique mortes (TypeError)**. *GLM l'a vu, a sous-estimé l'impact.* Fix : fermer les guillemets (1 caractère ×2). Test manuel : ouvrir les deux modales.
3. **Séparateurs Windows — file manager cassé sur build Windows.** *Manqué par GLM.* Fix : normaliser `/` dans `collect_entries` + `import_image_dialog` (1-2 lignes Rust). Test : `cargo check --target x86_64-pc-windows-gnu` + test unitaire sur la normalisation.
4. **Intégrité `.bib` en écriture** (guillemets non échappés → bib invalide ; champs multi-lignes tronqués ; erreurs avalées `Ok(false)` + frontend ignorant le retour). *Manqué par GLM.* Fix : écrire les valeurs en `{...}`, préserver les lignes de continuation, propager les erreurs. Tests Rust : round-trip avec valeur contenant `"` et champ multi-lignes.
5. **Scoping FS per-commande** (+ validation `rename_template`, `create_project`). Défense en profondeur. Tests Rust : chemins hors-racines rejetés, pickers exemptés.

### P2
6. CSP (après migration des `onclick` inline) + retrait `allow-scripts` iframe.
7. Scheduler preview : gate `_compileRunning` en tête de `_runCompile` + `loadHtml` en `async function` + reset de `_compileRunning`/`_pendingRun` dans `initPreview` (ou suppression du worker mort).
8. Codes d'erreur structurés Rust ↔ JS (remplace le match FR).
9. Décision Ctrl+S/`exportPDF` : câbler le raccourci annoncé ou retirer le code mort + corriger le README.
10. `rename_template` (si non fait en #5), devtools hors release.
11. Vérifier Ctrl+/ sur Windows ; si confirmé, `stopImmediatePropagation` dans le handler global.
12. Tooltip `tree.js`, awaits `notepad.js`, try/catch + toasts `bibliography.js`.

### P3
Code mort (`files.rs`, `core/main.rs`, `compile()`, `export.rs`, `handleImagePaste`, `exportPDF` si non câblé), `createSearchBar` ×6, i18n `replace` global, off-by-one logs, spam console, `#zoom-input` mort, `structures.js` off-by-one (cosmétique), `byte_to_line_col` UTF-16, profondeur/symlink guard, `test` feature en deps, optional-chaining défensif, `check_if_entry_exists` renommage, perfs `tree.js`/`compile.rs`/`toolbar.js`, CI (clippy/npm audit/check windows).

---

## 7. Roadmap (dépendances)

1. **Batch one-liners** (guillemets history, normalisation Windows, `onClick`, tooltip, awaits, toasts, i18n replace-all) — isolés, risque ~0.
2. **XSS sinks (P0)** + tests jsdom — indépendant.
3. **Intégrité `.bib` (P1-4)** + tests Rust — indépendant.
4. **Migration `onclick` inline → CSP + sandbox iframe (P2-6)** — CSP après migration des handlers.
5. **Scoping FS + validations (P1-5)** — après le P0 (défense en profondeur).
6. **Scheduler robustesse (P2-7)** — après l'étape 2.
7. **Codes d'erreur structurés (P2-8)** — coordonné Rust+JS, une passe.
8. **Décisions dead code / Ctrl+S / worker (P2-9, P3)** — après les fixes.
9. **CI (clippy warn, npm audit, cargo check windows)** — à tout moment, non bloquant d'abord.

---

## 8. Décisions

- **GLM a correctement identifié** : la famille XSS, l'absence de CSP, le FS non scopé, les typos `onclick`/`onClick`, les toasts menteurs, le code mort, les matchs FR, la duplication `createSearchBar`, les gaps CI.
- **GLM a mal identifié** : « `t()` doit échapper » (régression textContent) ; `loadHtml` hang « P1 » (inatteignable — worker jamais exercé) ; race #3 (impossible) ; `project.js:106`/`structures.js:666` « crash » (éléments toujours présents) ; `getCurrentProject().path` null-deref (projet jamais dé-sélectionné) ; `structures.js` off-by-one « Typst malformé » (cosmétique) ; i18n « latent » (déjà déclenché par `template.instantiate_confirm_message`) ; « history → modal dégradé » (c'est un crash de feature).
- **GLM a oublié** : séparateurs Windows (P1), corruption `.bib` en écriture (P1), sinks titre de modale, `rename_template` non validé, devtools en release, Ctrl+S mort vs README, Ctrl+/ double-toggle probable, colonnes UTF-16, `zoom-input` mort.
- **À faire différemment** : échapper aux sinks (pas dans `t()`) ; supprimer le worker plutôt que le réparer ; traiter le scheduler en P2 ; ne pas toucher aux gardes `getCurrentProject()?.path`.
- **10 changements les plus importants** : 1) échappement XSS ciblé ; 2) normalisation `/` Windows ; 3) guillemets `history.js` ; 4) intégrité écriture `.bib` ; 5) scoping FS per-commande ; 6) CSP + sandbox ; 7) codes d'erreur structurés ; 8) décision Ctrl+S + README ; 9) gate scheduler + `loadHtml` async ; 10) CI clippy/audit/check-windows.
- **Déconseillés** : rewrite scheduler, framework/bus d'événements, world par session (prématuré), DOMPurify tutoriel, renommage crate, échappement global dans `t()`, suppression de `withGlobalTauri` (gros chantier pour peu de gain), bump Typst 0.16 mélangé aux fixes.

---

## 9. Conclusion (niveau architecte)

> Si je prenais la responsabilité du projet aujourd'hui : **cette semaine** — le batch de one-liners (guillemets history, normalisation Windows, `onClick`, awaits/toasts) et l'échappement XSS ciblé avec 3-4 tests jsdom. **Ensuite** — l'intégrité `.bib` (c'est de la donnée utilisateur silencieusement corrompue, inacceptable), puis CSP + scoping FS. **Ensuite** — robustesse preview (gate + async, en supprimant le worker mort) et les codes d'erreur structurés. **Je laisserais volontiers tels quels** : le scheduler global (correct grâce au sémaphore), `wire.js`, l'état statique du monde Typst, `withGlobalTauri`, la structure des crates, et je reporterais le multi-fichiers / la montée Typst 0.16 à un chantier dédié.