#!/bin/bash

# ===================================================================================================
# manage.sh : manager de projet pour Typst IDE (Rust + Tauri + frontend)

# Usage:
#   ./manage.sh info                      Infos du projet (nom, version, cohérence, git…)
#   ./manage.sh bump <version|type>       Met à jour la version partout (--dry-run dispo)
#   ./manage.sh check                     Cohérence des versions + cargo fmt/check
#   ./manage.sh test                      Tests du workspace
#   ./manage.sh build [cibles] [opts]     Build frontend + bundles Tauri
#                                           cibles   : frontend | rust | appimage | deb | rpm | nsis | all (défaut)
#                                           options  : --target <triple>           cross-compilation (ex. x86_64-unknown-linux-gnu)
#                                                      --container                 build release dans un conteneur ubuntu:22.04
#                                                      --container-image <image>   image de base (défaut : ubuntu:22.04)
#                                                      --container-rebuild         reconstruit l'image de build sans cache
#   ./manage.sh fix-appimage [chemin]     Rejoue le post-traitement AppImage (docs/appimage.md)
#   ./manage.sh dev                       Lance tauri dev
#   ./manage.sh help                      Cette aide

# Exemples:
#   ./manage.sh build                            # frontend + appimage + deb + rpm
#   ./manage.sh build appimage                   # seulement l'AppImage (post-traitée)
#   ./manage.sh build appimage,deb,rpm           # plusieurs cibles
#   ./manage.sh build appimage --container       # équivalent de la CI (ubuntu:22.04)
#   ./manage.sh build rust                       # ancien comportement (frontend + cargo release)
# ===================================================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_CRATE="$REPO_ROOT/crates/app/Cargo.toml"
TAURI_CONF="$REPO_ROOT/crates/app/tauri.conf.json"
PKGBUILD="$REPO_ROOT/PKGBUILD"
LOCKFILE="$REPO_ROOT/Cargo.lock"
FRONTEND_PKG="$REPO_ROOT/frontend/package.json"
FRONTEND_LOCK="$REPO_ROOT/frontend/package-lock.json"

SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'

# ---------------------
# Helpers
# ---------------------
usage() {
    sed -n '4,26p' "$0" | sed 's/^# \{0,1\}//'
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

# --- Cohérence ---

# vérifie la cohérence des fichiers de version (Cargo.toml, tauri.conf.json, PKGBUILD, Cargo.lock : les 3 premiers comme le hook pre-push).
# le frontend est affiché et synchronisé par `bump`, mais ne bloque jamais.
# retourne 0 si cohérent, 1 sinon. Sortie optionnelle avec `--pretty`.
check_consistency() {
  local pretty=0
  [ "${1:-}" = "--pretty" ] && pretty=1

  local app tauri pkgbuild lock front
  app="$(app_version)"
  tauri="$(tauri_version)"
  pkgbuild="$(pkgbuild_version)"
  lock="$(lock_version)"
  front="$(frontend_version)"

  local ok=1
  [ -n "$app" ]      || ok=0
  [ "$app" = "$tauri" ]    || ok=0
  [ "$app" = "$pkgbuild" ] || ok=0
  [ "$app" = "$lock" ]     || ok=0

  if [ "$pretty" = "1" ]; then
    row() {
      local name="$1" val="$2" good="$3"
      if [ "$good" = "1" ]; then
        printf "    %-28s %s %s\n" "$name" "${GREEN}OK${NC}" "$val"
      else
        printf "    %-28s %s %s\n" "$name" "${RED}KO${NC}" "${val:-—}"
      fi
    }
    row "crates/app/Cargo.toml"      "$app"      "$([ -n "$app" ] && echo 1 || echo 0)"
    row "crates/app/tauri.conf.json" "$tauri"    "$([ "$app" = "$tauri" ] && echo 1 || echo 0)"
    row "PKGBUILD (pkgver)"          "$pkgbuild" "$([ "$app" = "$pkgbuild" ] && echo 1 || echo 0)"
    row "Cargo.lock (workspace)"     "$lock"     "$([ "$app" = "$lock" ] && echo 1 || echo 0)"
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
  head_sha="$(git -C "$REPO_ROOT" log -1 --format='%h %s' 2>/dev/null || echo "—")"
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

  require_file "$APP_CRATE" "$TAURI_CONF" "$PKGBUILD" "$LOCKFILE" "$FRONTEND_PKG"

  local old
  old="$(app_version)"

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
    echo "manage: ${YELLOW}attention${NC} : version non purement numérique ('$new_version') — "
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
    echo
    echo "    Vérification attendue : ${GREEN}cohérent${NC}"
    exit 0
  fi

  set_app_version      "$new_version"
  set_tauri_version    "$new_version"
  set_pkgbuild_version "$new_version"
  set_lock_version     "$new_version"
  set_frontend_version "$new_version"

  echo "    ${GREEN}OK${NC} crates/app/Cargo.toml      -> version = \"$new_version\""
  echo "    ${GREEN}OK${NC} crates/app/tauri.conf.json -> \"version\": \"$new_version\""
  echo "    ${GREEN}OK${NC} PKGBUILD                   -> pkgver=$new_version"
  echo "    ${GREEN}OK${NC} Cargo.lock                 -> typst-ide-app $new_version"
  echo "    ${GREEN}OK${NC} frontend/package.json      -> $new_version"
  echo "    ${GREEN}OK${NC} frontend/package-lock.json -> $new_version"

  echo
  if check_consistency; then
    echo "${GREEN}Cohérence des versions : OK${NC}"
  else
    echo "${RED}Cohérence des versions : KO${NC}"
    exit 1
  fi

  echo
  echo "Fichiers modifiés :"
  git -C "$REPO_ROOT" status --short -- crates/app/Cargo.toml crates/app/tauri.conf.json PKGBUILD Cargo.lock frontend/package.json frontend/package-lock.json | sed 's/^/    /'
  echo
  echo "Note : aucun commit ni tag créé. Le hook pre-push vérifiera la cohérence à la prochaine poussée."
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

# Build dans le conteneur de release (voir scripts/build/Containerfile.ubuntu2204
# et docs/appimage.md). Liste et target sont passés par variables d'environnement.
build_in_container() {
  local list="$1" target="$2" image="$3" rebuild="$4"

  local runtime
  runtime="$(container_runtime)" || die "ni podman ni docker n'est installé (requis pour --container)"

  local containerfile="$REPO_ROOT/scripts/build/Containerfile.ubuntu2204"
  require_file "$containerfile"

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
    -e "CARGO_HOME=/work/target/container/cargo-home"
    -e "CARGO_TARGET_DIR=/work/target/container"
    -e "npm_config_cache=/work/target/container/npm-cache"
    -e "XDG_CACHE_HOME=/work/target/container/cache"
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

  # Résolution de `all` selon l'OS + déduplication.
  local list=""
  add_target() { case " $list " in *" $1 "*) ;; *) list="${list:+$list }$1" ;; esac; }
  local t
  for t in "${targets[@]}"; do
    case "$t" in
      all)
        case "$(uname -s)" in
          Linux)                add_target appimage; add_target deb; add_target rpm ;;
          MINGW*|MSYS*|CYGWIN*) add_target nsis ;;
          *)                    die "OS non supporté pour la cible 'all': $(uname -s)" ;;
        esac
        ;;
      frontend|rust|appimage|deb|rpm|nsis) add_target "$t" ;;
      *) die "cible inconnue: $t (attendu: frontend|rust|appimage|deb|rpm|nsis|all)" ;;
    esac
  done

  echo "Cibles : ${BOLD}$list${NC}"
  echo

  if [ "$use_container" = "1" ]; then
    case " $list " in
      *" nsis "*) die "--container ne supporte pas la cible nsis (le bundle Windows est construit par la CI)" ;;
    esac
    build_in_container "$list" "$target" "$image" "$rebuild"
    echo
    local out_base="target/container"
    [ -n "$target" ] && out_base="$out_base/$target"
    echo "Artefacts : ${BOLD}${out_base}/release/bundle/${NC}"
    if echo " $list " | grep -qw appimage; then
      echo "            ${BOLD}${out_base}/release/bundle/appimage/typst-ide-$(tauri_version)-x86_64.AppImage${NC}"
    fi
    return 0
  fi

  echo "== Frontend =="
  ( cd "$REPO_ROOT/frontend" && npm run build ) && echo "    build frontend: ${GREEN}OK${NC}" || die "    le build frontend a échoué"

  if echo " $list " | grep -qw rust; then
    echo
    echo "== Rust (release) =="
    ( cd "$REPO_ROOT" && cargo build --release -p typst-ide-app ) && echo "    build Rust: ${GREEN}OK${NC}" || die "    le build Rust a échoué"
  fi

  # Bundles Tauri demandés (un seul appel tauri build).
  local bundles=""
  for t in appimage deb rpm nsis; do
    echo " $list " | grep -qw "$t" && bundles="${bundles:+$bundles,}$t"
  done

  if [ -n "$bundles" ]; then
    local tauri_str
    tauri_str="$(tauri_cmd)" || die "tauri-cli introuvable. Installation : npm install -g @tauri-apps/cli@2.12.0"
    local -a tauri
    read -ra tauri <<< "$tauri_str"
    local -a args=(build --bundles "$bundles")
    [ -n "$target" ] && args+=(--target "$target")
    echo
    echo "== Tauri ($bundles) =="
    ( cd "$REPO_ROOT/crates/app" && NO_STRIP=1 "${tauri[@]}" "${args[@]}" ) || die "    tauri build a échoué"

    if echo " $list " | grep -qw appimage; then
      local dir
      dir="$(bundle_dir_for appimage "$target")"
      [ -d "$dir" ] || die "    bundle appimage introuvable: $dir"
      echo
      echo "== AppImage : post-traitement =="
      "$REPO_ROOT/scripts/fix-appimage.sh" --out-dir "$dir" "$dir" || die "    le post-traitement AppImage a échoué"
    fi
  fi
}

# Rejoue scripts/fix-appimage.sh sur le dernier bundle (ou sur un chemin donné).
cmd_fix_appimage() {
  "$REPO_ROOT/scripts/fix-appimage.sh" "$@"
}

cmd_dev() {
  command -v cargo >/dev/null 2>&1 || die "cargo introuvable"
  if ! command -v tauri >/dev/null 2>&1 && ! cargo tauri --version >/dev/null 2>&1; then
    die "tauri-cli introuvable. Installation : cargo install tauri-cli --locked"
  fi
  ( cd "$REPO_ROOT/crates/app" && cargo tauri dev ) || die "tauri dev a échoué"
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
  dev)     cmd_dev ;;
  help|-h|--help) usage ;;
  *) die "commande inconnue: $cmd"; usage ;;
esac
