# Seconde passe critique — Typst IDE

> Cette seconde passe re-vérifie le premier audit en relisant le code réel. Elle corrige des faux positifs, affine les priorités, découvre des problèmes manqués, et produit un plan d'action définitif ordonné par risque de régression croissant.
>
> Aucun fichier du projet n'a été modifié durant cette passe.

---

## 1. Vérification des problèmes identifiés à la première passe

### CONFIRMÉS (problème réel, recommandation pertinente)

| ID | Vérification | Statut |
|---|---|---|
| **XSS-S1** `history.js:238-245` | `body.innerHTML = \`...${content}...\`` où `content = (await invoke('open_project')).content` = contenu brut du `main.typ`. Confirmé par lecture de `commands/fs.rs:64` (`std::fs::read_to_string`). | CONFIRMÉ |
| **XSS-S2** `sources.js:78-117` | `value="${value}"`, `data-citekey="${entry.cite_key}"`, `value="${entry.cite_key}"` avec `value` issu de `parse_bib_file`. Confirmé. **Voie la plus pratique** : ouvrir un `.bib` téléchargé → gestionnaire bib → crayon → XSS au rendu. | CONFIRMÉ |
| **XSS-S4** `modal.js:133` (showConfirm) | `body: \`<p>${message}</p>\`` → `openModal` fait `bodyEl.innerHTML = body` (`modal.js:66`). Confirmé. `message` vient de `t('file.delete_message', { name: relPath })` (`operations.js:180,293`). | CONFIRMÉ |
| **Pas de CSP + `withGlobalTauri: true`** | `tauri.conf.json` n'a pas de clé `security.csp`. Confirmé. | CONFIRMÉ |
| **`bibliography.js:108`** | `onclick:` (minuscules) vs `onClick` déstructuré (`modal.js:76`). Bouton Cancel inactif. | CONFIRMÉ |
| **`structures.js:141` et `:290`** | `if (i !== cols - 1)` au lieu de `rows - 1`. Confirmé sur les deux sites (table + grid). | CONFIRMÉ |
| **`history.js:101,162`** | `<div class="history-entry-form>` — guillemet manquant. Confirmé. | CONFIRMÉ |
| **`tree.js:339-389`** | Tooltip orphelin si `mouseleave` pendant l'`await invoke('read_image_as_base64')`. Confirmé. | CONFIRMÉ |
| **`project.js:20`** | `JSON.parse(localStorage.getItem('project-history') ?? '[]')` sans try/catch, variable ensuite morte. Confirmé. | CONFIRMÉ |
| **`project.js:106-111`** | Pas de `?.` sur `getElementById('open-project-btn').classList.add(...)`. Confirmé. | CONFIRMÉ |
| **`notepad.js:188,260`** | `invoke('add_note'/'update_note')` non awaited → échec silencieux. Confirmé. | CONFIRMÉ |
| **`bibliography.js:279-289`** | `invoke('delete_file_or_dir')` sans try/catch → toast "supprimé" même en échec. Confirmé. | CONFIRMÉ |
| **`toolbar.js:154-162`** | Trim avant append → max réel 201. Confirmé (trivial). | CONFIRMÉ |
| **Match sur chaînes FR** `operations.js:192,213`, `form.js:206,224`, `instantiate.js:33` | `err.includes("Aucun fichier sélectionné")`. Confirmé. | CONFIRMÉ |
| **`sources.js:222`** | `querySelector("input[placeholder='" + t(...) + "']")`. Confirmé. | CONFIRMÉ |
| **`i18n t()` non-échappé + 1re occurence** `i18n/index.js:12` | `val.replace('{${k}}', v)` — 1re occurence, `v` inséré brut. Confirmé. | CONFIRMÉ |
| **Code mort** `core/fs/files.rs`, `core/main.rs`, `compile()` fn, `compiler/export.rs`, `editor.js#handleImagePaste` | Confirmé (aucun appelant). | CONFIRMÉ |
| **`createSearchBar` ×5** | Confirmé (notepad, history, bibliography, sources, templates, manage_files). | CONFIRMÉ |
| **Pas de clippy / npm audit / macOS** en CI | Confirmé. | CONFIRMÉ |
| **`compile.rs:405-409` re-hash** | `typst_utils::hash128(p)` calculé 2× par page (render + retain). Confirmé. | CONFIRMÉ |

### À NUANCER (problème réel mais impact/solution à revoir)

| ID | Premier audit | Re-vérification | Nouveau statut |
|---|---|---|---|
| **Race scheduler `preview.js:336-343`** | "compiles concurrentes, stale écrase newer, preview stoppe" | Re-tracé avec le `Semaphore(1)` Rust (`state.rs:14`) : les 2 IPC sont **sérialisés côté Rust**, le 2e timer lit `getSource()` **après** le keystroke ⇒ le contenu final est correct (le newer écrase). Le `_pendingRun` "perdu" est auto-guéri car le 2e timer lit la source à jour. **Impact réel** : (a) compile redondante (wasted CPU), (b) **si A yield mi-update et B complète avant la reprise de A**, A peut réécrire des pages plus anciennes sur des pages plus récentes → glitch **auto-guéri au prochain keystroke**. | **P2** (et non P1). Correction toujours utile (gate `_compileRunning` en tête de `_runCompile`) mais non urgente. |
| **`loadHtml` Promise(async) + worker sans onerror** | "gel permanent du scheduler" | Le worker n'a pas de try/catch (`preview-worker.js:14-27`). `createBlobUrlAsync` n'a pas de chemin de rejet. Si le worker échoue (`URL.createObjectURL` jette — rare — ou worker ne spawn pas), `loadHtml` reste pending à vie → scheduler gelé. Sévère mais **faible probabilité** (uniquement sur gros docs > 512 KB HTML ET panne du worker). | **P2** (sévère, rare). Correction peu risquée. |
| **XSS-S3 notepad** | "High" | Les notes sont en **SQLite local** (`notes.db`), **non partagées via le dossier projet** (`project_id` = hash du chemin). Un projet partagé ne transporte PAS ses notes. L'exploit réel exigerait que l'attaquant ait déjà écrit dans la DB de l'utilisateur ⇒ compromission préalable. | **P2** (défense en profondeur), pas P0. |
| **Scoping FS Rust** | P0 | Defense-in-depth (réduit le blast-radius XSS + bugs frontend). **Ne peut pas être blanket** : `export_pdf`/`save_file` vers un chemin choisi par l'utilisateur (`pick_pdf_path`) doit rester arbitraire. | **P1** (scoping per-commande, pas global). |
| **iframe sandbox `allow-scripts`** | "neutralise script-in-SVG" | Je n'ai **pas** vérifié si `typst-svg` émet des `<script>`. C'est une **défense en profondeur** intéressante (le SVG Typst n'a pas besoin de JS), pas un exploit confirmé. | **À surveiller** + quick win (retirer `allow-scripts` est sans risque ; `setupClickHandler` attache le listener côté parent). |
| **`tar` unpacking `typst-as-library/src/lib.rs:234`** | "tar traversal" | `tar 0.4` bloque les entrées `..` par défaut. Probablement sûr. | **À surveiller**. |

### FAUX POSITIFS / RETIRÉS

| ID | Premier audit | Re-vérification |
|---|---|---|
| **`file-sync.js:79` `_lastSavedHash ??= editorHash`** | "masque une divergence au 1er poll" | **FAUX POSITIF**. Re-tracé : au 1er poll, si `disk ≠ editor` ⇒ on entre dans le `else` final ⇒ `setButtonsVisible(true)` (les buttons s'affichent). Le `??=` ne fait que poser la baseline ; les comparaisons suivantes sont correctes. **Retirer.** |
| **"preview stoppe jusqu'au prochain keystroke / stale écrase newer"** (conséquence B1) | P1 | **FAUX POSITIF (conséquence)**. Le `Semaphore(1)` Rust sérialise ; le 2e timer lit la source après le keystroke. Pas de perte, pas d'arrêt. Seul l'interleaving de chunks peut laisser une page stale transitoire. **Retirer cette conséquence** (garder le "wasted work + glitch" en P2). |
| **"`handleImagePaste` ferait gonfler le `.typ` s'il était rebranché"** | "Impact élevé" | **À nuancer** : c'est du code mort. L'impact "gonfler le `.typ`" est hypothétique. Garder uniquement comme "supprimer ce code mort", pas comme un bug actif. |

### DUPLICATS

| | |
|---|---|
| **XSS-S1/S2/S3/S4/S6** | Même **cause racine** : interpolation `${variable}` non-échappée dans `innerHTML`/attributs + `t()` non-échappé + pas de CSP. **Une seule correction systémique** (helper `escapeHtml`/`escapeAttr` + `t()` échappe ses params + CSP) ferme toute la famille. À traiter comme **un seul problème P0 multi-sinks**. |
| **`project.js exportPDF` vs `main.js savePdf`** | Deux chemins PDF divergents — duplicat, à fusionner (P3). |

### À SURVEILLER (risque futur)

| | |
|---|---|
| **`compile.rs:340` `lock().unwrap()`** | Si le mutex est empoisonné (panic d'un thread en tenant le lock), le `.unwrap()` panique → preview mort jusqu'au restart. `resolve_click` utilise `.ok()?` (incohérent). Inconsistance mineure. |
| **`commands/fs.rs:135` `collect_entries`** | Pas de garde contre les **boucles de symlinks** → récursion infinie possible sur `list_directory`. Cf. Nouveaux problèmes. |
| **`typst-as-library/src/lib.rs:220`** | Commentaire de l'auteur : *"ça a été changé du coup, possible que ça fonctionne plus"* sur l'API ureq 3.2. Incertitude. |
| **`typst-svg` émet-il des `<script>` ?** | Non vérifié. Si oui, le sandbox `allow-scripts` est un risque réel. |
| **État global statique `compile.rs` (PREVIEW_WORLD/SVG_CACHE)** | Bloque le multi-onglets/fichiers (TODO). Pas un problème aujourd'hui. |

---

## 2. Nouveaux problèmes découverts (seconde passe)

| ID | Fichier:ligne | Problème | Impact | Priorité |
|---|---|---|---|---|
| **NEW-1** | `crates/app/src/commands/fs.rs:135-175` | `collect_entries` récursif **sans détection de boucle de symlink**. Un `ln -s . self` dans le projet ⇒ `list_directory` part en récursion infinie (ou budget énorme). | Hang/crash du file manager. | **P2** |
| **NEW-2** | `crates/core/src/compiler/compile.rs:340` (`lock().unwrap()`) vs `:447` (`lock().ok()?`) | Incohérence : `compile_to_preview_html` panique sur mutex empoisonné, `resolve_click` non. Une panic dans `spawn_blocking` tue la compile mais pas l'app. | Preview mort jusqu'au restart (rare). | **P3** |
| **NEW-3** | `crates/app/src/commands/fs.rs:56-83` | `open_project` prend le **premier `.typ`** trouvé (ordre `read_dir` non déterministe). Sur un projet multi-`.typ`, le fichier ouvert varie. | Déjà dans TODO (multi-fichiers). | **P3** |
| **NEW-4** | `sources.js:152` | Re-construit le `data` depuis `span.querySelector("p")?.textContent?.replace(":","")` alors que `input.dataset.key` contient déjà la clé. Fragile (si clé contient `:`). | Maintainability. | **P3** |
| **NEW-5** | `project.js:140-155` (`exportPDF` Blob) vs `main.js savePdf` (disk via `pick_pdf_path`+`export_pdf`) | Deux chemins d'export PDF divergents (un télécharge, un écrit sur disque). UX incohérente. | Maintainability. | **P3** |
| **NEW-6** | `bibliography.rs:182-201` `get_all_bibs` | Ne liste que les `.bib` **à la racine** du projet (`read_dir`, pas récursif). Un `.bib` en sous-dossier est ignoré. | Limitation. | **P3** |

> Note : je n'ai **pas** retrouvé de bug subtil supplémentaire dans `file-sync.js` — le module est en fait correct (mon B15 première passe était un faux positif).

---

## 3. Recalcul des priorités (conservateur)

### P0 — critique (à corriger immédiatement)
1. **XSS systémique** (cause racine unique, sinks multiples : `history.js:245`, `sources.js:78-117`, `notepad.js:131-307`, `bibliography.js:70-204`, `modal.js:133` via `t()`, `index.html` inline handlers) — confirmé, exploitable via un `.bib`/projet/fichier partagé.
2. **Absence de CSP** sur une app qui expose `withGlobalTauri:true` — amplificateur de (1).

### P1 — important (à corriger prochainement)
3. FS scoping **per-commande** (réduit blast-radius XSS + bugs frontend).
4. `loadHtml` `Promise(async)` + worker sans `onerror` (sévère, rare) → réécrire en `async function` standard.
5. `project.js:20` `JSON.parse` sans try/catch (crash démarrage sur localStorage corrompu — donnée morte) + `project.js:106-111` optional-chaining.
6. `bibliography.js:108` `onclick`→`onClick` (bouton Cancel inactif).
7. `history.js:101,162` guillemet manquant (modal cassé).
8. `structures.js:141,290` off-by-one `cols-1`→`rows-1` (Typst malformé).
9. `tree.js:339-389` tooltip orphelin (UI).
10. Autosave non replanifié en échec + `invoke` non-awaited (`notepad.js:188,260`) + `bibliography.js:283-289` toast menteur (perte silencieuse / UX trompeuse).
11. Match sur chaînes FR d'erreur (`operations/form/instantiate`) + `sources.js:222` selector injection.

### P2 — à planifier
12. Race scheduler `preview.js` (gate `_compileRunning` en tête de `_runCompile` ; wasted work + glitch de page stale transitoire).
13. `modal.js:99-106` `closeAll()` fuit les promesses `showConfirm`/`showPrompt` sous-jacentes.
14. iframe sandbox : retirer `allow-scripts` (défense en profondeur).
15. `commands/fs.rs:135` boucle de symlink (NEW-1).
16. Doublons : `createSearchBar` ×5, deux chemins PDF, `core/fs/files.rs`/`core/main.rs`/`compile()`/`export.rs` morts.
17. Perf : `tree.js` O(n·depth) + rebuild/touche ; `compile.rs` hash 2× ; `toolbar.js` rect/mousemove.
18. Codes d'erreur structurés Rust (remplace le match de chaînes — dépendance avec 11).

### P3 — optionnel
19. `toolbar.js:154` log trim off-by-one.
20. `i18n t()` 1re occurence uniquement (latent).
21. `index.html:350` `²` parasite ; handlers inline → `addEventListener`.
22. `sources.js:152` utiliser `dataset.key`.
23. `bibliography.rs:182` `.bib` sous-dossiers.
24. CI : clippy, npm audit, build macOS.
25. `compile.rs:340` `.unwrap()` → `.ok()?` (NEW-2).
26. `open_project` non-déterminisme (NEW-3, lié au TODO multi-fichiers).

---

## 4. Vérification des solutions (cause racine)

### P0-1 : XSS systémique
- **Cause racine** : motif `${variable}` non-échappé dans `innerHTML`/attributs, **couplé à** un `t()` qui substitue sans échapper (`i18n/index.js:12`), et **aucune CSP**. Toutes les tentatives de "fix par sink" retoombent tant que `t()` injecte brut.
- **Solution recommandée** : (a) introduire `escapeHtml(s)`/`escapeAttr(s)` (exister déjà partiellement dans `tutorial-highlight.js`) ; (b) **`t()` échappe ses valeurs de substitution** pour le contexte HTML (ou fournir `tHtml` + `tAttr`) et remplace **toutes** les occurrences ; (c) wrapper chaque `${variable}` dynamique dans les templates par `escapeHtml`/`escapeAttr` ; (d) pour les builders de liste (`history`, `sources`, `notepad`, `bibliography`), préférer `createElement + textContent + setAttribute`.
- **Alternative** : DOMPurify sur tous les sinks — plus lourd, runtime cost, ne scale pas (il faut l'appeler partout). Moins bien que l'échappement ciblé.
- **Risques de la correction** : les `showConfirm` qui passent un message composé avec du HTML statique (`instantiate.js:24` `${t(...)}<br><br><code>#import "${name}/lib.typ": *</code>`) — si on échappe tout `message`, le `<br>`/`<code>` cassent. ⇒ **Il faut échapper uniquement la partie variable** `${name}` au site d'appel, pas le template entier. Régression évitée par échappement ciblé.
- **Tests à ajouter** : tests jsdom rendant `buildNoteElement`/`rebuildSourcesList`/`viewHistoryEntry` avec payloads `<img src=x onerror=alert(1)>`, `x"><script>`, `</textarea><script>` ; s'assurer qu'aucun `<script>`/handler ne survit.

### P0-2 : CSP
- **Cause racine** : `tauri.conf.json` sans `security.csp` + `withGlobalTauri:true`.
- **Solution** : ajouter `"security": { "csp": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'" }`. NB : `script-src 'self'` **interdit les handlers `onclick=` inline** (`index.html:286,292`, `structures.js:106,255,462,612`) → il faut **d'abord migrer ces handlers vers `addEventListener`**, sinon la CSP casse l'UI.
- **Risques** : Monaco/tailwind peuvent nécessiter `'unsafe-inline'` pour le style (OK dans la CSP ci-dessus). Confirmer que rien d'autre n'injecte du `<script>` inline.
- **Tests** : charger l'app avec la CSP en CI et vérifier qu'aucune erreur CSP n'apparaît dans la console webview.

### P1-4 : `loadHtml` hang
- **Cause racine** : anti-pattern `new Promise(async (resolve) => …)` — la Promise constructor n'attend pas l'executor async, donc un `await` qui rejecte/dort dans l'executor laisse la Promise externe pending à vie.
- **Solution** : réécrire `loadHtml` en `async function loadHtml(frame, html) { ... return; }` simple (pas de `new Promise`). Côté worker : `try/catch` autour de `new Blob`/`URL.createObjectURL` + `self.postMessage({ type:'blobError', id })` ; côté main thread : `createBlobUrlAsync` retourne une Promise qui `resolve(url)` ou `reject(err)` ; `getBlobWorker().onerror` handler.
- **Alternatives** : abandonner le worker entièrement et faire le Blob sur le main thread (plus simple, mais regarde le jitter typing sur gros docs — c'était la raison d'être du worker). Conserver le worker mais fiabiliser.
- **Risques** : faible. Le contrat externe (`loadHtml` retourne une Promise qui résout à l'`onload`) est inchangé.
- **Tests** : test qui force le worker à jeter (mock `getBlobWorker()` qui ne répond pas) et vérifie que `loadHtml` rejecte dans un délai fini, et que le scheduler n'est pas gelé (`_compileRunning` repasse à false).

### P1-5/6/7/8/9/10/11 : bugs one-liner — cause racine = omissions ponctuelles (pas systémiques). Solutions chirurgicales, faible risque. Tests : un test par bug si applicable (e.g., un test `createSearchBar`/modal qui vérifie que Cancel ferme le modal).

### P1-3 : FS scoping
- **Cause racine** : les commandes FS acceptent des `path: String` absolus et agissent dessus sans allow-list.
- **Solution** : introduire un helper `fn assert_within_roots(path: &Path, roots: &[&Path]) -> Result<(), String>` (canonisation via `canonicalize` + `starts_with`). Appliquer aux commandes **destructives** (`delete_file_or_dir`, `rename_file`, `replace_file`) et **read** (`read_file`, `read_image_as_base64`) en restreignant à `${project.path}` + `${app_config_dir}`. **Exempter** `export_pdf` (chemin choisi via `pick_pdf_path`), `save_file` est à limiter à project + picked-path, `reveal_in_file_manager` OK project-scoped.
- **Risques** : casser `save_file` vers un chemin picked (`rawBibliographyEntry` `bibliography.js:268` sauve un `.bib` du projet → OK ; `export_pdf` → exempter). Attention aux symlinks : `canonicalize` résout, donc un symlink légitime vers un dossier externe serait rejeté — acceptable (conservateur).
- **Tests** : tests qui tentent `delete_file_or_dir` sur `/etc/hosts` et attendent une erreur ; tests que les chemins projet sont acceptés.

---

## 5. Détection de refactorings dangereux (du premier audit)

| Recommandation initiale | Risque | Alternative progressive |
|---|---|---|
| "État `compile.rs` par session pour multi-fichiers" (Phase 4) | **Prématuré** : le multi-fichiers n'existe pas encore (TODO). Refacto architecturale pour un besoin non validé. | **Reporter** jusqu'à décision sur les onglets. L'état global statique actuel marche pour 1 projet. |
| "Bus d'événements / DI pour remplacer `wire.js`" | **Over-engineering** pour 40 modules vanille. | Garde `wire.js` (1 maps, marche) — ou simple import direct quand il n'y a pas de cycle. |
| "Helper `h()` style hyperscript pour tout le DOM" | Risque de réécriture large. | Préférer l'échappement ciblé + `createElement/textContent` **uniquement aux sinks XSS**. Un mini-helper `escapeHtml`/`escapeAttr` suffit. |
| "DOMPurify sur `marked` (tutoriel)" | Inutile tant que les markdowns sont des **assets build-time**. | Reporter tant que pas de contenu tutoriel user-controlled. |
| "Isolation d'origine de l'iframe (`srcdoc`)" | Plus de travail + risque de casser `setupClickHandler` (lit `contentDocument`). | **Retirer juste `allow-scripts`** suffit et est sans risque. |
| "Renommer le crate `core`" | Pas de bénéfice réel, churn. | Ne pas faire. |
| "Supprimer `core/fs/files.rs`" | Faible risque mais vérifier usage. | OK à faire (confirmé non utilisé), en P3. |
| "Rewrite complète du scheduler `preview.js`" | Risque élevé de régression sur un module subtil mais fonctionnel. | Corrections ciblées : gate `_compileRunning` + `loadHtml` async + worker onerror. Pas de rewrite. |

---

## 6. Nouveau plan d'action (étapes ordonnées par risque de régression croissant)

### Étape 1 — Migrer les handlers `onclick` inline vers `addEventListener`
- **Objectif :** préparer la CSP (étape 3) sans casser l'UI.
- **Fichiers concernés :** `frontend/src/index.html:286,292,350`, `frontend/src/js/structures.js:106,255,462,612`, `frontend/src/js/toolbar.js` (brancher les liens). Ajouter `id`/`data-` aux éléments si besoin.
- **Problème corrigé :** dependence aux inline handlers (futur bloquant CSP).
- **Modification à effectuer :** remplacer `onclick="..."` par `document.querySelector(...).addEventListener('click', ...)`.
- **Tests à ajouter/modifier :** testeurs visuels (clic sur les liens "Docs"/"Repo", boutons structures).
- **Risque :** faible. Bypass si un `id` manque.
- **Dépendances :** aucune. Requis par Étape 3.

### Étape 2 — Échappement ciblé des sinks XSS + `t()` safe
- **Objectif :** fermer la classe XSS (P0-1).
- **Fichiers concernés :** `frontend/src/i18n/index.js` (`t()` échappe les params, remplace toutes les occurrences), `frontend/src/js/history.js` (235-245), `frontend/src/js/bibliography/sources.js` (78-117, 204), `frontend/src/js/bibliography/bibliography.js` (70-86, 204), `frontend/src/js/notepad.js` (131-149, 234, 240, 301-307), `frontend/src/js/modal.js:133` (échapper `message` seulement si non-HTML — sinon échapper côté appelant), `frontend/src/js/manage_files/tree.js:29`. Nouveau helper `frontend/src/js/utils/escape.js` (`escapeHtml`, `escapeAttr`).
- **Problème corrigé :** P0-1 (XSS history/notepad/bibliography/sources/showConfirm).
- **Modification à effectuer :** wrapper `${var}` par `escapeHtml`/`escapeAttr` ; `t()` remplace toutes occurrences + échappe `v` ; pour `showConfirm` dont le message contient du HTML statique (`instantiate.js:24`), échapper uniquement `${name}` au site d'appel.
- **Tests à ajouter/modifier :** suite jsdom qui rend `buildNoteElement`, `rebuildSourcesList`, `viewHistoryEntry`, `buildHistoryEntry` avec payloads `<img src=x onerror=...>`, `x"><script>`, `</textarea><script>`, `"><img>` et asserte l'absence de nœud script/handler.
- **Risque :** moyen — un sur-échappement casse les messages HTML intentionnels. Mitigation : échappement ciblé, tests par sink.
- **Dépendances :** aucune (orthogonal à la CSP).

### Étape 3 — Ajouter la CSP + retirer `allow-scripts` iframe
- **Objectif :** défense en profondeur (P0-2 + P2-14).
- **Fichiers concernés :** `crates/app/tauri.conf.json` (ajouter `security.csp`), `frontend/src/index.html:399` (`sandbox="allow-same-origin"` sans `allow-scripts`), `crates/app/capabilities/default.json` (resserrer `opener` aux domaines typst repo/docs si possible).
- **Problème corrigé :** P0-2 + bloquerait un XSS résiduel par script-in-SVG.
- **Modification à effectuer :** CSP `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'`. Retirer `allow-scripts`.
- **Tests à ajouter/modifier :** build + lancement en CI, vérifier qu'aucune violation CSP n'apparaît dans la console (Tauri logs).
- **Risque :** moyen — si un inline handler a été oublié (Étape 1) ou si Monaco/tailwind injecte du script, l'UI casse. Mitigation : d'abord `report-only` (Tauri le supporte ? sinon, branch test).
- **Dépendances :** **après Étape 1** (sinon inline handlers cassés).

### Étape 4 — Quick wins bug-fix (one-liners)
- **Objectif :** corriger les bugs UX réels (P1-5 à P1-11, P3-19/21/22).
- **Fichiers concernés :** `project.js` (try/catch + optional-chaining + supprimer `projectHistory` mort), `bibliography.js:108` (`onClick`), `history.js:101,162` (guillemets), `structures.js:141,290` (`rows-1`), `tree.js:339-389` (flag `stillHovering`), `notepad.js:188,260` (await), `project.js:78-88` (replan autosave en échec), `bibliography.js:279-289` (try/catch), `toolbar.js:154` (trim après append), `index.html:350` (`²`), `sources.js:222` (id stable), `editor.js:77-150` (supprimer `handleImagePaste`), `core/main.rs`/`core/fs/files.rs`/`compile()` fn/`compiler/export.rs` (supprimer code mort).
- **Problème corrigé :** bugs ponctuels confirmés.
- **Modification à effectuer :** chacune chirurgicale.
- **Tests à ajouter/modifier :** test `createModal` Cancel ferme ; test `table`/`grid` génère le bon nombre de tabs.
- **Risque :** faible.
- **Dépendances :** aucune. Peut être fait en parallèle des étapes 1-3.

### Étape 5 — Robustesse preview (loadHtml async + worker onerror)
- **Objectif :** P1-4 (gel potentiel).
- **Fichiers concernés :** `frontend/src/js/preview.js:443-483` (réécrire `loadHtml` en `async function`), `frontend/src/js/preview-worker.js` (try/catch + `blobError`), `frontend/src/js/preview.js:148-172` (`onerror` worker + `createBlobUrlAsync` reject).
- **Problème corrigé :** gel du scheduler en cas de panne worker.
- **Tests à ajouter/modifier :** test qui mock le worker silencieux et assert que `loadHtml` reject en < N ms, et que `_compileRunning` repasse à false.
- **Risque :** faible (contrat externe inchangé).
- **Dépendances :** aucune.

### Étape 6 — Codes d'erreur structurés Rust (pré-au quick win 11)
- **Objectif :** remplacer le match de chaînes FR (P1-11).
- **Fichiers concernés :** `crates/app/src/commands/fs.rs`, `crates/app/src/commands/bibliography.rs`, etc. (retourner un enum sérialisé `ErrCode::UserCancelled { .. }` plutôt que `String`), `frontend/src/js/manage_files/operations.js`, `templates/form.js`, `templates/instantiate.js` (matcher sur le code).
- **Problème corrigé :** fragile match FR.
- **Tests à ajouter/modifier :** test Tauri mock qui annule un picker et vérifie qu'aucun toast d'erreur n'apparaît.
- **Risque :** moyen — change le contrat IPC. À faire en une passe coordonnée Rust+JS.
- **Dépendances :** aucune, mais fédère le quick win 11.

### Étape 7 — Scoping FS Rust (per-commande)
- **Objectif :** P1-3 (réduit blast-radius XSS + bugs front).
- **Fichiers concernés :** `crates/app/src/commands/fs.rs`, `crates/app/src/commands/templates.rs`, `crates/app/src/commands/export.rs` (exempter). Nouveau helper `assert_within_roots`.
- **Problème corrigé :** accès FS arbitraire.
- **Tests à ajouter/modifier :** test `delete_file_or_dir('/etc/hosts')` → Err ; test chemin projet → Ok ; test `export_pdf` vers un tmpdir arbitraire → Ok (exempt).
- **Risque :** moyen — les symlinks externes légitimes seraient rejetés (`canonicalize`) ; vérifier qu'aucun flux ne dépend d'un chemin hors-roots (sauf les pickers exemptés).
- **Dépendances :** après Étape 2 (la XSS primaire est déjà fixée ; scoping est defense-in-depth).

### Étape 8 — Refactorings maintien (P2)
- **Objectif :** duplication, perf, dead code (P2-12, 13, 15, 16, 17).
- **Fichiers concernés :** extraire `createSearchBar` partagé ; `tree.js` `Map` + debounce search ; `compile.rs` hash-once ; `modal.js` `closeAll()` résout les promesses outstanding ; `toolbar.js` rect caché ; fusionner les deux chemins PDF.
- **Risque :** moyen (toucher `preview.js` scheduler — Étape 8a pour le gate `_compileRunning`, faible risque).
- **Dépendances :** après Étape 5 (preview stabilisé).

### Étape 9 — CI/lint (P2/P3)
- **Fichiers concernés :** `.github/workflows/ci.yml` (clippy `-D warnings`, `npm audit`, job macOS optionnel), `frontend/.eslintrc` + Prettier.
- **Risque :** faible (peut révéler du bz), mais ne casse rien si en non-bloquant d'abord.
- **Dépendances :** aucune.

### Étape 10 — Robustesse Rust (P3 + NEW)
- `commands/fs.rs:135` détection de boucle symlink (NEW-1) — `std::fs::symlink_metadata` + ignorer les symlinks dir ou limiter la profondeur.
- `compile.rs:340` `.unwrap()`→`.ok()?` (NEW-2) — aligner sur `resolve_click`.
- `bibliography.rs:182` `.bib` récursif (NEW-6) — optionnel.
- `open_project` choisir `main.typ` en priorité (NEW-3) — optionnel.

---

## 7. Quick wins (peu de temps, peu de risque, vrai bénéfice)

- **`bibliography.js:108`** `onclick`→`onClick` (1 caractère) — bouton Cancel restauré.
- **`history.js:101,162`** fermer l'attribut `class="history-entry-form>` — modal lisible.
- **`structures.js:141,290`** `cols-1`→`rows-1` — Typst correct.
- **`tree.js` tooltip** flag `stillHovering` après l'`await` — fini le tooltip fantôme.
- **`project.js:20`** try/catch (ou supprimer la variable morte) — fini le crash démarrage.
- **`project.js:106` + `structures.js:666`** optional-chaining — fini le TypeError.
- **`notepad.js:188,260`** await les `invoke` — fini le succès silencieux.
- **`bibliography.js:283-289`** try/catch + toast correct — fini le toast menteur.
- **`toolbar.js:154`** trim après append — invariant 200.
- **`index.html:350`** retirer le `²` — attribut propre.
- **Retirer `allow-scripts` du sandbox iframe** (`index.html:399`) — 1 attribut, défense en profondeur gratuite.
- **Supprimer le code mort confirmé** (`editor.js#handleImagePaste`, `core/main.rs`, `core/fs/files.rs`, `compile.rs#compile`, `compiler/export.rs`) — moins de surface.
- **Clippy + npm audit en CI** (non-bloquant d'abord) — filet rouge gratuit.

---

## 8. À ne pas faire

- **Ne pas réécrire le scheduler `preview.js`** — il est subtil mais fonctionne ; les correctifs ciblés (Étape 5 + Étape 8a) suffisent. Un rewrite introduirait des régressions (le commentaire `:349-352` sur WebKitGTK IME montre que l'auteur a déjà debuggé des cas subtils).
- **Ne pas introduire un bus d'événements / DI / framework DOM** pour remplacer `wire.js` et `window.__typstEditor` — over-engineering pour 40 modules vanille. Un import direct suffit quand il n'y a pas de cycle.
- **Ne pas refactorer l'état global `compile.rs` en "par session"** avant d'avoir décidé du multi-fichiers. La static actuelle marche pour 1 projet.
- **Ne pas ajouter DOMPurify sur `marked`** tant que les tutoriels sont des assets build-time.
- **Ne pas viser l'isolation d'origine de l'iframe (`srcdoc`)** — retirer `allow-scripts` suffit.
- **Ne pas renommer le crate `core`** — churn sans bénéfice.
- **Ne pas blanket-escaper tous les `innerHTML`** (casserait les messages HTML intentionnels comme `instantiate.js:24`). Échapper **uniquement les variables dynamiques** aux sites d'interpolation.
- **Ne pas monter `typst` 0.15→0.16** dans le même PR qu'un correctif XSS — séparer les préoccupations (la MAJ Typst + maintien du fork `typst-as-library` est un chantier à part, avec son propre risque de régression sur `compile.rs`/`download_package`).
- **Ne pas traiter P3 (cosmetic) avant P0/P1** — l'XSS et les bugs UX concrets d'abord.
- **Ne pas "en profiter pour refactorer"** pendant les quick wins : chaque fix one-liner doit rester isolé et committable séparément, pour bissection facile.

---

## 9. Rapport final

### P0 — À corriger immédiatement
- **XSS systémique** (history `:245`, sources `:78-117`, notepad `:131-307`, bibliography `:70-204`, showConfirm via `t()`) — confirmé, exploitable via `.bib`/projet/fichier partagé. Cause racine : interpolation non-échappée + `t()` non-safe + pas de CSP.
- **CSP absente** + `withGlobalTauri:true` — amplificateur.

### P1 — À corriger prochainement
- FS scoping **per-commande** (exempter pickers save/export).
- `loadHtml` Promise(async) + worker sans onerror (sévère, rare).
- `project.js:20/106` crash + optional-chaining.
- `bibliography.js:108` Cancel, `history.js:101/162` guillemet, `structures.js:141/290` off-by-one.
- `tree.js` tooltip orphelin.
- Autosave non replanifié + `invoke` non-awaited + toast menteur `bibliography.js`.
- Match sur chaînes FR + `sources.js:222` selector.

### P2 — À planifier
- Race scheduler `preview.js` (gate `_compileRunning`).
- `modal.js closeAll()` fuite de promesses.
- Sandbox iframe : retirer `allow-scripts`.
- `commands/fs.rs` boucle de symlink (NEW-1).
- Doublons (`createSearchBar`, chemins PDF) + code mort.
- Perf (`tree.js`, `compile.rs` hash 2×, `toolbar.js`).
- Codes d'erreur structurés Rust.

### P3 — Optionnel
- `toolbar.js:154` log trim ; `t()` 1re occurence ; `²` parasite ; `sources.js:152` `dataset.key` ; `.bib` sous-dossiers ; clippy/npm audit/macOS CI ; `compile.rs:340` `.unwrap()`→`.ok()?` ; `open_project` non-déterminisme.

### Nouveaux problèmes découverts
- **NEW-1** boucle de symlink dans `collect_entries` (P2).
- **NEW-2** `compile.rs:340` `.unwrap()` vs `.ok()?` inconsistant (P3).
- **NEW-3** `open_project` non-déterministe multi-`.typ` (P3, déjà TODO).
- **NEW-4** `sources.js:152` rebuild fragile depuis `<p>` textContent (P3).
- **NEW-5** deux chemins PDF divergents (P3).
- **NEW-6** `.bib` sous-dossiers ignorés (P3).

### Faux positifs / recommandations retirées
- **`file-sync.js:79` `_lastSavedHash ??= editorHash`** — pas un bug ; le 1er poll compare correctement.
- **"preview stoppe / stale écrase newer"** (conséquence B1) — le `Semaphore(1)` Rust sérialise ; seul un glitch transitoire d'interleaving subsiste (P2).
- **Impact "gonfler le `.typ`" de `handleImagePaste`** — code mort, impact hypothétique retiré.
- **"tar traversal"** — `tar 0.4` bloquerait ; à surveiller seulement.

### Quick wins
Voir §7 (≈13 correctifs one-liner/low-risk + `allow-scripts` + clippy/audit CI + suppression code mort).

### Refactorings importants
- **Échappement systémique + `t()` safe** (Étape 2) — corrige P0.
- **CSP + sandbox** (Étape 3) — défense en profondeur.
- **Scoping FS per-commande** (Étape 7) — blast-radius.
- **Codes d'erreur structurés Rust+JS** (Étape 6) — robustesse durable.
- **`loadHtml` async + worker fiabilisé** (Étape 5) — robustesse preview.

### À ne pas faire
Voir §8 (pas de rewrite scheduler, pas de framework/bus d'événements, pas de refactor `compile.rs` par session prématuré, pas de DOMPurify `marked` inutile, pas de renommage de crate, pas de blanket-escaping, pas de montée Typst en même temps qu'un fix XSS, pas de P3 avant P0/P1).

### Ordre d'implémentation recommandé
1. **Étape 1** — migrer les inline `onclick` (prérequis CSP).
2. **Étape 2** — échappement XSS + `t()` safe (+ tests jsdom).
3. **Étape 3** — CSP + retrait `allow-scripts` iframe.
4. **Étape 4** — quick wins bug-fix (peut courir en parallèle de 1-3).
5. **Étape 5** — `loadHtml` async + worker onerror.
6. **Étape 6** — codes d'erreur structurés Rust+JS (coordonnés).
7. **Étape 7** — scoping FS per-commande.
8. **Étape 8** — refactorings maintien (dédup, perf, `closeAll`, gate scheduler).
9. **Étape 9** — CI clippy/audit/macOS.
10. **Étape 10** — robustesse Rust (symlink, `.unwrap()`, `.bib` récursif — optionnel).

> Cet ordre minimise les régressions : (1) prépare (3), (2) est orthogonal et corrige le P0 principal, (3) intervient une fois les inline handlers retirés, (4) est isolé, (5-7) sont des correctifs indépendants, (8) touche le scheduler **après** qu'il est fiabilisé (5). La montée de Typst et le multi-fichiers (TODO) restent **hors périmètre** de ce plan.