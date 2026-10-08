#!/bin/bash

# ===================================================================================================
# manage.sh : manager de projet pour Typst IDE (Rust + Tauri + frontend)

# Usage:
#   ./manage.sh info                      Infos du projet (nom, version, cohérence, git…)
#   ./manage.sh bump <version|type>       Met à jour la version partout (--dry-run dispo)
#   ./manage.sh check                     Cohérence des versions + cargo fmt/check
#   ./manage.sh test                      Tests du workspace
#   ./manage.sh build [cibles] [opts]     Build frontend + bundles Tauri
#                                           cibles   : frontend | rust | appimage | deb | rpm | nsis | windows | all (défaut)
#                                                      windows = installateur NSIS + exe portable
#                                                      all     = bundles natifs + Windows (toolchain host, ou conteneur)
#                                           options  : --target <triple>           cross-compilation (ex. x86_64-pc-windows-msvc)
#                                                      --container                 build release dans un conteneur ubuntu:22.04
#                                                                                  (Windows y est cross-compilé en MSVC via cargo-xwin)
#                                                      --container-image <image>   image de base (défaut : ubuntu:22.04)
#                                                      --container-rebuild         reconstruit l'image de build sans cache
#   ./manage.sh fix-appimage [chemin]     Rejoue le post-traitement AppImage (docs/appimage.md)
#   ./manage.sh flatpak-sources           Régénère les sources cargo/npm du manifeste Flatpak
#   ./manage.sh flatpak-build             Build + installe le Flatpak + lints (cache .flatpak-builder)
#   ./manage.sh flatpak-run               Lance l'app sandboxée (flatpak run)
#   ./manage.sh flatpak-bump <tag>        Épingle tag/commit dans le manifeste Flatpak (après la sortie d'un tag)
#   ./manage.sh clean [cibles] [opts]     Nettoie les builds et caches
#                                           cibles   : build (défaut) | cache | dist | image | all
#                                           options  : --dry-run, --yes, --with-dist, --host-caches
#   ./manage.sh dev                       Lance tauri dev
#   ./manage.sh help                      Cette aide

# Exemples:
#   ./manage.sh build                                     # natif + Windows (host, ou MSVC en conteneur)
#   ./manage.sh build appimage                            # seulement l'AppImage (post-traitée)
#   ./manage.sh build appimage,deb,rpm                    # plusieurs cibles
#   ./manage.sh build windows                             # installateur NSIS + exe portable (cross Linux)
#   ./manage.sh build windows --container                 # idem mais MSVC via cargo-xwin (parité CI)
#   ./manage.sh build appimage,deb,rpm,windows --container  # tout, comme la CI
#   ./manage.sh build rust                                # ancien comportement (frontend + cargo release)
#   ./manage.sh clean --dry-run                           # montrer ce qui serait supprimé
#   ./manage.sh clean build --yes                         # libérer les intermédiaires cargo
#
# Artefacts finaux : target/dist/ (build hôte) ou target/container/dist/ (conteneur), organisés en linux/ et windows/.
# ===================================================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_CRATE="$REPO_ROOT/crates/app/Cargo.toml"
TAURI_CONF="$REPO_ROOT/crates/app/tauri.conf.json"
PKGBUILD="$REPO_ROOT/PKGBUILD"
LOCKFILE="$REPO_ROOT/Cargo.lock"
FRONTEND_PKG="$REPO_ROOT/frontend/package.json"
FRONTEND_LOCK="$REPO_ROOT/frontend/package-lock.json"
FLATPAK_MANIFEST="$REPO_ROOT/flatpak/io.github.gnoooo.typst-ide.yml"
FLATPAK_METAINFO="$REPO_ROOT/flatpak/io.github.gnoooo.typst-ide.metainfo.xml"
FLATPAK_APP_ID="io.github.gnoooo.typst-ide"

# Runtime et extensions Flatpak (branches alignées sur le runtime du manifeste :
# GNOME 51 -> extensions 26.08). À ajuster en même temps que runtime-version
# dans le manifeste. Voir docs/flatpak.md.
FLATPAK_RUNTIME="org.gnome.Platform//51"
FLATPAK_SDK="org.gnome.Sdk//51"
FLATPAK_RUST_EXT="org.freedesktop.Sdk.Extension.rust-stable//26.08"
FLATPAK_NODE_EXT="org.freedesktop.Sdk.Extension.node24//26.08"
FLATPAK_BUILDER_APP="org.flatpak.Builder"

SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'

# ---------------------
# Helpers
# ---------------------
usage() {
  sed -n '4,38p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

die() { echo "manage: $*" >&2; exit 1; }

# Couleurs : codes émis seulement si stdout est un terminal (et NO_COLOR absent).
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; DIM=$'\e[2m'; BOLD=$'\e[1m'; NC=$'\e[0m'
else
  GREEN=''; RED=''; YELLOW=''; DIM=''; BOLD=''; NC=''
fi

require_file() {
  [ -f "$1" ] || die "fichier introuvable: $1"
}

# --- Fetch (lecture des versions) ---

app_version()      { sed -n 's/^version = "\([^"]*\)"/\1/p' "$APP_CRATE" | head -n 1; }
app_name()         { sed -n 's/^name = "\([^"]*\)"/\1/p' "$APP_CRATE" | head -n 1; }
product_name()     { sed -n 's/.*"productName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TAURI_CONF" | head -n 1; }
tauri_version()    { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TAURI_CONF" | head -n 1; }
pkgbuild_version() { sed -n 's/^pkgver=\(.*\)/\1/p' "$PKGBUILD" | head -n 1; }
frontend_version() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$FRONTEND_PKG" | head -n 1; }

# version de l'entrée <release> du metainfo Flatpak (première entrée, la plus récente)
metainfo_version() {
  sed -n 's/.*<release version="\([^"]*\)".*/\1/p' "$FLATPAK_METAINFO" | head -n 1
}

# version de l'entrée workspace `typst-ide-app` dans Cargo.lock
# (l'entrée registry "typst-ide 0.15.x" possède un `source = ...`, ignorée)
lock_version() {
  awk '
    /^name = /      { name=$0 }
    /^version = / && name == "name = \"typst-ide-app\"" && !target { target=NR }
    /^source = / && name == "name = \"typst-ide-app\"" { target = 0 }
    { lines[NR]=$0 }
    END {
      if (target > 0) {
        line = lines[target]
        match(line, /"[^"]*"/)
        print substr(line, RSTART + 1, RLENGTH - 2)
      }
    }
  ' "$LOCKFILE"
}

# --- Set (écriture des versions) ---

set_app_version() {
  sed -i "s/^version = \"[^\"]*\"/version = \"$1\"/" "$APP_CRATE"
}

set_tauri_version() {
  sed -i "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$1\"/" "$TAURI_CONF"
}

set_pkgbuild_version() {
  sed -i "s/^pkgver=.*/pkgver=$1/" "$PKGBUILD"
}

# remplace la version de l'entrée workspace `typst-ide-app` dans Cargo.lock
set_lock_version() {
  awk -v new="$1" '
    /^name = /      { name=$0 }
    /^version = / && name == "name = \"typst-ide-app\"" && !target { target=NR }
    /^source = / && name == "name = \"typst-ide-app\"" { target=0 }
    { lines[NR]=$0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (i == target) sub(/"[^"]*"/, "\"" new "\"", lines[i])
        print lines[i]
      }
    }
  ' "$LOCKFILE" > "$LOCKFILE.tmp" && mv "$LOCKFILE.tmp" "$LOCKFILE"
}

set_frontend_version() {
  ( cd "$REPO_ROOT/frontend" && npm version --no-git-tag-version "$1" >/dev/null )
}

# remplace la première entrée <release> du metainfo Flatpak (version + date)
set_metainfo_version() {
  sed -i "0,/<release version=/s|<release version=\"[^\"]*\" date=\"[^\"]*\"|<release version=\"$1\" date=\"$2\"|" "$FLATPAK_METAINFO"
}

# --- Cohérence ---

# vérifie la cohérence des fichiers de version (Cargo.toml, tauri.conf.json, PKGBUILD, Cargo.lock : les 3 premiers comme le hook pre-push).
# le frontend est affiché et synchronisé par `bump`, mais ne bloque jamais.
# retourne 0 si cohérent, 1 sinon. Sortie optionnelle avec `--pretty`.
check_consistency() {
  local pretty=0
  [ "${1:-}" = "--pretty" ] && pretty=1

  local app tauri pkgbuild lock front meta
  app="$(app_version)"
  tauri="$(tauri_version)"
  pkgbuild="$(pkgbuild_version)"
  lock="$(lock_version)"
  front="$(frontend_version)"
  meta="$(metainfo_version 2>/dev/null || true)"

  local ok=1
  [ -n "$app" ]      || ok=0
  [ "$app" = "$tauri" ]    || ok=0
  [ "$app" = "$pkgbuild" ] || ok=0
  [ "$app" = "$lock" ]     || ok=0
  # le metainfo Flatpak suit `bump` ; il bloque comme les fichiers de version
  [ "$app" = "$meta" ]     || ok=0

  if [ "$pretty" = "1" ]; then
    row() {
      local name="$1" val="$2" good="$3"
      if [ "$good" = "1" ]; then
        printf "    %-28s %s %s\n" "$name" "${GREEN}OK${NC}" "$val"
      else
        printf "    %-28s %s %s\n" "$name" "${RED}KO${NC}" "${val:--}"
      fi
    }
    row "crates/app/Cargo.toml"      "$app"      "$([ -n "$app" ] && echo 1 || echo 0)"
    row "crates/app/tauri.conf.json" "$tauri"    "$([ "$app" = "$tauri" ] && echo 1 || echo 0)"
    row "PKGBUILD (pkgver)"          "$pkgbuild" "$([ "$app" = "$pkgbuild" ] && echo 1 || echo 0)"
    row "Cargo.lock (workspace)"     "$lock"     "$([ "$app" = "$lock" ] && echo 1 || echo 0)"
    row "flatpak metainfo (release)" "$meta"     "$([ "$app" = "$meta" ] && echo 1 || echo 0)"
    if [ "$app" = "$front" ]; then
      row "frontend/package.json" "$front" "1"
    else
      printf "    %-28s %s %s %s\n" "frontend/package.json" "${DIM} ~${NC}" "$front" "${DIM}(suivi par bump, non bloquant)${NC}"
    fi
  fi

  [ "$ok" = "1" ]
}

# --- Divers ---

last_git_tag() {
  git -C "$REPO_ROOT" describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "(aucun tag)"
}

git_branch() {
  git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "(détaché)"
}

# --- Bump automatique ---

# Calcule la nouvelle version depuis la version actuelle et un type de bump.
# Supporte major, minor, patch et leurs variantes pre-* (prerelease).
compute_bump() {
  local kind="$1" cur="$2"
  local ma mi pa suffix=""
  if [[ "$cur" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-.*)?$ ]]; then
    ma=${BASH_REMATCH[1]}; mi=${BASH_REMATCH[2]}; pa=${BASH_REMATCH[3]}
    suffix="${BASH_REMATCH[4]}"
  else
    die "version actuelle non valide ('$cur') : impossible de bumper '$kind'"
  fi
  case "$kind" in
    major)     echo "$((ma + 1)).0.0" ;;
    minor)     echo "$ma.$((mi + 1)).0" ;;
    patch)     echo "$ma.$mi.$((pa + 1))" ;;
    premajor)  echo "$((ma + 1)).0.0-0" ;;
    preminor)  echo "$ma.$((mi + 1)).0-0" ;;
    prepatch)  echo "$ma.$mi.$((pa + 1))-0" ;;
    prerelease)
      if [[ "$suffix" =~ ^-([0-9]+)$ ]]; then
        echo "$ma.$mi.$pa-$((${BASH_REMATCH[1]} + 1))"
      elif [ -n "$suffix" ]; then
        echo "$ma.$mi.$pa${suffix}.0"
      else
        echo "$ma.$mi.$pa-0"
      fi
      ;;
    *) die "type de bump inconnu: $kind" ;;
  esac
}

# ---------------------
# Commandes
# ---------------------

cmd_info() {
  require_file "$APP_CRATE" "$TAURI_CONF" "$PKGBUILD" "$LOCKFILE" "$FRONTEND_PKG"

  echo "${BOLD}Typst IDE : infos du projet${NC}"
  echo
  printf "    %-28s %s\n" "App (Cargo.toml)" "$(app_name) $(app_version)"
  printf "    %-28s %s\n" "Nom du produit (Tauri)" "$(product_name)"
  echo
  echo "${BOLD}Versions${NC}"
  if check_consistency --pretty; then
    echo
    echo "    ${GREEN}Cohérence des versions : OK${NC}"
  else
    echo
    echo "    ${RED}Cohérence des versions : KO${NC}"
  fi

  echo
  echo "${BOLD}Workspace${NC}"
  local in_workspace=0
  while IFS= read -r line; do
    case "$line" in
      "[workspace]") in_workspace=1 ;;
      "["*"]")       in_workspace=0 ;;
      *"members"*)   continue ;;
      *)
        if [ "$in_workspace" = "1" ] && printf '%s' "$line" | grep -q '^\s*"'; then
          printf "    %-28s %s\n" "membre" "$(echo "$line" | tr -d '",' | xargs)"
        fi
        ;;
    esac
  done < "$REPO_ROOT/Cargo.toml"

  echo
  echo "${BOLD}Outils${NC}"
  printf "    %-28s %s\n" "rustc" "$(rustc --version 2>/dev/null || echo "(introuvable)")"
  printf "    %-28s %s\n" "cargo" "$(cargo --version 2>/dev/null || echo "(introuvable)")"
  printf "    %-28s %s\n" "node" "$(node --version 2>/dev/null || echo "(introuvable)")"
  printf "    %-28s %s\n" "npm" "$(npm --version 2>/dev/null || echo "(introuvable)")"

  echo
  echo "${BOLD}Git${NC}"
  printf "    %-28s %s\n" "branche" "$(git_branch)"
  printf "    %-28s %s\n" "dernier tag" "$(last_git_tag)"
  printf "    %-28s %s\n" "état" "$(git -C "$REPO_ROOT" status --porcelain | grep -q . && echo " modifié" || echo " propre")"

  local head_sha
  head_sha="$(git -C "$REPO_ROOT" log -1 --format='%h %s' 2>/dev/null || echo "-")"
  printf "    %-28s %s\n" "dernier commit" "$head_sha"
}

cmd_bump() {
  local new_version="" bump_kind="" dry_run=0

  for arg in "$@"; do
    case "$arg" in
      --dry-run) dry_run=1 ;;
      -*) die "option inconnue: $arg (seule option acceptée: --dry-run)" ;;
      major|minor|patch|premajor|preminor|prepatch|prerelease)
        [ -z "$bump_kind" ] && bump_kind="$arg" || die "trop d'arguments: bump attend une seule version ou un seul type"
        ;;
      *)
        [ -z "$new_version" ] && new_version="$arg" || die "trop d'arguments: bump attend une seule version"
        ;;
    esac
  done
  [ -n "$new_version" ] || [ -n "$bump_kind" ] || die "usage: manage.sh bump <version|major|minor|patch|...> [--dry-run]"

  require_file "$APP_CRATE" "$TAURI_CONF" "$PKGBUILD" "$LOCKFILE" "$FRONTEND_PKG" "$FLATPAK_METAINFO"

  local old meta_old today
  old="$(app_version)"
  meta_old="$(metainfo_version)"
  today="$(date +%F)"

  # --- Bump automatique ---
  if [ -n "$bump_kind" ]; then
    new_version="$(compute_bump "$bump_kind" "$old")"
    echo "Bump automatique ($bump_kind) : $old -> ${BOLD}$new_version${NC}"
    echo
  fi

  # --- Validation ---
  echo "$new_version" | grep -qE "$SEMVER_RE" \
    || die "version invalide '$new_version' (format attendu: X.Y.Z, ex. 1.3.0)"

  [ "$old" = "$new_version" ] \
    && die "la version est déjà $new_version"

  if ! echo "$new_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "manage: ${YELLOW}attention${NC} : version non purement numérique ('$new_version') ; "
    echo "        PKGBUILD (pacman) pourrait la rejeter selon le format."
  fi

  echo "Bump de version : $old -> ${BOLD}$new_version${NC}"
  echo

  # --- Écriture ---
  if [ "$dry_run" = "1" ]; then
    echo "(--dry-run : rien n'est écrit)"
    dry_row() {
      printf "    %s %s -> " "${DIM}$(printf '%-28s' "$1")${NC}" "${YELLOW}$(printf '%-18s' "$2")${NC}"
      echo "${GREEN}$3${NC}"
    }
    dry_row "crates/app/Cargo.toml"      "version = \"$old\""       "version = \"$new_version\""
    dry_row "crates/app/tauri.conf.json" "\"version\": \"$old\""    "\"version\": \"$new_version\""
    dry_row "PKGBUILD"                   "pkgver=$old"              "pkgver=$new_version"
    dry_row "Cargo.lock"                 "typst-ide-app $old"       "typst-ide-app $new_version"
    dry_row "frontend/*"                 "$old"                     "$new_version"
    dry_row "flatpak metainfo (release)" "version=\"$meta_old\""    "version=\"$new_version\" date=\"$today\""
    echo
    echo "    Vérification attendue : ${GREEN}cohérent${NC}"
    exit 0
  fi

  set_app_version      "$new_version"
  set_tauri_version    "$new_version"
  set_pkgbuild_version "$new_version"
  set_lock_version     "$new_version"
  set_frontend_version "$new_version"
  set_metainfo_version "$new_version" "$today"

  echo "    ${GREEN}OK${NC} crates/app/Cargo.toml      -> version = \"$new_version\""
  echo "    ${GREEN}OK${NC} crates/app/tauri.conf.json -> \"version\": \"$new_version\""
  echo "    ${GREEN}OK${NC} PKGBUILD                   -> pkgver=$new_version"
  echo "    ${GREEN}OK${NC} Cargo.lock                 -> typst-ide-app $new_version"
  echo "    ${GREEN}OK${NC} frontend/package.json      -> $new_version"
  echo "    ${GREEN}OK${NC} frontend/package-lock.json -> $new_version"
  echo "    ${GREEN}OK${NC} flatpak metainfo (release) -> version=\"$new_version\" date=\"$today\""

  echo
  if check_consistency; then
    echo "${GREEN}Cohérence des versions : OK${NC}"
  else
    echo "${RED}Cohérence des versions : KO${NC}"
    exit 1
  fi

  echo
  echo "Fichiers modifiés :"
  git -C "$REPO_ROOT" status --short -- crates/app/Cargo.toml crates/app/tauri.conf.json PKGBUILD Cargo.lock frontend/package.json frontend/package-lock.json "$FLATPAK_METAINFO" | sed 's/^/    /'
  echo
  echo "Note : aucun commit ni tag créé. Le hook pre-push vérifiera la cohérence à la prochaine poussée."
  echo "Le manifeste Flatpak ($(basename "$FLATPAK_MANIFEST")) sera épinglé au tag après sa création : ./manage.sh flatpak-bump v$new_version"
}

cmd_check() {
  require_file "$APP_CRATE" "$TAURI_CONF" "$PKGBUILD"

  echo "== Cohérence des versions =="
  if check_consistency --pretty; then
    echo "    ${GREEN}OK${NC}"
  else
    echo "    ${RED}INCOHÉRENTES, alignez les fichiers avant de pousser${NC}"
    exit 1
  fi

  echo
  echo "== cargo fmt --all --check =="
  if cargo fmt --version >/dev/null 2>&1; then
    ( cd "$REPO_ROOT" && cargo fmt --all --check ) && echo -e "    rustfmt: ${GREEN}OK${NC}" || die "    rustfmt: des fichiers ne sont pas formatés"
  else
    echo "    ${YELLOW}rustfmt non installé (rustup component add rustfmt), vérification ignorée${NC}"
  fi

  echo
  echo "== cargo check --workspace =="
  ( cd "$REPO_ROOT" && cargo check --workspace ) && echo "    cargo check: ${GREEN}OK${NC}" || die "    cargo check a échoué"
}

cmd_test() {
  ( cd "$REPO_ROOT" && cargo test --workspace ) && echo "    tests: ${GREEN}OK (tout passe)${NC}" || die "    les tests ont échoué"
}

# ---------------------
# Build
# ---------------------

# Renvoie le runtime de conteneur disponible (podman prioritaire).
container_runtime() {
  if command -v podman >/dev/null 2>&1; then echo podman; return 0; fi
  if command -v docker >/dev/null 2>&1; then echo docker; return 0; fi
  return 1
}

# Chemin du dossier de bundle pour un target donné (vide = hôte).
bundle_dir_for() {
  local kind="$1" target="${2:-}"
  local base="$REPO_ROOT/target"
  [ -n "$target" ] && base="$base/$target"
  echo "$base/release/bundle/$kind"
}

# Commande Tauri disponible : binaire `tauri` (npm) ou sous-commande cargo.
tauri_cmd() {
  if command -v tauri >/dev/null 2>&1; then
    echo "tauri"
    return 0
  fi
  if cargo tauri --version >/dev/null 2>&1; then
    echo "cargo tauri"
    return 0
  fi
  return 1
}

# ---------------------
# Windows (cross-compilation depuis Linux)
# ---------------------

# Seul triple Windows utilisé par le projet (voir .cargo/config.toml).
WINDOWS_TARGET="x86_64-pc-windows-gnu"

is_windows_shell() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

target_is_windows() {
  case "$1" in
    *windows*) return 0 ;;
    *) return 1 ;;
  esac
}

# Vérifie que le makensis système sait produire un installeur (stubs inclus).
# Test fonctionnel : accepte aussi un makensis custom/wrapper dans le PATH.
nsis_usable() {
  command -v makensis >/dev/null 2>&1 || return 1
  local tmp
  tmp="$(mktemp -d)"
  printf 'Name "probe"\nOutFile "%s/probe.exe"\nSection\nSectionEnd\n' "$tmp" > "$tmp/probe.nsi"
  if makensis -V1 "$tmp/probe.nsi" >/dev/null 2>&1; then
    rm -rf "$tmp"
    return 0
  fi
  rm -rf "$tmp"
  return 1
}

# Liste (vide si tout est là) des prérequis manquants pour le cross Windows.
windows_prereqs_missing() {
  local missing="" libdir
  if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
    missing="mingw64-gcc"
  fi
  libdir="$(rustc --print target-libdir --target "$WINDOWS_TARGET" 2>/dev/null || true)"
  if [ -z "$libdir" ] || [ ! -d "$libdir" ]; then
    missing="${missing:+$missing }rust-std-static-x86_64-pc-windows-gnu"
  fi
  # Sur Linux, Tauri appelle le `makensis` système : il doit fournir les stubs
  # (paquet séparé sur Fedora, ex. `mingw32-nsis`).
  if ! nsis_usable; then
    missing="${missing:+$missing }nsis"
  fi
  printf '%s\n' "$missing"
}

windows_prereqs_ok() { [ -z "$(windows_prereqs_missing)" ]; }

windows_prereqs_hint() {
  echo "    prérequis Windows manquants : $(windows_prereqs_missing)" >&2
  echo "    Fedora : sudo dnf install mingw64-gcc mingw64-gcc-c++ rust-std-static-x86_64-pc-windows-gnu mingw32-nsis" >&2
  echo "    Arch   : sudo pacman -S mingw-w64-gcc nsis  puis  rustup target add x86_64-pc-windows-gnu" >&2
  echo "    Debian : sudo apt install gcc-mingw-w64-x86-64 nsis  puis  rustup target add x86_64-pc-windows-gnu" >&2
}

# Build dans le conteneur de release (voir scripts/build/Containerfile.ubuntu2204
# et docs/appimage.md). Liste et target sont passés par variables d'environnement.
build_in_container() {
  local list="$1" target="$2" image="$3" rebuild="$4"

  local runtime
  runtime="$(container_runtime)" || die "ni podman ni docker n'est installé (requis pour --container)"

  local containerfile="$REPO_ROOT/scripts/build/Containerfile.ubuntu2204"
  require_file "$containerfile"

  # Regroupe les anciens caches à la racine de target/container/ sous cache/
  # (idempotent, aucun retéléchargement ni recompilation).
  local croot="$REPO_ROOT/target/container"
  local caches="$croot/cache"
  mkdir -p "$caches"
  local d
  for d in cargo-home npm-cache xwin tmp; do
    if [ -e "$croot/$d" ] && [ ! -e "$caches/$d" ]; then
      mv "$croot/$d" "$caches/$d"
    fi
  done

  local tag="typst-ide-build:ubuntu22.04"
  local -a build_args=(build --build-arg "BASE_IMAGE=$image" -t "$tag" -f "$containerfile")
  [ "$rebuild" = "1" ] && build_args+=(--no-cache)
  echo "== Image de build ($runtime, $image) =="
  "$runtime" "${build_args[@]}" "$REPO_ROOT/scripts/build" \
    || die "la construction de l'image de build a échoué"

  local -a run_args=(run --rm -w /work)
  if command -v selinuxenabled >/dev/null 2>&1 && selinuxenabled 2>/dev/null; then
    run_args+=(-v "$REPO_ROOT:/work:Z")   # SELinux (Fedora) : relabellisation du montage
  else
    run_args+=(-v "$REPO_ROOT:/work")
  fi
  if [ "$runtime" = "docker" ]; then
    # docker rootful : se ramener à l'UID hôte pour que les artefacts sortent à ton nom
    run_args+=(--user "$(id -u):$(id -g)" -e HOME=/tmp)
  fi
  run_args+=(
    -e "BUNDLES=$list"
    -e "TARGET=$target"
    -e "CARGO_TARGET_DIR=/work/target/container"
    -e "DIST_DIR=/work/target/container/dist"
    "$tag"
    bash scripts/build/in-container.sh
  )
  echo "== Build dans le conteneur ($list${target:+ --target $target}) =="
  "$runtime" "${run_args[@]}" || die "le build conteneurisé a échoué"
}

cmd_build() {
  local use_container=0 rebuild=0 image="ubuntu:22.04" target=""
  local -a requested=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --container)         use_container=1; shift ;;
      --container-rebuild) rebuild=1; shift ;;
      --container-image)   image="${2:-}"; [ -n "$image" ] || die "--container-image attend une valeur"; shift 2 ;;
      --target)            target="${2:-}"; [ -n "$target" ] || die "--target attend une valeur"; shift 2 ;;
      -*)                  die "option inconnue: $1 (voir manage.sh help)" ;;
      *)                   requested+=("$1"); shift ;;
    esac
  done

  # Cibles : arguments positionnels (séparés par des espaces ou des virgules).
  local -a targets=()
  if [ "${#requested[@]}" -eq 0 ]; then
    targets=(all)
  else
    local arg part
    for arg in "${requested[@]}"; do
      IFS=',' read -ra parts <<< "$arg"
      for part in "${parts[@]}"; do
        [ -n "$part" ] && targets+=("$part")
      done
    done
  fi

  # Validation du triple éventuel.
  if [ -n "$target" ] && ! rustc --print target-list 2>/dev/null | grep -qx "$target"; then
    die "triple cible inconnu: $target"
  fi

  # Résolution de `all` selon l'OS + déduplication.
  # `all` sur Linux inclut Windows (cross) quand la toolchain est présente ;
  # en conteneur, Windows n'est jamais ajouté (toolchain Linux uniquement).
  local list="" windows_skipped=0
  add_target() { case " $list " in *" $1 "*) ;; *) list="${list:+$list }$1" ;; esac; }
  local t
  for t in "${targets[@]}"; do
    case "$t" in
      all)
        if [ -n "$target" ]; then
          if target_is_windows "$target"; then
            add_target windows
          else
            add_target appimage; add_target deb; add_target rpm
          fi
        elif is_windows_shell; then
          add_target nsis
          add_target windows
        else
          add_target appimage; add_target deb; add_target rpm
          if [ "$use_container" = "1" ]; then
            # In the release container, Windows is cross-compiled to MSVC with
            # cargo-xwin (CI parity), no host toolchain needed.
            add_target windows
          elif windows_prereqs_ok; then
            add_target windows
          else
            windows_skipped=1
          fi
        fi
        ;;
      frontend|rust|appimage|deb|rpm|nsis|windows) add_target "$t" ;;
      *) die "cible inconnue: $t (attendu: frontend|rust|appimage|deb|rpm|nsis|windows|all)" ;;
    esac
  done

  # Groupes demandés.
  local native_bundles="" want_nsis=0 want_windows=0
  for t in appimage deb rpm; do
    echo " $list " | grep -qw "$t" && native_bundles="${native_bundles:+$native_bundles,}$t"
  done
  echo " $list " | grep -qw nsis && want_nsis=1
  echo " $list " | grep -qw windows && want_windows=1
  local has_windows=$(( (want_nsis || want_windows) ? 1 : 0 ))

  # Garde-fous --target.
  if [ -n "$target" ]; then
    if target_is_windows "$target"; then
      [ -n "$native_bundles" ] && die "--target $target ne peut pas produire appimage/deb/rpm (cibles Linux)"
    else
      [ "$has_windows" = "1" ] && die "--target $target ne peut pas produire l'installateur Windows (utilise un triple *windows*)"
    fi
  fi

  echo "Cibles : ${BOLD}$list${NC}"
  echo

  if [ "$windows_skipped" = "1" ] && [ "$use_container" = "0" ]; then
    echo "${YELLOW}Windows ignoré pour 'all'${NC} (prérequis absents) :"
    windows_prereqs_hint
    echo
  fi

  if [ "$use_container" = "1" ]; then
    build_in_container "$list" "$target" "$image" "$rebuild"
    echo
    echo
    echo "Artefacts : ${BOLD}target/container/dist/${NC}"
    if [ -d "$REPO_ROOT/target/container/dist" ]; then
      ( cd "$REPO_ROOT/target/container/dist" && find . -type f | sort | sed 's|^\./|            |' )
    fi
    return 0
  fi

  # Prérequis Windows : obligatoires si la cible est explicite (hors `all` filtré).
  if [ "$has_windows" = "1" ] && ! is_windows_shell && ! windows_prereqs_ok; then
    windows_prereqs_hint >&2
    die "prérequis manquants pour la cible Windows"
  fi

  echo "== Frontend =="
  ( cd "$REPO_ROOT/frontend" && npm run build ) && echo "    build frontend: ${GREEN}OK${NC}" || die "    le build frontend a échoué"

  if echo " $list " | grep -qw rust; then
    echo
    echo "== Rust (release) =="
    ( cd "$REPO_ROOT" && cargo build --release -p typst-ide-app ) && echo "    build Rust: ${GREEN}OK${NC}" || die "    le build Rust a échoué"
  fi

  local -a tauri=()
  if [ -n "$native_bundles" ] || [ "$has_windows" = "1" ]; then
    local tauri_str
    tauri_str="$(tauri_cmd)" || die "tauri-cli introuvable. Installation : npm install -g @tauri-apps/cli@2.12.0"
    read -ra tauri <<< "$tauri_str"
  fi

  # --- Groupe natif (host) : appimage/deb/rpm + nsis sur Windows ------------
  if is_windows_shell && [ "$has_windows" = "1" ]; then
    native_bundles="${native_bundles:+$native_bundles,}nsis"
  fi
  if [ -n "$native_bundles" ]; then
    local -a native_target_arg=()
    [ -n "$target" ] && native_target_arg=(--target "$target")
    echo
    echo "== Tauri (${native_bundles}) =="
    ( cd "$REPO_ROOT/crates/app" && NO_STRIP=1 "${tauri[@]}" build --bundles "$native_bundles" "${native_target_arg[@]}" ) \
      || die "    tauri build a échoué"

    if echo ",$native_bundles," | grep -q ',appimage,'; then
      local dir
      dir="$(bundle_dir_for appimage "$target")"
      [ -d "$dir" ] || die "    bundle appimage introuvable: $dir"
      echo
      echo "== AppImage : post-traitement =="
      "$REPO_ROOT/scripts/fix-appimage.sh" --out-dir "$dir" "$dir" || die "    le post-traitement AppImage a échoué"
    fi
  fi

  # --- Groupe Windows (cross depuis Linux) ---------------------------------
  if ! is_windows_shell && [ "$has_windows" = "1" ]; then
    local wt="${target:-$WINDOWS_TARGET}"
    echo
    echo "== Tauri (nsis, $wt) =="
    ( cd "$REPO_ROOT/crates/app" && NO_STRIP=1 "${tauri[@]}" build --bundles nsis --target "$wt" ) \
      || die "    tauri build (Windows) a échoué"
  fi

  # --- Publication dans target/dist/ (linux/ + windows/) --------------------
  local publish_kinds=""
  for b in appimage deb rpm; do
    echo " $list " | grep -qw "$b" && publish_kinds="${publish_kinds:+$publish_kinds,}$b"
  done
  if [ "$has_windows" = "1" ]; then
    publish_kinds="${publish_kinds:+$publish_kinds,}nsis"
    [ "$want_windows" = "1" ] && publish_kinds="${publish_kinds:+$publish_kinds,}portable"
  fi
  if [ -n "$publish_kinds" ]; then
    echo
    echo "== Publication dans target/dist/ =="
    local -a publish_args=(
      --build-root "$REPO_ROOT/target"
      --dist "$REPO_ROOT/target/dist"
      --version "$(tauri_version)"
      --kinds "$publish_kinds"
    )
    if [ -n "$target" ] && ! target_is_windows "$target"; then
      publish_args+=(--native-target "$target")
    fi
    if [ "$has_windows" = "1" ]; then
      local win_pub_target=""
      if is_windows_shell; then
        win_pub_target="$target"                     # vide = target/release natif
      else
        win_pub_target="${target:-$WINDOWS_TARGET}"  # cross (MinGW)
      fi
      [ -n "$win_pub_target" ] && publish_args+=(--windows-target "$win_pub_target")
    fi
    "$REPO_ROOT/scripts/publish-artifacts.sh" "${publish_args[@]}" \
      || die "    la publication des artefacts a échoué"
    echo
    echo "Artefacts : ${BOLD}target/dist/${NC}"
    if [ -d "$REPO_ROOT/target/dist" ]; then
      ( cd "$REPO_ROOT/target/dist" && find . -type f | sort | sed 's|^\./|            |' )
    fi
  fi
}

# Rejoue scripts/fix-appimage.sh sur le dernier bundle (ou sur un chemin donné).
cmd_fix_appimage() {
  "$REPO_ROOT/scripts/fix-appimage.sh" "$@"
}

# ---------------------
# Clean
# ---------------------

# Taille lisible depuis des Ko.
human_size() {
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --from-unit=1024 --to=iec "$1"
  else
    printf '%s K\n' "$1"
  fi
}

cmd_clean() {
  local dry_run=0 assume_yes=0 with_dist=0 host_caches=0
  local -a requested=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run)     dry_run=1; shift ;;
      --yes|-y)      assume_yes=1; shift ;;
      --with-dist)   with_dist=1; shift ;;
      --host-caches) host_caches=1; shift ;;
      -h|--help)     usage; return 0 ;;
      -*)            die "option inconnue: $1 (voir manage.sh help)" ;;
      *)             requested+=("$1"); shift ;;
    esac
  done

  local list=""
  add_clean() { case " $list " in *" $1 "*) ;; *) list="${list:+$list }$1" ;; esac; }
  local t
  if [ "${#requested[@]}" -eq 0 ]; then
    add_clean build
  else
    for t in "${requested[@]}"; do
      case "$t" in
        build|cache|dist|image) add_clean "$t" ;;
        all) add_clean build; add_clean cache; add_clean image ;;
        *) die "cible clean inconnue: $t (attendu: build|cache|dist|image|all)" ;;
      esac
    done
  fi
  [ "$with_dist" = 1 ] && add_clean dist

  # Chemins à supprimer (dist est protégé sauf demande explicite).
  local -a paths=()
  if echo " $list " | grep -qw build; then
    paths+=(
      "$REPO_ROOT/target/debug"
      "$REPO_ROOT/target/release"
      "$REPO_ROOT/target/container/release"
      "$REPO_ROOT/target/container/x86_64-pc-windows-msvc"
    )
    # Autres triples (x86_64-pc-windows-gnu, x86_64-unknown-linux-gnu…).
    while IFS= read -r d; do
      paths+=("$d")
    done < <(find "$REPO_ROOT/target" -maxdepth 1 -mindepth 1 -type d -name '*-*' 2>/dev/null || true)
  fi
  if echo " $list " | grep -qw cache; then
    paths+=("$REPO_ROOT/target/container/cache")
    [ "$host_caches" = "1" ] && paths+=("${HOME:-/tmp}/.cache/tauri")
  fi
  if echo " $list " | grep -qw dist; then
    paths+=("$REPO_ROOT/target/dist" "$REPO_ROOT/target/container/dist")
  fi

  local clean_image=0
  echo " $list " | grep -qw image && clean_image=1

  echo "Nettoyage : ${BOLD}$list${NC}"
  echo

  # Inventaire (une seule passe du/ taille par chemin).
  local -a existing=()
  local total_kb=0
  local p size_kb
  for p in "${paths[@]}"; do
    [ -e "$p" ] || continue
    case "$p" in
      "$REPO_ROOT"/target/*) ;;
      "${HOME:-/tmp}/.cache/tauri") ;;
      *) die "refus de supprimer hors de target/ : $p" ;;
    esac
    size_kb="$(du -sk "$p" 2>/dev/null | cut -f1)"
    [ -n "$size_kb" ] || size_kb=0
    existing+=("$p")
    total_kb=$((total_kb + size_kb))
    printf "    %8s  %s\n" "$(human_size "$size_kb")" "${p#"$REPO_ROOT"/}"
  done

  if [ "$clean_image" = "1" ]; then
    local runtime
    runtime="$(container_runtime)" || runtime=""
    if [ -z "$runtime" ]; then
      echo "    ${YELLOW}podman/docker absent : image ignorée${NC}"
    else
      printf "    %8s  %s\n" "?" "$runtime : typst-ide-build + images orphelines + cache de build"
    fi
  fi

  if [ "${#existing[@]}" -eq 0 ] && [ "$clean_image" = "0" ]; then
    echo "    (rien à nettoyer)"
    return 0
  fi

  echo
  local image_suffix=""
  [ "$clean_image" = "1" ] && image_suffix=" + image conteneur"
  echo "    ${BOLD}Total : $(human_size "$total_kb")${image_suffix}${NC}"
  if [ "$dry_run" = "1" ]; then
    echo "    (dry-run : rien n'a été supprimé)"
    return 0
  fi

  if [ "$assume_yes" != "1" ]; then
    printf "    Supprimer ? [y/N] "
    local answer=""
    read -r answer || true
    case "$answer" in
      y|Y|yes|YES) ;;
      *) echo "    annulé"; return 0 ;;
    esac
  fi

  for p in "${existing[@]}"; do
    rm -rf "$p"
    echo "    ${GREEN}OK${NC} ${p#"$REPO_ROOT"/}"
  done

  if [ "$clean_image" = "1" ]; then
    local runtime
    runtime="$(container_runtime)" || runtime=""
    if [ -n "$runtime" ]; then
      "$runtime" rmi -f typst-ide-build:ubuntu22.04 >/dev/null 2>&1 || true
      "$runtime" image prune -f >/dev/null 2>&1 || true
      "$runtime" builder prune -f >/dev/null 2>&1 || true
      echo "    ${GREEN}OK${NC} $runtime : image typst-ide-build + orphelines + cache de build"
    fi
  fi

  echo
  echo "Terminé. Les artefacts de ${BOLD}target/dist/${NC} et ${BOLD}target/container/dist/${NC} sont conservés."
  echo "Les prochains builds recompileront (et retéléchargeront ce qui a été supprimé)."
}

cmd_dev() {
  command -v cargo >/dev/null 2>&1 || die "cargo introuvable"
  if ! command -v tauri >/dev/null 2>&1 && ! cargo tauri --version >/dev/null 2>&1; then
    die "tauri-cli introuvable. Installation : cargo install tauri-cli --locked"
  fi
  ( cd "$REPO_ROOT/crates/app" && cargo tauri dev ) || die "tauri dev a échoué"
}

# ---------------------
# Flatpak
# ---------------------

flatpak_ready() {
  command -v flatpak >/dev/null 2>&1 || die "flatpak introuvable (Fedora : sudo dnf install flatpak ; Arch : pacman -S flatpak)"
}

flatpak_has() {
  flatpak info --user "$1" >/dev/null 2>&1
}

# Installe org.flatpak.Builder + runtime/SDK/extensions si absents (installation user).
# Les branches (GNOME 51, extensions 26.08) sont déclarées en tête de fichier et
# doivent suivre le runtime du manifeste.
flatpak_setup() {
  flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo >/dev/null 2>&1 || true
  local missing=0
  for ref in "$FLATPAK_BUILDER_APP" "$FLATPAK_RUNTIME" "$FLATPAK_SDK" "$FLATPAK_RUST_EXT" "$FLATPAK_NODE_EXT"; do
    if flatpak_has "$ref"; then
      echo "    présent : $ref"
    else
      echo "    manque  : $ref"
      missing=1
    fi
  done
  [ "$missing" = "0" ] && return 0
  echo "==> Installation (plusieurs Go au premier lancement)..."
  flatpak install --user -y flathub "$FLATPAK_BUILDER_APP" "$FLATPAK_RUNTIME" "$FLATPAK_SDK" "$FLATPAK_RUST_EXT" "$FLATPAK_NODE_EXT" \
    || die "l'installation des runtimes Flatpak a échoué"
}

# contournement d'un bug du linter : il supprime un linter.log qui peut ne pas
# exister dans le home sandboxé de org.flatpak.Builder
flatpak_lint_fix() {
  local log_dir="$HOME/.var/app/$FLATPAK_BUILDER_APP/.local/state/flatpak_builder_lint"
  mkdir -p "$log_dir"
  touch "$log_dir/linter.log"
}

cmd_flatpak_sources() {
  require_file "$LOCKFILE" "$FRONTEND_LOCK" "$FLATPAK_MANIFEST"
  command -v python3 >/dev/null 2>&1 || die "python3 introuvable"
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || die "node/npm introuvables"

  local tools="$REPO_ROOT/.flatpak-builder/tools"
  local venv="$tools/venv"
  local fbt="$tools/flatpak-builder-tools"

  echo "==> flatpak-cargo-generator (Cargo.lock -> flatpak/cargo-sources.json)"
  if [ ! -x "$venv/bin/python" ]; then
    python3 -m venv "$venv" \
      || die "python3 -m venv a échoué : installe python-venv (ou utilise un conteneur python:3.12-slim, voir docs/flatpak.md)"
  fi
  if [ ! -f "$fbt/cargo/flatpak-cargo-generator.py" ]; then
    git clone --depth 1 https://github.com/flatpak/flatpak-builder-tools.git "$fbt" \
      || die "clone de flatpak-builder-tools a échoué"
  fi
  "$venv/bin/pip" install -q 'aiohttp<4.0.0,>=3.9.5' 'PyYAML<7.0.0,>=6.0.2' 'tomlkit>=0.13.3,<1.0' \
    || die "pip install des dépendances a échoué"
  "$venv/bin/python" "$fbt/cargo/flatpak-cargo-generator.py" -o "$REPO_ROOT/flatpak/cargo-sources.json" "$LOCKFILE" \
    || die "flatpak-cargo-generator a échoué"
  echo "    ${GREEN}OK${NC} flatpak/cargo-sources.json"

  echo "==> flatpak-node-generator (frontend/package-lock.json -> flatpak/node-sources.json)"
  # paquet Python du dépôt flatpak-builder-tools, installé dans le même venv
  if [ ! -x "$venv/bin/flatpak-node-generator" ]; then
    "$venv/bin/pip" install -q "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node" \
      || die "pip install flatpak-node-generator a échoué"
  fi
  # IMPORTANT : générer depuis un arbre SANS node_modules (bug flatpak-builder-tools#377 :
  # des paquets présents localement seraient traités comme « locaux » et absents du cache).
  local clean
  clean="$(mktemp -d)"
  trap 'rm -rf "$clean"' RETURN
  cp "$FRONTEND_PKG" "$FRONTEND_LOCK" "$clean/"
  "$venv/bin/flatpak-node-generator" --no-requests-cache \
    -o "$REPO_ROOT/flatpak/node-sources.json" npm "$clean/package-lock.json" \
    || die "flatpak-node-generator a échoué"
  echo "    ${GREEN}OK${NC} flatpak/node-sources.json"
}

cmd_flatpak_build() {
  flatpak_ready
  require_file "$FLATPAK_MANIFEST"
  flatpak_setup

  echo "==> Build + install (org.flatpak.Builder, cache .flatpak-builder)"
  ( cd "$REPO_ROOT" && flatpak run --command=flathub-build "$FLATPAK_BUILDER_APP" --install "$FLATPAK_MANIFEST" ) \
    || die "le build Flatpak a échoué"

  echo "==> flatpak-builder-lint manifest"
  ( cd "$REPO_ROOT" && flatpak run --command=flatpak-builder-lint "$FLATPAK_BUILDER_APP" manifest "$FLATPAK_MANIFEST" ) \
    || die "lint manifest : erreurs à corriger"

  echo "==> flatpak-builder-lint repo"
  flatpak_lint_fix
  ( cd "$REPO_ROOT" && flatpak run --command=flatpak-builder-lint "$FLATPAK_BUILDER_APP" repo "$REPO_ROOT/repo" ) \
    || die "lint repo : erreurs à corriger"

  echo
  echo "${GREEN}Flatpak : build et lints OK.${NC} Lancez avec : ./manage.sh flatpak-run"
}

cmd_flatpak_run() {
  flatpak_ready
  flatpak_has "$FLATPAK_APP_ID" || die "l'app n'est pas installée : lancez ./manage.sh flatpak-build"
  exec flatpak run "$FLATPAK_APP_ID" "$@"
}

cmd_flatpak_bump() {
  [ $# -eq 1 ] || die "usage: manage.sh flatpak-bump <tag>"
  local tag="$1" commit
  require_file "$FLATPAK_MANIFEST"

  echo "$tag" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$' || die "format de tag attendu : vX.Y.Z"
  commit="$(git -C "$REPO_ROOT" rev-parse "$tag^{commit}" 2>/dev/null)" \
    || die "tag introuvable : $tag"

  sed -i "s|^        tag: .*|        tag: $tag|" "$FLATPAK_MANIFEST"
  sed -i "s|^        commit: .*|        commit: $commit|" "$FLATPAK_MANIFEST"

  echo "    ${GREEN}OK${NC} $(basename "$FLATPAK_MANIFEST") -> tag $tag, commit $commit"
  echo
  echo "Faites un dernier point sur le metainfo (entrée <release>, screenshots), puis :"
  echo "    git add flatpak/ && git commit && git push"
  echo "Note : l'entrée <release> du metainfo est mise à jour par 'manage.sh bump' (avant le tag)."
}

# ---------------------
# Dispatch
# ---------------------

cmd="${1:-help}"
shift || true

case "$cmd" in
  info)    cmd_info ;;
  bump)    cmd_bump "$@" ;;
  check)   cmd_check ;;
  test)    cmd_test ;;
  build)   cmd_build "$@" ;;
  fix-appimage) cmd_fix_appimage "$@" ;;
  flatpak-sources) cmd_flatpak_sources ;;
  flatpak-build)   cmd_flatpak_build ;;
  flatpak-run)     cmd_flatpak_run "$@" ;;
  flatpak-bump)    cmd_flatpak_bump "$@" ;;
  clean)   cmd_clean "$@" ;;
  dev)     cmd_dev ;;
  help|-h|--help) usage ;;
  *) die "commande inconnue: $cmd"; usage ;;
esac
