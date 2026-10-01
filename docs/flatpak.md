# Publication sur Flathub : plan et justification des permissions

> **Statut : plan à implémenter.** Ce document décrit la marche à suivre pour publier Typst IDE sur Flathub, les fichiers à créer, et surtout **pourquoi** chaque permission de bac à sable est nécessaire (éléments à fournir aux reviewers Flathub).

## 1. Contexte

Typst IDE distribue déjà des paquets natifs (AppImage, `.deb`, `.rpm`, PKGBUILD) et Windows. Flatpak/Flathub est la méthode la plus simple pour toucher les utilisateurs Linux de toutes distributions, y compris ceux qui n'installent pas d'AppImage.

Références utiles :
- Documentation Tauri officielle (mise à jour septembre 2026) : https://v2.tauri.app/distribute/flatpak
- Exigences Flathub : https://docs.flathub.org/docs/for-app-authors/requirements
- Soumission : https://docs.flathub.org/docs/for-app-authors/submission
- Exemple réel d'app Tauri publiée (référence de manifest, runtime 50) : https://github.com/flathub/io.github.CyberTimon.RapidRAW

Ce qui est déjà en place dans le dépôt et réutilisable :
| Élément | État |
|---|---|
| App ID reverse-DNS | `com.typst.ide` (identifiant Tauri) |
| Licence | GPL-3.0 (`LICENSE` à la racine) |
| `Cargo.lock` commité, aucune dépendance git | vendoring cargo simple |
| Fork `crates/typst-as-library` inclus dans le dépôt | source git autoportante |
| AppStream | `scripts/appimage/com.typst.ide.appdata.xml` (à décliner en statique) |
| Desktop + icônes | `typst-ide.desktop`, `crates/app/icons/*` |
| Tags Git | `v1.6.13` (`3d5a80bb42024d97ab85dba980a6218476091d48`) |

## 2. Phase 0 : Prérequis et vérifications bloquantes

```bash
# Outils locaux
sudo dnf install flatpak-builder

# Runtime + SDK + extensions (branche à confirmer en Phase 0)
flatpak install flathub org.gnome.Platform//50 org.gnome.Sdk//50 org.freedesktop.Sdk.Extension.rust-stable org.freedesktop.Sdk.Extension.node24

# Vérifier que le runtime fournit bien WebKitGTK 4.1 (requis par Tauri v2)
flatpak run --command=sh org.gnome.Platform//50 -c 'ls /usr/lib/x86_64-linux-gnu | grep -E "webkit2gtk|javascriptcoregtk"'
# Attendu : libwebkit2gtk-4.1.so.0 (RapidRAW, app Tauri, tourne sur ce runtime)
```

Si le runtime courant ne fournit plus `webkit2gtk-4.1`, choisir le plus récent qui le fournit (le linter Flathub refuse les runtimes trop anciens) ou, en dernier recours, compiler WebKitGTK en module (chantier lourd à éviter).

## 3. Arborescence prévue

```
flatpak/
├── com.typst.ide.yml            # manifest flatpak-builder
├── com.typst.ide.metainfo.xml   # AppStream statique (validée appstreamcli)
├── com.typst.ide.desktop        # desktop file au nom de l'app ID
├── flathub.json                 # options Flathub (skip-arches si besoin)
├── cargo-sources.json           # généré (flatpak-cargo-generator)
└── node-sources.json            # généré (flatpak-node-generator)
flatpak-builder-tools/           # sous-module git (génération des sources)
docs/flatpak.md                  # ce document
```

`manage.sh` gagnera : 
- `flatpak-sources` 
- `flatpak-build`
-  `flatpak-run`
-  `flatpak-bump <tag>`
-  et `bump` mettra à jour l'entrée `<release>` du metainfo

## 4. Manifest (brouillon)
```yaml
id: com.typst.ide
runtime: org.gnome.Platform
runtime-version: '50'
sdk: org.gnome.Sdk
sdk-extensions:
  - org.freedesktop.Sdk.Extension.rust-stable
  - org.freedesktop.Sdk.Extension.node24
command: typst-ide

finish-args:
  - --socket=wayland          # afficher la fenêtre (GTK3/WebKitGTK)
  - --socket=fallback-x11     # sessions X11 / secours
  - --share=ipc               # mémoire partagée X11/GTK (MIT-SHM)
  - --device=dri              # rendu accéléré WebKitGTK (EGL/GBM)
  - --share=network           # téléchargement des packages Typst (packages.typst.org)
  - --filesystem=home         # projets, arborescence de fichiers, historique

build-options:
  append-path: /usr/lib/sdk/node24/bin:/usr/lib/sdk/rust-stable/bin

modules:
  - name: typst-ide
    buildsystem: simple
    build-options:
      env:
        CARGO_HOME: /run/build/typst-ide/cargo
        npm_config_cache: /run/build/typst-ide/flatpak-node/npm-cache
        npm_config_offline: 'true'
        CARGO_NET_OFFLINE: 'true'
    sources:
      - type: git
        url: https://github.com/gnoooo/typst-ide.git
        tag: v1.6.13
        commit: 3d5a80bb42024d97ab85dba980a6218476091d48
        x-checker-data:
          type: git
          tag-pattern: ^v([\d.]+)$
      - node-sources.json
      - cargo-sources.json
    build-commands:
      - npm ci --offline
      - npm run build
      - cargo build --release --offline -p typst-ide-app
      - install -Dm755 target/release/typst-ide /app/bin/typst-ide
      - install -Dm644 flatpak/com.typst.ide.desktop /app/share/applications/com.typst.ide.desktop
      - install -Dm644 flatpak/com.typst.ide.metainfo.xml /app/share/metainfo/com.typst.ide.metainfo.xml
      - install -Dm644 crates/app/icons/32x32.png /app/share/icons/hicolor/32x32/apps/com.typst.ide.png
      - install -Dm644 crates/app/icons/128x128.png /app/share/icons/hicolor/128x128/apps/com.typst.ide.png
      - install -Dm644 crates/app/icons/128x128@2x.png /app/share/icons/hicolor/256x256/apps/com.typst.ide.png
      - install -Dm644 LICENSE /app/share/licenses/com.typst.ide/LICENSE
```

Notes :

- Pas besoin du CLI Tauri dans le sandbox : `npm run build` puis `cargo build -p typst-ide-app` (le frontend est embarqué à la compilation via `frontendDist`).
- `node24` (et non `node20`) : Node 20 est en fin de maintenance depuis avril 2026, Vite 8 exige `^20.19 || >=22.12`, donc 24 convient.
- `x-checker-data` permet au bot Flathub d'ouvrir une PR de bump à chaque nouveau tag.

## 5. Sources hors-ligne

Les builds Flathub sont **sans réseau**. Il faut donc fournir les dépendances :

```bash
# Sous-module (une fois)
git submodule add https://github.com/flatpak/flatpak-builder-tools.git

# Sources cargo (depuis Cargo.lock)
python3 flatpak-builder-tools/cargo/flatpak-cargo-generator.py -o flatpak/cargo-sources.json Cargo.lock

# Sources npm (depuis frontend/package-lock.json)
flatpak-node-generator --no-requests-cache -o flatpak/node-sources.json npm frontend/package-lock.json
```

`manage.sh flatpak-sources` encapsulera ces deux commandes (via un venv/pipx ou un conteneur `python:3.12-slim`, pour ne rien installer sur l'hôte).
À régénérer quand `Cargo.lock` ou `frontend/package-lock.json` changent.

## 6. Justification des permissions

### 6.1 Résumé

| Permission | Pourquoi | Preuves dans le code |
|---|---|---|
| `--socket=wayland` + `--socket=fallback-x11` | Afficher la fenêtre GTK3/WebKitGTK. `fallback-x11` couvre les sessions X11. | Tauri/GTK (application graphique) |
| `--share=ipc` | Mémoire partagée GTK/X11 (MIT-SHM), requise avec le socket X11. | Standard GTK |
| `--device=dri` | Rendu accéléré WebKitGTK (EGL/GBM), sans lui, rendu logiciel lent ou cassé. | WebKitGTK (Tauri) |
| `--share=network` | Résolution des packages Typst (`#import "@preview/..."`) : téléchargement de `packages.typst.org`. Sans réseau, toute compilation utilisant un package non présent échoue. De plus, l'accès à ces librairies est très utile pour les utilisateurs. | `crates/typst-as-library/src/lib.rs:218` (`download_package`), URL `packages.typst.org` ligne `:228` |
| `--filesystem=home` | Éditeur local : le projet est créé/ouvert n'importe où dans le dossier personnel, mémorisé par chemin absolu et **rouvert sans sélecteur**, imports/exports et "révéler" depuis des emplacements choisis par l'utilisateur. L'app restreint elle-même ses opérations fichier au projet. | `crates/app/src/commands/fs.rs:69` (`allowed_roots`), `:21` (`assert_within`), `:128` (`create_project`), `:168` (`open_project`) et `frontend/src/js/history.js:287` (réouverture par chemin) |

### 6.2 Détail

**`--share=network` : packages Typst.**

Le compilateur Typst est embarqué, mais la résolution des packages `@preview` (et des packages locaux publiés sur le registre) passe par le réseau : `download_package()` télécharge `https://packages.typst.org/{namespace}/{name}-{version}.tar.gz` dans le cache applicatif, puis décompresse localement. 

Sous Flatpak sans `--share=network`, `ureq` ne peut pas sortir du bac à sable et la compilation d'un document qui importe un package échoue. C'est le **seul** usage réseau de l'application : aucune télémétrie, aucun updater, aucun compte. (L'ouverture de liens externes passe par le portail OpenURI, pas par cette permission.)

**`--filesystem=home` : projets et arborescence.**
Typst IDE n'est pas juste une visionneuse : c'est un éditeur *local-first* avec un gestionnaire de projets intégré. 

Concrètement :
1. **Création/ouverture de projet** : 
   l'utilisateur choisit un dossier parent (`open_folder_dialog`) puis l'app crée le projet dedans (`create_project(base_path, ...)`, `fs.rs:128`) ou ouvre un dossier existant (`open_project`, `fs.rs:168`). 
   Un projet peut vivre n'importe où dans le dossier personnel (dépôt git, dossier partagé, projet existant).

2. **Réouverture sans sélecteur** : 
   l'historique stocke des chemins absolus et rouvre le projet directement (`history.js:287`, `open_project`). 
   Avec un portail seul, il faudrait repasser par une boîte de dialogue à chaque fois et gérer l'indirection des chemins du document portal, ce qui casserait le flux "projets récents".

3. **Imports/exports et gestion** : 
   import de fichiers depuis n'importe où (`import_file_dialog`, `fs.rs:503`, `import_folder_dialog`, `fs.rs:615`), export PDF vers un chemin choisi, « révéler dans le gestionnaire de fichiers », bibliographies `.bib` et images référencées par le projet.

Bonne nouvelle pour la revue : **l'application restreint elle-même toutes ses opérations fichier** au projet courant (plus ses dossiers de données/config) via `allowed_roots()` (`fs.rs:69`) et `assert_within()` (`fs.rs:21`). Tandis que l'arborescence de fichiers, la sauvegarde, les renommages/suppressions ne sortent jamais du projet. 
La permission `home` sert donc uniquement à pouvoir **choisir** où créer/ouvrir le projet et à le rouvrir depuis l'historique, ce n'est pas un accès large non maîtrisé.

Ce qui reste **hors** de cette permission : les bases SQLite (notes, historique), les templates et les caches restent dans le dossier applicatif bac à sable `~/.var/app/com.typst.ide/`. Aucun accès système/host n'est demandé.

Alternatives écartées :
- `--filesystem=host` (trop large, inclut les systèmes de fichiers montés)
- `xdg-documents`, `xdg-download`... : trop restrictif, les projets peuvent être n'importe où (dépôts git, partages, `/mnt`, etc.), là est l'utilité aussi (utiliser l'intégralité du filesystem pour permettre à l'utilisateur un plein contrôle)
- portails seuls : la réouverture des projets récents stockés en chemin absolu ne serait pas garantie (indirection `/run/user/.../doc/...`, permissions à re-négocier) et il faudrait repenser l'historique et les imports (plus de
  travail pour un résultat moins fiable)

**`--device=dri`.** 

WebKitGTK utilise EGL/GBM pour le rendu accéléré. Sans accès DRM, le rendu tombe en logiciel (lent, parfois fenêtre blanche), c'est la norme pour toutes les apps graphiques Flatpak.

### 6.3 Résumé des arguments en anglais

```
Permission justifications:

- --socket=wayland, --socket=fallback-x11, --share=ipc, --device=dri
  Standard requirements for a GTK3/WebKitGTK desktop application: display the
  window, shared-memory rendering (MIT-SHM) and hardware-accelerated WebKit
  rendering via EGL/GBM.

- --share=network
  Typst IDE embeds the Typst compiler, but documents that import packages
  (e.g. #import "@preview/...") are resolved by downloading them from
  https://packages.typst.org. The download is implemented in the vendored
  typst-as-library fork (crates/typst-as-library/src/lib.rs, download_package)
  with ureq. Without network access, any document using a Typst package fails
  to compile. This is the only network usage: no telemetry, no updater, no
  account, no remote content otherwise.

- --filesystem=home
  The application is a local-first editor with a built-in project workflow.
  It must be able to:
    - create/open a project in any directory the user chooses (projects may
      live anywhere in $HOME: git repositories, shared folders, ...)
    - reopen recent projects directly from its stored history, by absolute
      path, without showing a file chooser again (frontend/src/js/history.js)
    - import files (images, bibliographies, sub-documents) and export PDF to
      user-chosen locations
      
  Flatpak's document portal only grants access to paths explicitly picked in a
  dialog, and does not fit persisted absolute paths / a "recent projects"
  workflow without major rework. Note that the app itself is already
  restricted: every file operation (tree listing, save, rename, delete) is
  confined to the current project root + the sandboxed app data/config dirs,
  enforced by allowed_roots()/assert_within() (crates/app/src/commands/fs.rs).
  Application data (SQLite notes/history, templates, caches) stays inside the
  sandboxed app directory (~/.var/app/com.typst.ide/). No host/system access is
  requested.
```

## 7. Adaptations prévues côté code (sandbox)

À valider pendant les tests locaux :
1. **Révéler dans le gestionnaire de fichiers** : 
   `reveal_in_file_manager` (`crates/app/src/commands/fs.rs:697`) lance `xdg-open`, absent du bac à sable. 
    Correctif : si `/.flatpak-info` existe, lancer `gio open <dossier>` (passe par le portail OpenURI), sinon garder `xdg-open`.
2. **Fonts** : 
   `fontdb` scanne les répertoires système (`crates/app/src/commands/misc.rs:15`), mais les fonts de l'hôte sont
   montées sous `/run/host/fonts`. 
   Correctif : charger aussi `/run/host/fonts` (et `/run/host/fonts-cache`) quand le dossier existe.

## 8. CI de vérification

Nouveau workflow `.github/workflows/flatpak.yml`, déclenché sur PR et tags, avec l'action officielle :

```yaml
- uses: flathub-infra/flatpak-github-actions/flatpak-builder@master
  with:
    manifest-path: flatpak/com.typst.ide.yml
    cache-key: flatpak-builder-${{ github.sha }}
```

- Build de vérification (le build Flathub officiel reste fait par leur buildbot), artifact `.flatpak` ou option : joindre ce bundle aux releases GitHub.
- Flathub construit x86_64 **et** aarch64 : si aarch64 pose problème (deps natives npm optionnelles, cf. risques), restreindre via `flatpak/flathub.json` → `"skip-arches": ["aarch64"]`.

## 9. Soumission et maintenance

Soumission (une fois) :
1. Fork de `flathub/flathub`, branche `new-pr`.
2. Ajouter `com.typst.ide.yml`, `cargo-sources.json`, `node-sources.json` (le metainfo, le desktop et les icônes viennent du git source).
3. PR contre `new-pr` avec le bloc de justification (paragraphe 6.3).
4. Itérer avec les reviewers, puis accès en écriture au dépôt `flathub/com.typst.ide`.

À chaque release :
1. `./manage.sh bump <version>` (met à jour la release du metainfo Flatpak).
2. `./manage.sh flatpak-bump vX.Y.Z` (tag + commit dans le manifest local).
3. `./manage.sh flatpak-sources` si `Cargo.lock`/`node` ont changé.
4. `./manage.sh flatpak-build` (vérification locale), puis PR sur `flathub/com.typst.ide`, ou laisser `x-checker-data` ouvrir automatiquement la PR de bump du tag.

## 10. Risques et replis

| Risque | Niveau | Repli |
|---|---|---|
| Review refuse `--filesystem=home` | Moyen | Justifier (bloc paragraphe 6.3), sinon `xdg-documents`/`xdg-download` + portails, avec adaptations de l'arborescence |
| Deps npm natives optionnelles (esbuild/rollup) hors-ligne sur aarch64 | Moyen | `flatpak-node-generator` embarque toutes les plateformes ; tester localement les deux arches, sinon `skip-arches` |
| Runtime sans `webkit2gtk-4.1` | Faible | Vérifié en Phase 0 : choisir le dernier runtime qui le fournit |
| `reveal`/fonts cassés dans le sandbox | Faible/Moyen | Correctifs prévus paragraphe 7 |
| Build Flatpak long en CI | Faible | Action officielle + cache |
