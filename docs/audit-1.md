# Audit approfondi — Typst IDE (passe 1)

> périmètre : `crates/` (Rust, ~3 200 lignes), `frontend/src/` (JS/HTML/CSS, ~9 600 lignes hors CSS généré), CI, scripts, hooks. Toutes les citations `file:line` sont vérifiées par lecture directe du code.

---

## 1. Compréhension du projet & résumé d'architecture

**Objectif.** Éditeur Typst local, construit avec Tauri 2 (Rust) + Vite/Monaco (JS vanille). Remplaçant d'un ancien projet Electron. L'auteur signale lui-même dans le README qu'il apprend Rust sur ce projet ; la barre de qualité attendue doit être lue avec ce contexte.

**Workspace Cargo** (`Cargo.toml`) :
- `crates/app` (`typst-ide-app`, bin `typst-ide`) : couche Tauri — `main.rs`, `state.rs`, `commands/` (wrappers Tauri minces), `tests.rs`.
- `crates/core` (`core`) : logique métier — `compiler/`, `database/`, `features/`, `fs/`. Expose `lib.rs`.
- `crates/typst-as-library` : implémentation du `typst::World` (fork de `tfachmann/typst-as-library`), téléchargement de paquets Typst.

**Frontend** : JS vanille modulaire (~40 modules) compilé par Vite. Monaco en bundle (pas via le plugin Vite officiel). Aucun framework. i18n fr/en maison. Tests Vitest (3 fichiers).

**Flux de données principaux.**
1. **Édition → preview.** Monaco `onChange` → debounce adaptatif (100–500 ms) → `scheduleCompile()` → `invoke('render_preview', {source, root, cursor})` → Rust `spawn_blocking` → `compile_to_preview_html` (world persistant + cache SVG par hash de page) → `PreviewResult{pages[].{svg,hash}, jump_pos, timings}` → MAJ DOM incrémentale *(chunkée 8 ms)* dans une `<iframe>` blob. Click sur la preview → `invoke('resolve_preview_click', {page,x,y})` → `jump_from_click` → curseur Monaco.
2. **Sauvegarde.** Autosave debounce 800 ms → `save_file`. Export PDF via `pick_pdf_path` + `export_pdf` (`compile_to_pdf`).
3. **Sync fichier externe.** Polling 2 s + focus → `file_hash` (FNV-1a 64) comparé au hash du buffer éditeur.
4. **Notes/Historique** : SQLite (`notes.db`, `history.db`) via `Mutex<Connection>` dans le state Tauri. Bibliographie désormais sans DB (lecture/écriture directe des `.bib`).
5. **Templates** : dossier `app_config_dir/templates/`, copie récursive.

**Points d'entrée.** `crates/app/src/main.rs` (`tauri::Builder`, gestion de state, fenêtre tutoriel), `frontend/src/index.html` → `js/main.js` (bootstrap), `frontend/src/tutorial.html` → `js/tutorial.js`.

**Sécurité/IPC actuelle.** `tauri.conf.json` : `withGlobalTauri: true`, **aucune CSP**, `capabilities/default.json` expose `opener:allow-open-url` sur `https://**`. Les commandes Rust FS (`read_file`, `save_file`, `delete_file_or_dir`, `read_image_as_base64`, `export_pdf`, etc.) prennent des chemins absolus arbitraires **sans aucune validation ni scoping**.

---

## 2. Audit technique

### 2.1 Architecture

| # | Problème | Détail |
|---|---|---|
| A1 | **Code mort / duplication de la couche FS** | `crates/core/src/fs/files.rs` (123 l.) définit `read_file/write_file/create_file/delete_file/file_exists/copy_file` mais **aucun appelant** : `crates/app/src/commands/fs.rs` réimplémente tout en inline. Le module n'est utilisé que par ses propres tests. |
| A2 | **Point d'entrée mort** | `crates/core/src/main.rs` = `fn main(){ println!("Hello, world!"); }`. Comme `core` expose aussi `lib.rs`, Cargo auto-découvre un binaire `core` qui ne fait rien — build/test inutile, confusion. |
| A3 | **Module/compiler morts** | `crates/core/src/compiler/export.rs` est vide ; son `pub use export::export_to_pdf` est commenté dans `mod.rs:9`. La fonction `compile()` (`compile.rs:504-513`, avec `.expect("Error compiling typst")`/`"Error writing PDF."`) n'est **pas re-exportée** et n'est appelée que par son propre test → fonction publique morte avec panic latent. |
| A4 | **État global mutable statique côté Rust** | `PREVIEW_WORLD` et `SVG_CACHE` sont des `static OnceLock<Mutex<…>>` (`compile.rs:35,47`). Rend le crate non-réentrant, impossible à tester en parallèle (les `cargo test` se partagent l'état). Acceptable pour une app mono-fenêtre mais freinera l'évolution (multi-projets/onglets). |
| A5 | **Phase faible inconsistante** | `core` porte `database` (SQLite) **et** `features/bibliography` (parsing `.bib` pur, sans DB). Cohérent avec la release note v1.5 (« bibliography without database »), mais `core` mélange désormais logique pure (parsing), I/O fichier, et ORM — pas de séparation « repository / domain ». |
| A6 | **Surface IPC non scopée** | Les commandes FS reçoivent `path: String` et agissent sur l'absolu sans allow-list. Toute compromission du frontend (XSS) ⇒ FS arbitraire. Violation du least-privilege au niveau « boundary backend ». |
| A7 | **Couplage global côté JS** | `window.__typstEditor`, `window.monaco`, `window.__TAURI__` utilisés franchement (`history.js:257`, `main.js:9,57`). `manage_files/wire.js` est un registre de callbacks pour éviter les imports circulaires (`operations.js` appelle `wireGet("refresh")`) — obscure. |

### 2.2 Qualité du code

| # | Problème | Détail |
|---|---|---|
| C1 | **`new Promise(async (resolve) => …)`** (`preview.js:444`) | Anti-promise : si `createBlobUrlAsync` rejette, la promesse externe n'est jamais résolue ni rejetée → `await loadHtml` reste pending à vie, **le scheduler de preview se gèle**. |
| C2 | **`strings/template → innerHTML` partout** | Motif dominant et systémique. Cf. §2.4. La racine de la majorité des XSS. |
| C3 | **`createSearchBar` dupliqué ×5** | `notepad.js`, `history.js`, `bibliography.js`, `sources.js`, `templates/index.js`, `manage_files/index.js` — ~30 lignes quasi identiques à chaque fois. |
| C4 | **`i18n.t()` non sûr** | `i18n/index.js:11-13` : `val.replace('{${k}}', v)` — (a) remplace **seulement la 1re occurrence**, (b) insère `v` sans escaping. Active chaque XSS « filename via showConfirm ». |
| C5 | **Gestion d'erreurs incohérente** | Mélange `showToast('error', t(..{error:err}))`, `writeToConsole`, `catch (_){}`, fire-and-forget (`notepad.js:188,260` `invoke('add_note'/'update_note')` non-awaited), match sur chaînes françaises (`operations.js:192,213` ; `form.js:206,224` ; `instantiate.js:33`). Pas de reporter central. |
| C6 | **Optional-chaining incohérent** | `project.js:94` utilise `?.` ; `project.js:106-112` non (peut crasher `main()` si `open-project-btn` manque). Idem `structures.js:666-667`. |
| C7 | **Touches mortes / valeurs inutiles** | `project.js:20` `projectHistory = JSON.parse(...)` puis la variable est commentée/morte partout (risque crash au démarrage pour 0 bénéfice). `editor.js:77-150` `handleImagePaste` est mort et inscrirait du base64 directement dans le `.typ` (sans `save_data_image`). |

### 2.3 Bugs & robustesse

→ Vérifiés par lecture directe du source.

| # | Fichier:ligne | Bug | Impact |
|---|---|---|---|
| B1 | `preview.js:336-343` | Le branch « throttle » `setTimeout(_runCompile, gap-sinceLast); return;` **ne pose pas `_compileRunning`**, et `_runCompile` **ne le re-vérifie pas à l'entrée**. Si le debounce retombe dans la fenêtre de throttle, deux `setTimeout(_runCompile)` sont en file ; le 2e peut démarrer une compile **concurrente** avec la 1re. Pas de garde de « fraîcheur » sur `await invoke('render_preview')` → un résultat plus ancien peut écraser le plus récent ; `_pendingRun` peut être perdu → la preview cesse d'updater jusqu'au prochain caractère. | Réel, reproductible à la frappe sur petits docs (gap 100 ms). |
| B2 | `preview.js:444` (`loadHtml`) + `preview-worker.js` | `preview-worker.js` n'a **pas de `onerror`/try-catch**, et `createBlobUrlAsync` n'a pas de chemin de rejet. Si `new Blob`/`URL.createObjectURL` throw dans le worker → `_blobCallbacks[id]` jamais appelé → `loadHtml` pending à vie → scheduler gelé (cf. C1). | Blocage preview, nécessite reload projet. |
| B3 | `history.js:101` et `:162` | `<div class="history-entry-form>` — **guillemet non fermé** → le parser HTML reconstruit un layout cassé pour les modals « add » et « edit » history. | Modal dégradé. |
| B4 | `bibliography.js:108` | Bouton « Cancel » : `onclick: (close) => close()` — `modal.js:76` ne déstructure que `onClick` (camelCase) → **le bouton Cancel de « créer bibliographie » est inactif** (seul `×`/Escape ferme). | UX cassé. |
| B5 | `structures.js:141` (table) et `:290` (grid) | `if (i !== cols - 1) cells += \`\t\`;` — devrait être `i !== rows - 1`. Avec `rows=3,cols=2` la dernière ligne reçoit une tab parasite et la 2e n'en a pas → Typst mal formé. Dupliqué dans la grid. | Code Typst inséré incorrect. |
| B6 | `trees.js:339-389` | `setupImagePreview` : si la souris quitte **avant** que `await invoke('read_image_as_base64')` ne résolve, `mouseleave` voit `previewEl === null` → rien n'est retiré ; l'invoke résout ensuite, crée le tooltip, l'attache à `<body>` → **tooltip fantôme permanent**. | UI. |
| B7 | `project.js:20` | `JSON.parse(localStorage.getItem('project-history') ?? '[]')` au chargement du module, **sans try/catch** → `localStorage` corrompu = **écran blanc au démarrage**. Et la donnée est morte. | Crash démarrage. |
| B8 | `project.js:78-88` | Autosave : si `save_file` échoue, `catch` toast puis **ne replanifie pas**. L'utilisateur arrête de taper ⇒ buffer non sauvegardé jusqu'au prochain caractère. | Perte silencieuse (transitoire). |
| B9 | `toolbar.js:154-162` | `while (children.length > MAX_LOG_ENTRIES) removeChild(...)` puis `appendChild` → le max réel est **201**, pas 200. | Mineur. |
| B10 | `modal.js:99-106` | `closeAll()` retire les overlays mais **ne résout pas** les promesses des `showConfirm`/`showPrompt` sous-jacentes → fuite de promesses / appelants bloqués. | Edge. |
| B11 | `notepad.js:188,260` | `invoke('add_note'/'update_note')` non awaited → si échec, toast absent et le modal se ferme « en succès ». | UX trompeuse. |
| B12 | `bibliography.js:283-289` | `invoke('delete_file_or_dir')` sans try/catch → toast « supprimé » affiché même en échec, la liste refresh masque l'erreur. | Trompeur. |
| B13 | `sources.js:222` | `body.querySelector("input[placeholder='" + t('source.id_placeholder') + "']")` — si une trad contient `'` ou `]`, le sélecteur jette et le flux « add source » casse. | Fragile. |
| B14 | `preview.js:619-633` | Le `requestAnimationFrame` post-compile (resize/scroll) **n'est pas gardé par `_frameGeneration`** ; un switch de projet pendant le rAF peut scroller la nouvelle frame avec des valeurs de l'ancienne. | Scintillement/flicker. |
| B15 | `file-sync.js:79` | `_lastSavedHash ??= editorHash` fige la baseline sur l'état **éditeur** au 1er poll, pas sur le disque → masque une divergence initiale. | Sémantique edge. |
| B16 | `core/compiler/compile.rs:508,511` | `.expect("Error compiling typst")`/`"Error writing PDF."` — seulement atteignables via test aujourd'hui (cf. A3), mais panic-prone si jamais réactivé. | Mineur (dead). |

### 2.4 Sécurité — la famille XSS (systémique)

Contexte amplificateur confirmé : **pas de CSP** (`tauri.conf.json`), `withGlobalTauri: true`, et la couche Rust FS **ne valide aucun chemin** ⇒ toute XSS → lecture/écriture/suppression de fichiers arbitraires (`delete_file_or_dir`, `save_file`, `read_image_as_base64`, `export_pdf`) + ouverture d'URLs (`opener`).

| # | Fichier:line | Sink | Source | Sévé |
|---|---|---|---|---|
| S1 | `history.js:238-245` | `body.innerHTML = \`...${content}...\`` | `info.content` = `invoke('open_project')` = **contenu brut du `main.typ`** du projet | **Critique** |
| S2 | `sources.js:78-117` | `entryEl.innerHTML`, `value="${value}"`, `data-citekey="${entry.cite_key}"`, `value="${entry.cite_key}"` | `parse_bib_file` (`.bib` non fiable, p.ex. téléchargé) | **Critique** |
| S3 | `notepad.js:131-149,234,240,307` | `noteEl.innerHTML`, `value="${note.title}"`, `<textarea>${note.content}</textarea>` | `get_*_notes` (notes partagées entre projets/utilisateurs) | **Élevée** |
| S4 | `modal.js:52,66,133` (showConfirm) via `t()` non-escaping | `${message}` dans `<p>` | noms de fichiers / chemins / cite-keys / erreurs passés à `showConfirm` partout (ex. `operations.js:180,293`, `sources.js:138`) | **Élevée** — la voie la plus exploitable : un fichier nommé `<img src=x onerror=window.__TAURI__.core.invoke('delete_file_or_dir',{path:'…'})>.typ` déclenche du code au clic « Supprimer » du file manager. |
| S5 | `history.js:73-91,165` | `${entry.name}`/`${entry.path}` (tnote), `value="${entry.path}"` | DB history (contrôlée par l'utilisateur) | Moyenne |
| S6 | `bibliography.js:70-86` | `id="bibliography-${entry.title}"`, `${entry.title}` | nom de `.bib` | Moyenne |
| S7 | `index.html:399` | iframe `sandbox="allow-same-origin allow-scripts"` | Typst SVG (le blob URL est same-origin avec le parent) | Défense en profondeur |
| S8 | `index.html:286,292`, `structures.js:106,255,462,612` | `onclick="window.__TAURI__.opener.openUrl(...)"` inline | URLs hardcodées | Pattern risk / incompatible CSP stricte |
| S9 | `tutorial.js:106` | `innerHTML = marked.parse(source)` sans DOMPurify | assets markdown build-time (**trustés aujourd'hui**) | Défense en profondeur |

> **Note d'incertitude (S7).** Je n'ai **pas** vérifié si `typst_svg` ré-écrit/strips les `<script>` des SVG embarqués (via `#image("evil.svg")`). Je marque donc S7 comme **défense en profondeur**, pas comme exploit confirmé. Le risque certain tient à S1–S4+S6, qui sont dans le DOM parent (pas l'iframe) et donc **100 % exploitables** indépendamment de Typst.

**Autres sécurité.** Package download dans `typst-as-library/src/lib.rs:184-240` : `https://packages.typst.org/...` via `ureq` avec 1 retry, décompresse `tar`+gzip **dans le cache sans vérif de chemin (tar traversal)** (`archive.unpack(&path)` seul). Typst upstream valide les entrées ; ce fork ne ré-applique pas de garde. Faible en pratique (source officielle) mais à surveiller. Pas de TLS pinning. `unsafe { set_var(...) }` au démarrage (`main.rs:56`) — commenté comme safe (avant tout thread) ; OK. Pas d'auth/authz attendu (app locale).

### 2.5 Performance

| # | Fichier:line | Problème |
|---|---|---|
| P1 | `tree.js:128-153` | `buildNestedTree` : `current.children.find(c => c.name === part)` linéaire par segment → O(n·depth). À remplacer par `Map` par niveau. |
| P2 | `tree.js:34-87` | `rebuildTreeView` fait `container.innerHTML = ""` + reconstruction totale à **chaque touche** de la barre de recherche. Differ ou virtualiser. |
| P3 | `toolbar.js:190` | `container.getBoundingClientRect()` à chaque `mousemove` pendant le resize du split → layout-thrash. Cacher sur `mousedown`. |
| P4 | `webview-zoom.js` | Pas de debounce sur le zoom via Ctrl+Shift++ repeat → rafale d'IPC `set_webview_zoom`. |
| P5 | `file-sync.js` | Polling 2 s **+** focus **+** setTimeout(0) au switch projet, sans garde de chevauchement → IPC redondants. |
| P6 | `operations.js` | Chaque op FS appelle `refreshTree` (full `list_directory` récursif). `handleDelete` montre la bonne voie (mutate local + remove `li`). |
| P7 | `compile.rs:380-411` | `svg_cache().lock()` tenu pendant **tout** le render SVG + un second `hash128` pass (405-409) pour le `retain`. Le hash est re-calculé deux fois par page. Miner : hash once. |
| P8 | `main.js:9` + Monaco | Monaco bundlé en un gros chunk (le plugin Vite Monaco est commenté dans `vite.config.js`). MAJ/CSP initiaux plus lourds. |

### 2.6 Tests

- **Rust** : `crates/app/src/tests.rs` (162 l., 5 tests) — notes/history CRUD via `tauri::test` mock, `render_preview` ok/err, déterminisme `project_id`. **Correct pour ce qu'il couvre**. Aucun test pour `compile_to_preview_html` (cache, jump, `resolve_click`), `bibliography.rs` (couvert : 6 tests, bien), le scheduler `preview.js` (hors scope Rust), `templates.rs` (0 test).
- **Frontend** : **3 fichiers** Vitest (`file-hash`, `i18n`, `tutorial`) — ne couvrent que des fonctions pures. **Zéro test** pour `preview.js` (le module le plus complexe et le plus buggy), `file-sync.js`, `project.js`, `modal.js`, `manage_files/*`, `bibliography/sources.js`. Pas de tests DOM/jsdom → aucun garde XSS.
- **CI** : `ci.yml` (PR + push main) build + tests Rust + tests front + `manage.sh check`. `release.yml` (tag) build Linux + Windows. **Pas de macOS** ; **pas de clippy** ni de frontend lint ; **pas d'audit NPM** (`npm audit`).
- **Hooks** : `pre-commit` (38 l., versions+fmt), `pre-push` (59 l., cohérence). Rien côté tests (long).

### 2.7 Dépendances & configuration

- `serde_json = "*"` et `regex = "*"` dans `core/Cargo.toml` : versions non épinglées → reproductibilité faible.
- `core` porte `rusqlite` `bundled` + `uuid`, `chrono`, `sha2`, `regex` — mais `regex`/`sha2` ne servent visiblement qu'à `notes_db` (sha256 project_id) ; `regex` non utilisé côté core après audit rapide (à confirmer). Pourrait être allégé.
- Fork `typst-as-library` embarqué (mécanisme de MAJ non défini — noté dans `TODO.md`). Crates Typst épinglés en `0.15` (sortie récente) : surface de maintenance.
- `font-kit 0.14` (app) pour `font_exists`/`suggest_font` — lourd pour 2 fonctions ; `misc.rs:11-18` construit un `SystemSource` à chaque appel `font_exists`. `suggest_font` met en cache via `OnceLock`.
- `tauri-plugin-opener` avec `https://**` : large mais limité au protocole https (cf. TODO).
- `package.json` frontend : `type: "commonjs"` mais le code est en ES modules Vite — incohérence de déclaration (sans effet pratique car Vite gère).
- `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `strip = true` pour la release — agressif (compilations longues) mais cohérent avec la cible « binaire léger ».

---

## 3. Priorisation

> Sévérité P0 = critique/sécurité, P1 = bug réel ou Sévé élevée, P2 = moyen, P3 = nitpick/qd. Les XSS dominent.

### P0 — Sécurité (corriger avant toute release)

| | Cat. | Fichiers | Problème | Impact | Solution | Effort |
|---|---|---|---|---|---|---|
| P0-1 | **sécurité** | `tauri.conf.json`, `capabilities/default.json`, `index.html`, tous les `innerHTML` (history, notepad, sources, bibliography, modal, tree) | XSS systémique : données backend/contrôlées par l'utilisateur interpolées sans escaping dans `innerHTML`/attributs, **sans CSP**, `withGlobalTauri:true`, et backend FS sans scoping → RCE-FS complète | Compromission totale de l'app et des fichiers utilisateur via un projet/`.bib`/note/fichier malicieux | (1) Ajouter une CSP ; (2) introduire `escapeHtml`/`escapeAttr` (déjà dans `tutorial-highlight.js`) et l'appliquer **partout** ; préférer `createElement + textContent/setAttribute` ; (3) faire échapper `t()` par contexte (ou substituer au niveau DOM) ; (4) retirer `allow-scripts` du sandbox iframe (et idéalement `allow-same-origin`) ; (5) **valider/scoper les chemins côté Rust** (allow-list racines projet + `app_config_dir`) | élevé |
| P0-2 | **sécurité** | `history.js:238-245`, `sources.js:78-117`, `notepad.js:131-149,234,240,307` | Sinks XSS critiques (contenu fichier/note/données `.bib`) | Exécution de code au moindre projet/`.bib` ouvert | Mêmes correctifs (prioriser ces 3 fichiers) | moyen |

### P1 — Bugs réels & robustesse

| | Cat. | Fichiers | Problème | Solution | Effort |
|---|---|---|---|---|---|
| P1-1 | **bug/concurrence** | `preview.js:326-370` (scheduler) | Race du throttle : compiles concurrentes + écrasement par résultat stale + `_pendingRun` perdu | Re-vérifier `_compileRunning` en tête de `_runCompile` (ou tracker `_throttleTimer` + `clearTimeout`) + garde de fraîcheur sur le résultat IPC | faible |
| P1-2 | **bug/robustesse** | `preview.js:444`, `preview-worker.js` | `Promise(async)` + worker sans `onerror` → gel permanent du scheduler en cas d'échec Blob | Réécrire `loadHtml` en `async function` (sans `new Promise`) ; ajouter try/catch dans le worker + chemin de rejet dans `createBlobUrlAsync` | faible |
| P1-3 | **bug** | `project.js:20` | `JSON.parse` sans try/catch → crash démarrage + donnée morte | Try/catch (ou supprimer la variable morte) | faible |
| P1-4 | **bug** | `project.js:106-112` ; `structures.js:666-667` | `getElementById(...).classList.add(...)` sans `?.` → peut crasher `main()` | Optional-chaining | faible |
| P1-5 | **bug** | `history.js:101,162` | `class="history-entry-form>` guillemet manquant → modal cassé | Fermer l'attribut | faible |
| P1-6 | **bug** | `bibliography.js:108` | `onclick` vs `onClick` → bouton Cancel inactif | Renommer en `onClick` | faible |
| P1-7 | **bug** | `structures.js:141,290` | Off-by-one `cols-1` vs `rows-1` → Typst mal formé | Remplacer par `rows - 1` (et dédupliquer) | faible |
| P1-8 | **bug** | `tree.js:339-389` | Tooltip image fantôme si souris quitte pendant l'`invoke` | Flag `stillHovering` ; après `await`, `if(!stillHovering) return` | faible |
| P1-9 | **robustesse** | `project.js:78-88` ; `notepad.js:188,260` ; `bibliography.js:283-289` | Échecs silencieux / non replanifiés / toasts menteurs | Await + retry/Toast erreur ; replanifier autosave | faible |
| P1-10 | **robustesse** | `operations.js:192,213` ; `form.js:206,224` ; `instantiate.js:33` | Match sur chaînes d'erreur FR → casse si wording change | Codes d'erreur structurés côté Rust (enum sérialisé) | moyen |

### P2 — Maintenabilité / perf

| | Cat. | Fichiers | Problème | Solution | Effort |
|---|---|---|---|---|---|
| P2-1 | maintenabilité | `core/fs/files.rs`, `core/main.rs`, `compile()` fn, `compiler/export.rs` | Code mort / duplications | Supprimer (et leurs tests) ; le FS helper n'est pas utilisé | faible |
| P2-2 | maintainabilité | `notepad.js`, `history.js`, `bibliography.js`, `sources.js`, `templates/index.js`, `manage_files/index.js` | `createSearchBar` ×5 | Extraire un module partagé | faible |
| P2-3 | tests | `preview.js`, `file-sync.js`, `project.js`, `modal.js`, `manage_files/*`, `sources.js` | 0 test sur les modules critiques | jsdom + tests "payload adverse" sur les builders de liste ; tests du state-machine preview | moyen |
| P2-4 | performance | `tree.js:34-87,128-153` | Rebuild DOM/touche ; `buildNestedTree` O(n·depth) | `Map` par niveau ; differ/virtualisation | moyen |
| P2-5 | performance | `toolbar.js:190` ; `webview-zoom.js` ; `operations.js` | Thrash/IPC rafales ; refreshTree systématique | Cacher `rect` ; debounce zoom ; mutate-local comme `handleDelete` | faible |
| P2-6 | performance | `compile.rs:380-411` | `hash128` calculé 2×/page + mutex tenu pendant tout le render | Hasher une fois ; copier les hashes hors lock | faible |
| P2-7 | dépendances | `core/Cargo.toml` | `serde_json="*"`, `regex="*"`, `font-kit` lourd | Pincer les versions ; vérifier usage réel de `regex` ; envisager `typst-kit` fonts au lieu de `font-kit` | faible |
| P2-8 | DX | `ci.yml` | Pas de clippy, pas de `npm audit`, pas d'ESLint/Prettier, pas de macOS | Jobs clippy + audit + lint front ; build macOS | moyen |
| P2-9 | robustesse | `modal.js:99-106` | `closeAll()` fuit les promesses des `showConfirm`/`showPrompt` | Tracker + résoudre les promesses outstanding | moyen |
| P2-10 | sécurité/défense | `index.html:286,292`, `structures.js:*inline onclick*` | Handlers inline incompatibles CSP stricte | `addEventListener` dans `toolbar.js` | faible |

### P3 — Détails

`toolbar.js:154` off-by-one log trim ; `i18n t()` remplace 1re occurrence uniquement ; `index.html:350` caractère `²` parasite ; `editor.js:77-150` `handleImagePaste` mort ; `compile.rs` `eprintln!`/`println!` (cf. `bibliography.rs:110` « Fichier créé » qui devrait être silencieux) ; `core` package name générique qui « collisionne » conceptuellement avec `std::core`.

---

## 4. Améliorations à fort ROI

1. **Helper `escapeHtml`/`escapeAttr` + discipline `createElement/textContent`** : un seul changement de motif ferme toute la classe XSS (P0-1, P0-2) — effort moyen, impact énorme.
2. **CSP + retrait `allow-scripts` iframe** : 5 lignes de config, divise le risque par 2.
3. **Scoping FS côté Rust** : allow-list « racine projet + app_config_dir » — transforme une XSS éventuelle en « pas FS arbitraire ». Fort effet de bord blast-radius.
4. **Garde `_compileRunning` en tête de `_runCompile` (P1-1)** : 2 lignes, élimine la race la plus probable du scheduler.
5. **Réécriture de `loadHtml` en `async` standard + `onerror` worker (P1-2)** : ≈10 lignes, supprime un gel fatal.
6. **Suppression du code mort `core/fs/files.rs`, `core/main.rs`, `compile()` fn, `compiler/export.rs`** : chiaroscuro immédiat de la surface.
7. **Extraction de `createSearchBar` + `escapeHtml` partagé** : -150 lignes dupliquées.
8. **Tests jsdom « payload adverse »** sur les builders (`buildNoteElement`, `rebuildSourcesList`, `*Entry`) → filet rouge XSS permanent.
9. **Codes d'erreur structurés côté Rust** (enum) → supprime le match de chaînes françaises fragile partout.
10. **CI : `cargo clippy -D warnings` + `npm audit` + build macOS** → qualité garante.

---

## 5. Architecture cible (évolution progressive)

**Garder tel quel.**
- Le trio de crates `app` (Tauri) / `core` (métier) / `typst-as-library` (World) : bonne séparation.
- Le scheduler `preview.js` (debounce/throttle adaptatif, MAJ DOM incrémentale chunkée, garde `_frameGeneration`) : design sain, juste à corriger la race.
- Le cache world persistant + cache SVG par hash (`compile.rs`), `spawn_blocking`, sémaphore(1) : bons choix perfs.
- `manage.sh` (versionning, check, tests), hooks, CI PR : bonne DX.
- Tests `bibliography.rs` et `tauri::test` mock : modèles à étendre.

**Refactorer.**
- **Couche FS Rust** : introduire un `FsResolver` qui normalise/valide les chemins (canonise, rejette hors racines autorisées) et centralise les opérations (finit la duplication `core/fs/files.rs` vs `commands/fs.rs`). Toutes les commandes passent par lui — point unique d'autorisation (cf. P0 scoping).
- **i18n** : `t()` doit substituer au niveau DOM ou exposer `tHtml(key, params)` échappé ; supprimer la sémantique « 1re occurrence ».
- **Frontend builders** : remplacer le motif `el.innerHTML = \`...${var}...\`` par un minuscule helper `h(tag, {attrs, children})` qui passe par `setAttribute`/`textContent` — élimine la classe XSS à la source.
- **`modal.js`** : `showConfirm`/`showPrompt`/`showSelect` via promise + registre pour `closeAll()` ; ne jamais `innerHTML` des messages (utiliser `textContent`).
- **Gestion d'erreurs** : un `reportError(err, ctx)` unique + codes structurés ; remplacer le match de chaînes.

**Supprimer.**
- `crates/core/src/main.rs`, `crates/core/src/fs/files.rs`, `crates/core/src/compiler/export.rs`, la fonction `compile()` de `compile.rs`, `editor.js#handleImagePaste`, `projectHistory` mort + son `JSON.parse`.
- Handlers `onclick` inline → `addEventListener`.

**Introduire.**
- **CSP** + **DOMPurify** pour `marked` (tutoriel) + **iframe sandbox restrictive** (`allow-same-origin` seul, ou `srcdoc` origine isolée).
- **Clippy + ESLint + Prettier + jsdom** en CI.
- Optionnel : un bus d'événements léger (remplaçant `wire.js` et `window.__typstEditor`).
- Pour l'évolution multi-fichiers (cf. TODO) : l'état global statique de `compile.rs` devra devenir une ressource par session/workspace (sinon collision entre onglets/fichiers).

**Communication inter-composants** : inchangée (invoke Tauri), mais chaque commande FS passe par le `FsResolver` validant ; le frontend ne construit plus de HTML par interpolation de chaînes.

---

## 6. Roadmap

> Dépendances indiquées par `(▶ après …)`.

### Phase 1 — Corrections critiques (sécurité + gel)
1. **CSP** dans `tauri.conf.json` + retrait `allow-scripts` iframe sandbox + droits `opener` resserrés.
2. **Scoping FS Rust** : allow-list racines (projet + app_config_dir) appliquée dans toutes les commandes FS (`read_file`, `save_file`, `delete_file_or_dir`, `read_image_as_base64`, `export_pdf`, `rename_file`, `create_dir`, `import_*`, `replace_file`, `reveal_*`, templates copy).
3. **Échappement systématique** : `escapeHtml/escapeAttr` aux sinks de `history.js`, `sources.js`, `notepad.js`, `bibliography.js`, `modal.js` (showConfirm), `tree.js:29`. (▶ après 1 si on veut valider via CSP.)
4. **`t()`** : substituer toutes les occurrences + échapper `v` (ou migration au DOM). (▶ dépend de 3.)
5. **Race scheduler `preview.js`** (garde `_compileRunning`) + **`loadHtml` async** + **worker `onerror`/rejet**.

### Phase 2 — Quick wins (faible effort, impact réel)
6. Corriger les bugs « une ligne » : `history.js:101,162` (guillemet), `bibliography.js:108` (`onClick`), `structures.js:141,290` (`rows-1`), `tree.js` tooltip fantôme, `toolbar.js:154` log trim.
7. `project.js:20` (try/catch ou suppression), `project.js:106` et `structures.js:666` optional-chaining.
8. Autosave replanifié en échec ; `add_note`/`update_note` awaited ; `delete_file_or_dir` toasts corrects.
9. Supprimer le code mort (A1-A3 + `editor.js#handleImagePaste`).
10. Dépendances : pincer `serde_json`, `regex` ; vérifier usage réel.
11. Handlers inline → `addEventListener` (`index.html:286,292`, `structures.js`).

### Phase 3 — Refactoring (qualité durable)
12. **Codes d'erreur structurés Rust** (enum sérialisé) → frontend match sur code, pas sur texte FR. (▶ active la suppression des match de chaînes P1-10.)
13. **`FsResolver`** central + déduplication `commands/fs.rs` vs `core/fs/files.rs`.
14. **`h()` helper DOM** + extraction `createSearchBar` partagée + `escapeHtml` mutualisé.
15. **`modal.js`** : registre de promesses pour `closeAll()` ; `showConfirm` via `textContent`.
16. **Tests jsdom** : builders de liste + payload adverse ; tests state-machine `preview.js` ; tests `file-sync.js` baseline. (▶ après 5 et 14.)

### Phase 4 — Améliorations structurelles (moyen/long terme)
17. **Lint CI** : `cargo clippy -D warnings`, ESLint+Prettier, `npm audit`, job build macOS.
18. **Performances** : `tree.js` `Map` + virtualisation ; `compile.rs` hash-once + mutex plus court ; `operations.js` mutate-local.
19. **Évolution multi-fichiers/onglets** : transformer l'état global statique `compile.rs` en une ressource par session (sinon collision dès l'ouverture de plusieurs `.typ`).
20. **Procédure de suivi de version Typst** (TODO) + mise à jour automatique (`tauri-plugin-updater`) + signature.
21. DOMPurify pour `marked` (tutoriel) ; isolation origine de l'iframe preview (`srcdoc`).

---

## 7. Conclusion

**5 problèmes les plus importants.**
1. **XSS systémique** (history/notepad/bibliography/modals) sans CSP + backend FS sans scoping ⇒ compromission totale via un simple fichier/`.bib`/note malicieux. **Cas confirmés** : `history.js:238-245`, `sources.js:78-117`, et la voie pratique via `showConfirm` (`operations.js:180,293`).
2. **Race du scheduler de preview** (`preview.js:336-343`) : compiles concurrentes, résultat stale écrasant le récent, mises à jour perdues.
3. **Gel potentiel du scheduler** (`preview.js:444` + `preview-worker.js`) si le worker échoue silencieusement.
4. **Couche FS Rust sans scoping/validation** — amplificateur obligatoire de (1), mais vrai en soi.
5. **Debt/robustesse frontend** : bugs UX silencieux (Cancel inactif, autosave non replanifié, toast menteur `delete_file_or_dir`, match sur chaînes FR), code mort, 0 test sur les modules critiques.

**5 améliorations au meilleur ROI.**
1. `escapeHtml`/`escapeAttr` + `createElement/textContent` partout (+ `t()` safe).
2. CSP + retrait `allow-scripts` iframe + droits opener resserrés.
3. Scoping FS Rust (allow-list racines).
4. Garde `_compileRunning` + `loadHtml` async standard (2 correctifs ≈ 15 lignes).
5. Suppression code mort + extraction `createSearchBar`/helpers partagés.

**Risques à surveiller si le projet évolue sans refactor.**
- Toute nouvelle feature affichant du contenu (multi-fichiers, templates partagés, packages externes, custom tutorials) **héritera du motif XSS**.
- L'état global statique `compile.rs` empêchera le multi-onglets/fichiers (collision de cache world/SVG) — objectif explicite du TODO.
- Le match sur chaînes FR cassera silencieusement à la première refonte de wording backend.
- Une montée de version Typst (0.15→0.16) avec ce fork `typst-as-library` à maintenir : `download_package` (sans garde tar-traversal, pas de pinning TLS) devient une surface à risque.
- Aucun filet rouge (`clippy`, lint front, tests DOM) : les régressions XSS/bug scheduler reviendront.

**Notes (0–10).**

| Axe | Note | Justification |
|---|---|---|
| Architecture | 6/10 | Split de crates sain ; bonne scission app/core ; mais code mort, état global, couche FS non scopée, motif front peu maintenable. |
| Qualité du code | 5/10 | Code clair et commenté par endroits (ex. `compile.rs`, `preview.js`) ; mais duplication, incohérences (optional-chaining, erreurs), motif `innerHTML` systémique. |
| Robustesse | 4/10 | Plusieurs bugs réels (scheduler, gels, autosave, toasts menteurs) ; gestion d'erreurs incohérente ; edge cases non couverts. |
| Sécurité | **2/10** | XSS critiques confirmés, pas de CSP, Tauri global, backend FS non scopé — combo RCE-FS. |
| Performance | 7/10 | Bonnes optimisations (cache world/SVG, debounce/throttle adaptatif, MAJ DOM incrémentale chunkée, spawn_blocking) ; quelques nids (tree.js, re-build/touche, hash 2×). |
| Tests | 3/10 | Tests Rust ciblés et corrects mais étroits ; frontend quasi non testé sur les zones critiques ; pas de tests DOM/XSS ; pas de clippy/lint/audit. |
| Maintenabilité | 5/10 | Lisibilité OK, mais couplage global (`window.__typstEditor`), `wire.js`, handlers inline, 5× `createSearchBar`, CI incomplète. |

**Actions concrètes ordonnées recommandées.**
1. Ajouter la **CSP** à `tauri.conf.json` + resserrer `capabilities` (opener) + retirer `allow-scripts` du sandbox iframe.
2. Implémenter le **scoping FS Rust** (allow-list racines projet + app_config_dir).
3. Injecter `escapeHtml/escapeAttr` dans les sinks critiques : `history.js:238-245`, `sources.js:78-117`, `notepad.js`, `bibliography.js`, `modal.js (showConfirm)`, `tree.js:29`.
4. Rendre `t()` sûr (toutes occurrences + escaping).
5. **Race scheduler** : ajouter `if (_compileRunning){ _pendingRun = true; return; }` en tête de `_runCompile` (et/ou tracker/clear le throttle timer).
6. Réécrire **`loadHtml`** en `async function` (sans `new Promise`) + `try/catch` dans `preview-worker.js` + chemin de rejet dans `createBlobUrlAsync`.
7. Pack bugs one-liners : `history.js:101/162` guillemet, `bibliography.js:108` `onClick`, `structures.js:141/290` (`rows-1`), tooltip `tree.js`, `project.js:20/106`, `toolbar.js:154`, `editor.js` mort, `projectHistory` mort.
8. Robustesse async : await `add_note`/`update_note` ; replan autosave ; try/catch `delete_file_or_dir` + toasts corrects.
9. Supprimer le code mort (`core/main.rs`, `core/fs/files.rs`, `compiler/export.rs`, `compile()` fn).
10. Codes d'erreur structurés Rust (enum) ; frontend matche sur code (supprime match FR `operations.js`/`form.js`/`instantiate.js`).
11. `FsResolver` + `h()` helper DOM + extraction `createSearchBar`/`escapeHtml` partagés.
12. CI : `cargo clippy -D warnings`, ESLint/Prettier, `npm audit`, job macOS.
13. Tests jsdom « payload adverse » sur les builders + tests scheduler `preview.js` + `file-sync.js`.
14. Perf : `tree.js` `Map`, `compile.rs` hash-once, `operations.js` mutate-local, debounce zoom.
15. (Long terme) État `compile.rs` par session pour le multi-fichiers, `tauri-plugin-updater`, DOMPurify tutoriel, suivi version Typst.