# Build Windows : local, conteneurisé et CI

Ce document explique comment produire les artefacts Windows de Typst IDE, pourquoi il n'existe pas de "conteneur Windows" sous Linux, et comment obtenir un résultat proche de la CI officielle en local.

## TL;DR

```bash
# La "CI locale Windows" recommandée : MSVC via cargo-xwin, dans le conteneur
# de release (mêmes dépendances que la CI, aucune dépendance sur l'hôte).
./manage.sh build windows --container
# -> target/container/dist/windows/Typst IDE_<version>_x64-setup.exe
# -> target/container/dist/windows/Typst IDE_<version>_x64-portable.exe

# Tout (Linux + Windows) en un run, comme la CI :
./manage.sh build all --container

# Cross MinGW directement sur l'hôte (plus rapide, mais dépendances hôte) :
./manage.sh build windows
# -> target/dist/windows/ (portable + WebView2Loader.dll + installeur)
```

## Pourquoi pas un conteneur Windows ?

Sous Linux, un conteneur partage le noyau de l'hôte : un "conteneur Windows" est impossible (il faudrait un hôte Windows, ou une VM). 
Ce qui existe, c'est une **VM Windows dans un conteneur** (par exemple `dockur/windows`, utilisé par le projet WinBoat par exemple) : c'est une vraie VM QEMU/KVM encapsulée. 
Elle donne une parité totale avec `windows-latest`, mais demande un provisionnement (Visual Studio Build Tools, Rust MSVC, Node...) et un canal d'automatisation (SSH/WinRM ou tâche planifiée), donc elle n'est pas intégrée à `manage.sh` pour l'instant.

## Les trois modes de build Windows

| Mode | Commande | Artefact | Dépendances hôte | Parité CI |
|---|---|---|---|---|
| **MSVC natif (CI)** | job `build-windows` (windows-latest) | portable auto-contenu + installeur NSIS | aucune (runner Windows) | ★★★★ |
| **MSVC (conteneur)** | `build windows --container` | portable auto-contenu + installeur NSIS | podman/docker uniquement | ★★★ (cargo-xwin, Tauri officiel) |
| **MinGW (hôte)** | `build windows` | portable + `WebView2Loader.dll` + installeur NSIS | mingw-w64, std Rust `windows-gnu`, stubs NSIS | ★★ |
| **VM Windows** | (manuel / à venir) | identique `windows-latest` | VM QEMU/KVM | ★★★★ |

> La CI GitHub exécute les mêmes commandes que le local (`manage.sh`, publication
> `dist/`, versions épinglées — Rust/Node/Tauri CLI identiques au Containerfile).
> Côté Windows, la CI compile en **MSVC natif** et le conteneur local en
> **cargo-xwin** : les deux produisent un binaire MSVC auto-contenu, pas
> bit-à-bit identique.

## Mode conteneur (MSVC via cargo-xwin)

C'est la méthode "CI locale Windows" : le conteneur `ubuntu:22.04` embarque Rust + la cible `x86_64-pc-windows-msvc`, `cargo-xwin`, clang/lld/llvm (pour `llvm-rc`), NSIS et Node. 
Rien n'est installé sur la machine.

Déroulement :
1. `npm ci` + build frontend dans le volume monté.
2. `tauri build --bundles nsis --runner cargo-xwin --target x86_64-pc-windows-msvc`.
3. publication dans `dist/windows/` : installeur + portable `Typst IDE_<version>_x64-portable.exe` (même nom que la CI).

Détails utiles :
- **SDK Windows** : `cargo-xwin` télécharge le CRT/SDK Microsoft au premier build dans `target/container/cache/xwin` (persistant, ~1 Go). Les builds suivants sont hors-ligne.

- **`TMPDIR`** : forcé sous `target/container/cache/tmp`, sinon le bundler NSIS peut échouer avec `Invalid cross-device link` en conteneur (tauri-apps/tauri#10647).

- **Avertissement** `Cross-platform compilation is experimental...` : normal, il vient de Tauri. L'exécutable produit est un vrai binaire MSVC, auto-contenu (pas de `WebView2Loader.dll` à côté, contrairement au mode MinGW).

- **MSI impossible** : WiX ne tourne que sous Windows. On produit donc l'installeur NSIS (`-setup.exe`) et l'exe portable, comme la CI actuelle.

- **Publication** : tous les artefacts finaux sont rangés par OS dans `target/container/dist/{linux,windows}/` (ou `target/dist/` pour un build hôte), quelle que soit la cible de compilation.

- **WebView2 Runtime** : l'exe portable (comme celui de la CI) exige le runtime WebView2 installé sur la machine Windows ; l'installeur NSIS l'installe automatiquement s'il manque (`downloadBootstrapper`).   Sous Linux, un double-clic sur le `.exe` passe par **Wine**, qui ne fournit pas WebView2 : teste dans la VM Windows (WinBoat) ou installe le runtime ; ne conclus pas à un bug du build.

Pour reconstruire l'image après une modification du Containerfile :
```bash
./manage.sh build windows --container --container-rebuild
```

## Mode hôte (MinGW)
Plus rapide (pas d'overhead conteneur) mais il faut la toolchain sur la machine :

```bash
# Fedora
sudo dnf install mingw64-gcc mingw64-gcc-c++ rust-std-static-x86_64-pc-windows-gnu mingw32-nsis
# Arch
sudo pacman -S mingw-w64-gcc nsis   # rustup target add x86_64-pc-windows-gnu
```

`manage.sh build all` (sans `--container`) inclut Windows **si** ces prérequis sont présents, sinon il les détecte et affiche la commande d'installation.
Avec MinGW, le portable dépend de `WebView2Loader.dll` (copié dans `target/dist/windows/` à côté du portable) : c'est une différence avec la CI MSVC, qui est auto-contenue.

## Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| `la cible Windows` puis liste `nsis` | stubs NSIS absents (Fedora fournit `makensis` dans `mingw-nsis-base`, mais pas les stubs) | `sudo dnf install mingw32-nsis` (ou mode `--container`) |
| `Invalid cross-device link` (NSIS) | `TMPDIR` sur un autre système de fichiers que le target | déjà corrigé dans le conteneur ; sur l'hôte, `export TMPDIR=<dossier du target>` |
| Téléchargement SDK très long (1er run) | `cargo-xwin` télécharge le SDK MSVC | attendre (le cache `target/container/cache/xwin` est réutilisé) |
| `llvm-rc not found` | pas de `llvm` installé | mode conteneur (fourni), ou `sudo dnf install llvm` |
| Signature | seule la CI/GitHub peut signer (pas activé) | hors périmètre |
| Échec `cargo xwin` inattendu | cross expérimental | repli : `./manage.sh build windows` (MinGW) |

## Voir aussi

- [docs/appimage.md](./appimage.md) : pipeline AppImage et mode conteneur Linux.
- [Tauri : Build Windows apps on Linux and macOS](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos)
