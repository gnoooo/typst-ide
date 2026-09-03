# TODO

Liste des améliorations identifiées lors de l'analyse du projet (août 2026).
Les items sont groupés par priorité.

## Bugs / incohérences

- [x] Ajouter un fichier `LICENSE` à la racine (le PKGBUILD déclare GPL-3.0 mais aucun fichier ne l'accompagne)
- [x] Mettre à jour le README : supprimer les références à `npm run build:css` et `npm run postinstall` (scripts absents du `frontend/package.json`) et à l'AppImage (plus dans les targets de `tauri.conf.json`)
- [x] Ajouter l'entrée v1.4.3 dans `RELEASE_NOTES.md` (les fichiers de version sont à 1.4.3, les notes s'arrêtent à v1.4.2)
- [x] Retirer les `eprintln!` de debug laissés dans `crates/core/src/compiler/compile.rs` (cursor_jump, resolve_click)
- [x] Supprimer le dossier vide `crates/build-all/` (pas de Cargo.toml, pas membre du workspace)
- [x] Remplacer les `.expect("Failed to initialise … DB")` du setup (`crates/app/src/main.rs`) par une gestion d'erreur propre avec message utilisateur

## Tests et CI

- [x] Ajouter des tests unitaires JavaScript (aucun test pour ~6 600 lignes de frontend)
- [x] Ajouter des tests d'intégration pour les commandes Tauri (tests Rust via `tauri::test` mock apps, sans tauri-driver)
- [x] Sortir les démos `demo/` du périmètre (moyens de générer les GIFs du README, pas des tests)
- [x] Lancer `./manage.sh check` et `./manage.sh test` dans la CI (actuellement : build sur tag uniquement, sans test ni lint) — couvert par le workflow CI des PR
- [x] Créer un workflow CI pour les PR (build + tests) en plus du workflow de release
- [ ] Ajouter un job macOS au build de release

## Fonctionnalités

- [ ] Édition multi-fichiers : ouvrir les autres fichiers `.typ` du projet dans l'éditeur (onglets ou remplacement du fichier courant)
- [ ] Complétion et snippets Typst dans Monaco (le tokenizer Monarch actuel ne fournit pas de suggestions)
- [ ] Recherche dans tout le projet (au-delà du find de Monaco dans le fichier courant)
- [ ] Mise à jour automatique (`tauri-plugin-updater`) et signature des builds
- [ ] Export des pages du preview en PNG/SVG (le PDF est seul export actuel)

## Divers

- [ ] Build macOS
- [ ] Assistant / solution pour l'AppImage (webkit bundlé cassé, documenté mais pas corrigé)
- [ ] Définir une procédure de suivi des versions de Typst (dépendance épinglée en 0.15, fork `typst-as-library` embarqué à maintenir)
- [ ] Vérifier la surface de permissions Tauri (opener `https://**` très large)
