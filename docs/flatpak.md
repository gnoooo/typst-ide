# Publication sur Flathub : plan et justification des permissions

> **Statut : packaging implémenté et vérifié, soumission à ouvrir.** Build + install Flatpak, smoke test et les deux `flatpak-builder-lint` (manifest et repo) passent sur GNOME 51. Les étapes restantes sont la PR de soumission Flathub (§9) et la maintenance post-merge. Les commandes de packaging sont intégrées à `manage.sh` (§3).

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
| App ID Flathub à utiliser | `io.github.gnoooo.typst-ide` (le projet est hébergé sur GitHub) |
| Licence | GPL-3.0 (`LICENSE` à la racine) |
| `Cargo.lock` commité, aucune dépendance git | vendoring cargo simple |
| Fork `crates/typst-as-library` inclus dans le dépôt | source git autoportante |
| AppStream | `scripts/appimage/io.github.gnoooo.typst-ide.metainfo.xml` à créer à partir de l'existant |
| Desktop + icônes | `typst-ide.desktop`, `crates/app/icons/*` |
| Tags Git | `v1.6.13` (`3d5a80bb42024d97ab85dba980a6218476091d48`) |

## 2. Phase 0 : corrections bloquantes

Avant de générer le manifeste, les identifiants doivent être alignés sur `io.github.gnoooo.typst-ide`. Flathub impose le préfixe `io.github.` pour les applications hébergées sur GitHub. Il faut modifier l'identifiant Tauri, le metainfo, le desktop file, le nom des icônes et le manifeste. Cette décision doit être prise avant la première soumission : un changement d'identifiant après publication nécessite une nouvelle soumission.

Le metainfo actuel n'est pas encore valide : il contient le placeholder `@DATE@` et aucun élément `<developer>`. Il faut également utiliser une URL de screenshot immuable (tag ou commit, pas `main`) et fournir une release réelle. Le desktop file copié dans Flatpak doit avoir `Icon=io.github.gnoooo.typst-ide`, et l'icône installée doit porter ce même nom.

Le code d'accès aux projets est maintenant validé : `create_project()` et `open_project()` n'acceptent que des dossiers choisis via un dialogue (registre `GRANTED_PATHS` de `commands/fs.rs`), les montages document-portal sous le sandbox, ou `$HOME` hors sandbox. Les sources de templates passent par le même contrôle.

Les outils Flatpak ne sont pas encore présents sur tous les environnements de développement : le build et les linters ci-dessous sont obligatoires avant soumission.

```bash
# Outils locaux
sudo dnf install flatpak flatpak-builder

# Runtime + SDK + extensions (branche alignée sur le runtime : GNOME 51 → extensions 26.08)
flatpak install flathub org.gnome.Platform//51 org.gnome.Sdk//51 org.freedesktop.Sdk.Extension.rust-stable//26.08 org.freedesktop.Sdk.Extension.node24//26.08

# Vérifier que le runtime fournit bien WebKitGTK 4.1 (requis par Tauri v2)
flatpak run --command=sh org.gnome.Platform//51 -c 'ls /usr/lib/x86_64-linux-gnu | grep -E "webkit2gtk|javascriptcoregtk"'
# Attendu : libwebkit2gtk-4.1.so.0 (vérifié sur GNOME 51)
```

Si le runtime courant ne fournit plus `webkit2gtk-4.1`, choisir le plus récent qui le fournit (le linter Flathub refuse les runtimes trop anciens) ou, en dernier recours, compiler WebKitGTK en module (chantier lourd à éviter).

## 3. Arborescence prévue

```
flatpak/
├── io.github.gnoooo.typst-ide.yml       # manifest flatpak-builder
├── io.github.gnoooo.typst-ide.metainfo.xml # AppStream statique validée
├── io.github.gnoooo.typst-ide.desktop    # desktop file au nom de l'app ID
├── flathub.json                 # options Flathub (skip-arches si besoin)
├── cargo-sources.json           # généré (flatpak-cargo-generator)
└── node-sources.json            # généré (flatpak-node-generator)
flatpak-builder-tools/           # sous-module git (génération des sources)
docs/flatpak.md                  # ce document
```

Le manifeste présenté dans la PR Flathub doit être au niveau supérieur du dépôt Flathub, conformément aux exigences actuelles. Le projet amont peut conserver ses fichiers de packaging dans `flatpak/`, mais la PR Flathub doit placer le manifeste et `flathub.json` à la racine du dépôt de soumission.

`manage.sh` gère le packaging :

- `flatpak-sources` : régénère `flatpak/cargo-sources.json` et `flatpak/node-sources.json` (venv + clone shallow de `flatpak-builder-tools` dans `.flatpak-builder/tools/`, générateur npm installé dans `.flatpak-builder/tools/nodegen/` ; l'arbre npm est copié sans `node_modules`, bug flatpak-builder-tools#377)
- `flatpak-build` : installe `org.flatpak.Builder` + runtime/SDK/extensions si absents (branches en tête de `manage.sh`), build + install, puis les deux lints (`manifest` et `repo`)
- `flatpak-run` : lance l'app sandboxée
- `flatpak-bump <tag>` : épingle `tag`/`commit` dans le manifeste, après la sortie du tag
- `bump` met à jour l'entrée `<release>` du metainfo (version + date du jour) et le hook `pre-push` vérifie sa cohérence

## 4. Manifest (brouillon)
```yaml
id: io.github.gnoooo.typst-ide
runtime: org.gnome.Platform
runtime-version: '51'
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
  # Aucune permission --filesystem : tout l'accès aux fichiers passe par les
  # portails XDG (FileChooser/Documents pour les dialogues et montages,
  # OpenURI pour « révéler dans le gestionnaire de fichiers »).

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
      - install -Dm644 flatpak/io.github.gnoooo.typst-ide.desktop /app/share/applications/io.github.gnoooo.typst-ide.desktop
      - install -Dm644 flatpak/io.github.gnoooo.typst-ide.metainfo.xml /app/share/metainfo/io.github.gnoooo.typst-ide.metainfo.xml
      - install -Dm644 crates/app/icons/32x32.png /app/share/icons/hicolor/32x32/apps/io.github.gnoooo.typst-ide.png
      - install -Dm644 crates/app/icons/128x128.png /app/share/icons/hicolor/128x128/apps/io.github.gnoooo.typst-ide.png
      - install -Dm644 crates/app/icons/128x128@2x.png /app/share/icons/hicolor/256x256/apps/io.github.gnoooo.typst-ide.png
      - install -Dm644 LICENSE /app/share/licenses/io.github.gnoooo.typst-ide/LICENSE
```

Notes :

- Pas besoin du CLI Tauri dans le sandbox : `npm run build` puis `cargo build -p typst-ide-app` (le frontend est embarqué à la compilation via `frontendDist`).
- `node24` (et non `node20`) : Node 20 est en fin de maintenance depuis avril 2026, Vite 8 exige `^20.19 || >=22.12`, donc 24 convient.
- `x-checker-data` permet au bot Flathub d'ouvrir une PR de bump à chaque nouveau tag.
- Les fichiers `node-sources.json`/`cargo-sources.json` doivent être référencés par des **chaînes nues** dans `sources:` (fichier manifeste de sources à inclure), pas par `type: file` (qui se contente de copier le JSON).
- Le build local est vérifié : `npm ci --offline`, `vite build`, `cargo build --release --offline`, `appstreamcli compose`, export `.desktop`/icônes/metainfo ; tout passe sur GNOME 51.

## 5. Sources hors-ligne

Les builds Flathub sont **sans réseau**. Il faut donc fournir les dépendances :

```bash
# Tout en une commande (venv + générateurs installés dans .flatpak-builder/tools/)
./manage.sh flatpak-sources
```

`flatpak-sources` encapsule les deux commandes (venv Python local, générateur npm local).
À relancer quand `Cargo.lock` ou `frontend/package-lock.json` changent.

## 6. Justification des permissions

### 6.1 Résumé

| Permission | Pourquoi | Preuves dans le code |
|---|---|---|
| `--socket=wayland` + `--socket=fallback-x11` | Afficher la fenêtre GTK3/WebKitGTK. `fallback-x11` couvre les sessions X11. | Tauri/GTK (application graphique) |
| `--share=ipc` | Mémoire partagée GTK/X11 (MIT-SHM), requise avec le socket X11. | Standard GTK |
| `--device=dri` | Rendu accéléré WebKitGTK (EGL/GBM), sans lui, rendu logiciel lent ou cassé. | WebKitGTK (Tauri) |
| `--share=network` | Résolution des packages Typst (`#import "@preview/..."`) : téléchargement de `packages.typst.org`. Sans réseau, toute compilation utilisant un package non présent échoue. De plus, l'accès à ces librairies est très utile pour les utilisateurs. | `crates/typst-as-library/src/lib.rs:218` (`download_package`), URL `packages.typst.org` ligne `:228` |
| (aucune permission fichiers) | L'accès au système de fichiers passe par les portails XDG : `FileChooser` pour les dialogues, `Documents` pour les montages accordés, `OpenURI` pour « révéler ». Aucune permission statique n'est nécessaire. | `crates/app/src/portal.rs`, `crates/app/src/commands/fs.rs` (`open_folder_dialog`, `pick_files`, `reveal_in_file_manager`, registre de chemins accordés) |

### 6.2 Détail

#### Aucune permission fichiers statique : tout passe par les portails

Les dialogues natifs de l'application utilisent `rfd`, dont le backend Linux est le portail XDG Desktop Portal (comportement par défaut de rfd 0.17). Sous Flatpak :

1. **Choisir un dossier/fichier** (`open_folder_dialog`, `pick_files`, dialogues d'import/export) appelle `org.freedesktop.portal.FileChooser`. Le portail renvoie des montages « document portal » (`/run/user/<uid>/doc/...`) : l'utilisateur accorde précisément ces chemins au moment du choix, et uniquement eux.
2. **Créer/ouvrir un projet** : `create_project` et `open_project` reçoivent ces chemins accordés. Le backend ne les accepte que s'ils ont été choisis via un dialogue (registre `GRANTED_PATHS` dans `commands/fs.rs`) ou, hors sandbox, s'ils sont dans `$HOME` (pour l'historique après redémarrage).
3. **Réouverture depuis l'historique** : l'historique stocke le chemin retourné par le portail. Si l'autorisation a été révoquée ou le dossier déplacé, l'ouverture échoue et l'interface propose de re-sélectionner le dossier (et met l'entrée à jour).
4. **Révéler dans le gestionnaire de fichiers** : passe par `org.freedesktop.portal.OpenURI` (`crates/app/src/portal.rs`) ; le montage document-portal est visible de l'hôte, donc le gestionnaire de fichiers ouvre le vrai emplacement.
5. **Fonts** : les fonts de l'hôte sont chargées depuis `/run/host/fonts` (montage standard en lecture seule, aucune permission requise).

En plus du sandbox, l'application restreint déjà toutes ses opérations au projet courant (plus ses dossiers de données/config) via `allowed_roots()`/`assert_within()` (`fs.rs`), et les copies d'assets de templates n'acceptent que les chemins choisis via un dialogue.

**`--share=network` : packages Typst.**

Le compilateur Typst est embarqué, mais la résolution des packages `@preview` (et des packages locaux publiés sur le registre) passe par le réseau : `download_package()` télécharge `https://packages.typst.org/{namespace}/{name}-{version}.tar.gz` dans le cache applicatif, puis décompresse localement.

Sous Flatpak sans `--share=network`, `ureq` ne peut pas sortir du bac à sable et la compilation d'un document qui importe un package échoue. C'est le **seul** usage réseau de l'application : aucune télémétrie, aucun updater, aucun compte. (L'ouverture de liens externes passe par le portail OpenURI, pas par cette permission.)

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

- No static filesystem permissions: file access goes through the XDG portals.
  Native open/save dialogs (rfd, xdg-desktop-portal backend) return
  document-portal mounts granted by the user at pick time; the application
  only accepts project folders the user actually picked (granted-paths
  registry in crates/app/src/commands/fs.rs, plus $HOME outside the sandbox
  so the "recent projects" history survives restarts) and "reveal in file
  manager" goes through the OpenURI portal. File operations are additionally
  confined to the current project root + sandboxed app data/config dirs via
  allowed_roots()/assert_within(). Application data (SQLite notes/history,
  templates, caches) stays inside the sandboxed app directory
  (~/.var/app/io.github.gnoooo.typst-ide/). No host/system access is
  requested.
```

## 7. Adaptations côté code (sandbox)

Déjà implémenté :

1. **Révéler dans le gestionnaire de fichiers** : `reveal_in_file_manager` (`commands/fs.rs`) utilise le portail OpenURI sous sandbox (`crates/app/src/portal.rs`, `ashpd`), avec repli `xdg-open` hors sandbox (et `explorer`/`open` sur Windows/macOS).
2. **Fonts** : `fontdb` charge aussi `/run/host/fonts` et `/run/host/fonts-cache` quand ils existent (`commands/misc.rs`, helper `load_fonts`).
3. **Validation des chemins** : `create_project()` et `open_project()` n'acceptent que les chemins choisis via un dialogue (`GRANTED_PATHS` dans `commands/fs.rs`), les montages document-portal sous sandbox, ou `$HOME` hors sandbox. Les sources de templates (`copy_assets`) passent par le même contrôle.
4. **Frontend** : si un projet de l'historique n'est plus accessible (autorisation révoquée, dossier déplacé), l'interface propose de re-sélectionner le dossier et met l'entrée à jour. Sous sandbox, la saisie manuelle de chemin est désactivée (`is_sandboxed`).

À valider pendant les tests locaux :

1. **Persistance des montages document-portal** : vérifier qu'un projet ajouté à l'historique se rouvre après redémarrage de la session ; sinon le repli « re-sélectionner le dossier » couvre le cas.
2. **`canonicalize` sur les montages FUSE** : si la résolution échoue sur `/run/user/<uid>/doc/...`, adapter `assert_within()`/`is_granted()` (repli lexical déjà prévu pour les chemins inexistants).
3. **Comportement hors Flatpak** : vérifier la création/ouverture/réouverture de projets sur l'AppImage et le `.deb` (les projets hors `$HOME` sur supports externes doivent être re-sélectionnés après redémarrage : c'est voulu).

## 8. Vérification locale et CI

Le workflow `.github/workflows/flatpak.yml` (PR, push main et tags) vérifie le build sur les deux architectures avec l'action officielle, dans l'image `ghcr.io/flathub-infra/flatpak-github-actions:gnome-51` :

```yaml
- uses: flatpak/flatpak-github-actions/flatpak-builder@master
  with:
    bundle: typst-ide-${{ matrix.arch }}.flatpak
    manifest-path: flatpak/io.github.gnoooo.typst-ide.yml
    arch: ${{ matrix.arch }}
```

- Matrice x86_64 (`ubuntu-24.04`) + aarch64 (`ubuntu-24.04-arm`) : Flathub construit les deux, la CI les prouve.
- Build de vérification (le build Flathub officiel reste fait par leur buildbot).
- Le cache de l'action suit le hash du manifeste (pas de cache-key explicite) : chaud entre deux runs, invalidé quand le manifeste change.

Commandes locales (équivalent : `./manage.sh flatpak-build` puis `./manage.sh flatpak-run`) :

```bash
./manage.sh flatpak-build   # install les runtimes si besoin, build + install + les 2 lints
./manage.sh flatpak-run
```

Résultats constatés : les lints `manifest` et `repo` passent sans erreur ni avertissement sur le runtime GNOME 51 (le miroir de screenshots `dl.flathub.org/media` est réalisé par l'infrastructure Flathub au moment de la publication, pas par le manifeste).

Tester au minimum le lancement, la création et la réouverture d'un projet, les imports, l'export PDF, un package `@preview`, les fonts, et « révéler dans le gestionnaire de fichiers ».

## 9. Soumission et maintenance

Soumission (une fois) :
1. Fork de `flathub/flathub`, puis clone de la branche `new-pr`.
2. Créer une branche de soumission.
3. Ajouter au niveau supérieur `io.github.gnoooo.typst-ide.yml`, `cargo-sources.json`, `node-sources.json` et, si nécessaire, `flathub.json`.
4. Vérifier que le metainfo et le desktop file intégrés dans la source amont correspondent exactement à `io.github.gnoooo.typst-ide`.
5. Ouvrir une PR contre `new-pr` avec le bloc de justification (paragraphe 6.3) et les informations sur les permissions.
6. Itérer avec les reviewers, puis accès en écriture au dépôt `flathub/io.github.gnoooo.typst-ide`.

À chaque release :
1. `./manage.sh bump <version>` : versions + entrée `<release>` du metainfo (date du jour) ; si `Cargo.lock` ou `frontend/package-lock.json` ont changé, `./manage.sh flatpak-sources` avant.
2. Commit, tag `vX.Y.Z`, push (le hook `pre-push` vérifie la cohérence metainfo comprise).
3. `./manage.sh flatpak-bump vX.Y.Z` : épingle `tag`/`commit` dans le manifeste Flathub, puis commit et push.
4. `./manage.sh flatpak-build` (build + lints) et `./manage.sh flatpak-run` pour le test local.
5. Ouvrir une PR sur `flathub/io.github.gnoooo.typst-ide`, ou laisser `x-checker-data` proposer une mise à jour à vérifier avant fusion.

## 10. Risques et replis

| Risque | Niveau | Repli |
|---|---|---|
| ID `com.typst.ide` refusé | Élevé | Utiliser `io.github.gnoooo.typst-ide` avant la première soumission |
| Metainfo invalide (`@DATE@`, développeur absent) | Élevé | Ajouter le développeur, une date réelle et valider avec le linter Flathub |
| Desktop file/icône incohérents | Élevé | Utiliser le nouvel ID partout, y compris `Icon=` et les chemins d'installation |
| Runtime GNOME dépassé | Moyen | À chaque soumission/bump, vérifier la dernière branche GNOME sur Flathub et aligner les extensions (`//26.08` pour GNOME 51) |
| Montages document-portal non persistants entre sessions | Moyen | Le repli « re-sélectionner le dossier » de l'historique couvre le cas ; vérifier avant soumission |
| `canonicalize` défaillant sur les montages FUSE du portail | Moyen | Adapter `assert_within()`/`is_granted()` (repli lexical prévu) |
| Projets hors `$HOME` (supports externes) à re-sélectionner après redémarrage | Faible | Comportement voulu, documenté ; le picker est disponible dans l'historique |
| Deps npm natives optionnelles (esbuild/rollup) hors-ligne sur aarch64 | Moyen | `flatpak-node-generator` embarque toutes les plateformes ; tester localement les deux arches, sinon `skip-arches` |
| `reveal`/fonts cassés dans le sandbox | Faible | Correctifs implémentés (portail OpenURI, `/run/host/fonts`) ; à confirmer en test interactif |
| Build Flatpak long en CI | Faible | Action officielle + cache |

## 11. Politique Flathub à connaître

Les fichiers envoyés dans la PR Flathub doivent être maintenables et ne doivent pas contenir de contenu généré par une IA. Les manifests et scripts de packaging doivent donc être écrits et vérifiés manuellement. Toute contribution générée avec assistance doit être revue et déclarée conformément à la politique Flathub applicable au moment de la soumission.
