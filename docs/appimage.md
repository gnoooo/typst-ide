# AppImage : construction, fonctionnement et dépannage

Ce document explique comment Typst IDE produit son AppImage, pourquoi le build release passe par un conteneur, et comment reproduire/déboguer la CI en local.

## Pourquoi un conteneur pour la release ?

Un build Tauri lie l'application à la **glibc** (et à la pile GTK/WebKit) de la machine de build. Construite sur Fedora 43, l'AppImage exigerait une glibc récente et ne démarrerait pas sur Ubuntu 22.04 ou Debian 12. 
La règle est donc de **builder sur la plus vieille base supportée** :
- la CI (`release.yml`) tourne sur `ubuntu-22.04` ;
- `./manage.sh build <cibles> --container` reproduit exactement cet
  environnement dans un conteneur local (podman ou docker), sans toucher à ton
  système.

Un build natif (`./manage.sh build appimage`, sans `--container`) reste utile pour **itérer vite** sur le code, mais son AppImage n'est pas distribuable (glibc de la distro courante). 
Utiliser `--container` permet de tester ce que la CI va publier.

## Prérequis
- Podman (recommandé, rootless) ou Docker. Podman est prioritaire car n'a pas besoin d'accès root.
- ~2 Go de disque (image ubuntu:22.04 + toolchains + caches).
- Accès réseau au premier lancement (apt, NodeSource, rustup, appimagetool).

## Usage

```bash
# AppImage de release (base ubuntu:22.04), post-traitée et prête à tester :
./manage.sh build appimage --container

# Plusieurs bundles dans le même conteneur :
./manage.sh build appimage,deb,rpm --container
./manage.sh build all --container        # = appimage,deb,rpm sur Linux

# Autre image de base (à tes risques : la glibc suit l'image) :
./manage.sh build appimage --container --container-image ubuntu:24.04

# Reconstruire l'image de build sans cache :
./manage.sh build appimage --container --container-rebuild

# Cross-compilation (transmise à `tauri build --target`) :
./manage.sh build deb --target x86_64-unknown-linux-gnu
```

Les artefacts atterrissent dans :

```
target/container/release/bundle/appimage/typst-ide-<version>-x86_64.AppImage
target/container/release/bundle/appimage/typst-ide-<version>-x86_64.AppImage.zsync
target/container/release/bundle/deb/...
target/container/release/bundle/rpm/...
```

(avec `--target <triple>`, insérer le triple : `target/container/<triple>/release/bundle/…`).

Pour rejouer uniquement le post-traitement sur un bundle existant :
```bash
./manage.sh fix-appimage              # dernier bundle de target/
./manage.sh fix-appimage target/container/release/bundle/appimage
```

## Ce que fait le post-traitement (`scripts/fix-appimage.sh`)

`tauri build` produit une AppImage brute via `linuxdeploy` + son plugin GTK.
Elle n'est pas directement conforme (et casse sur les systèmes récents), donc le script la corrige :

1. **Exclusions** : suppression des bibliothèques qui doivent venir de l'hôte (excludelist AppImage). 
   `linuxdeploy` en exclut déjà la plupart (GL/EGL/drm/gbm/X11/xcb/freetype...), mais pas `libwayland-*`, 
    or un `libwayland-client` embarqué casse l'EGL de Mesa récent (fenêtre blanche, scroll cassé, tauri-apps/tauri#15665).

2. **AppRun personnalisé** (`scripts/appimage/AppRun`) : il utilise le
   **WebKitGTK de l'hôte** quand il existe (comme le .deb/.rpm : Wayland natif,
   "jump from cursor" fonctionnel), et retombe sur le WebKitGTK embarqué
   sinon (hôte sans WebKit, CI Ubuntu nue). `TYPST_IDE_PREFER_SYSTEM_WEBKIT=0`
   force le mode embarqué.

3. **AppStream** : `usr/share/metainfo/com.typst.ide.appdata.xml` (avec la version injectée), 
   et le fichier `.desktop` est renommé `com.typst.ide.desktop` pour que l'identifiant corresponde.

4. **Repack officiel** avec `appimagetool`, en embarquant les informations de
   mise à jour `gh-releases-zsync` et en générant le `.zsync` (AppImageUpdate).


## Fonctionnement interne du conteneur

`manage.sh` enchaîne :

1. **Build de l'image** depuis `scripts/build/Containerfile.ubuntu2204`
   (Ubuntu 22.04 + deps Tauri + Rust + Node 20 + `@tauri-apps/cli` épinglé + `appimagetool`). 
   Les couches sont mises en cache : seuls les changements du Containerfile déclenchent une reconstruction.

2. **Montage du dépôt** : `-v $PWD:/work` (+ `:Z` si SELinux, indispensable sous Fedora). 
   Sous Docker rootful, le conteneur tourne avec ton UID/GID pour que les fichiers sortent à votre nom. 
   Sous Podman rootless, le root du conteneur est déjà mappé sur votre utilisateur.

3. **Exécution de `scripts/build/in-container.sh`** : `npm ci` + build frontend, `tauri build --bundles <cibles>` 
   (les cibles Windows `nsis`/`windows` y sont cross-compilées en MSVC via `cargo-xwin`, voir [docs/windows-build.md](./windows-build.md)), puis `fix-appimage.sh`.

4. **Caches persistants** (sous `target/container/`, ignoré par git) :
   `cargo-home/` (registre Cargo), `npm-cache/`, `cache/` (outils Tauri/linuxdeploy), `release/` (artefacts de compilation). 
   Pour repartir de zéro : `rm -rf target/container` et, pour l'image, `podman rmi typst-ide-build:ubuntu22.04` (ou `--container-rebuild`).

Rien n'est installé sur votre système hôte : seul le stockage des images conteneur (géré par podman/docker) grossit.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `permission denied` sur le dépôt monté (Fedora) | SELinux | le script ajoute déjà `:Z` ; vérifie que `selinuxenabled` est dispo |
| Fichiers artefacts appartenant à `root` (Docker) | Docker rootful | relance en Podman, ou `sudo chown -R $USER target/container` |
| `cannot find -l…` ou erreurs EGL dans la CI locale | image incomplète | `--container-rebuild`, vérifie le Containerfile |
| AppImage ne se lance pas (`FUSE`) | pas de libfuse2 sur l'hôte | pas nécessaire pour builder ; pour tester : `APPIMAGE_EXTRACT_AND_RUN=1 ./typst-ide-*.AppImage` |
| "jump from cursor" mort dans l'AppImage | WebKit embarqué + `GDK_BACKEND=x11` | vérifie que l'hôte a `webkit2gtk-4.1` (mode système) ; sinon `TYPST_IDE_PREFER_SYSTEM_WEBKIT=0` permet de comparer |
| `.zsync` absent | `zsync` non installé sur la machine de build | installe `zsync` (présent dans le conteneur et la CI) |

## Lien avec la CI

`.github/workflows/release.yml` exécute **la même commande** que celle utilisée
en local :

```bash
./manage.sh build appimage,deb,rpm --target x86_64-unknown-linux-gnu
```

puis un smoke-test de l'AppImage sous Xvfb (ouverture d'une fenêtre) avantpublication. 
Si un changement casse le build local `--container`, il cassera la CI de la même façon, c'est précisément l'intérêt.

Le dépôt est prêt pour AppImageHub (nomenclature `typst-ide-<version>-x86_64.AppImage`, AppStream, informations de mise à jour `gh-releases-zsync`, `.zsync` publié) : ce sont exactement les éléments que le
test automatique de la galerie vérifie lors de la soumission.
