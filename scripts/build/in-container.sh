#!/usr/bin/env bash
# =============================================================================
# in-container.sh — build steps executed inside the release container
# (scripts/build/Containerfile.ubuntu2204).
#
# Driven by `./manage.sh build <targets> --container`; not meant to be run
# directly. See docs/appimage.md and docs/windows-build.md.
#
# Native bundles (appimage/deb/rpm) are built natively; the Windows group
# (nsis/windows) is cross-compiled to the MSVC target with cargo-xwin, so the
# resulting executable is self-contained like the one the CI produces on
# windows-latest (no WebView2Loader.dll).
#
# Layout produced (all caches grouped, final artifacts in dist/):
#   target/container/
#   ├── cache/   cargo-home/ npm-cache/ xwin/ tmp/ tauri/
#   ├── release/ + <triple>/   cargo build outputs
#   └── dist/linux/h  dist/windows/   final artifacts
#
# Environment (set by manage.sh):
#   BUNDLES  space-separated list (appimage deb rpm nsis windows)
#   TARGET   optional Rust target triple (--target)
# =============================================================================
set -euo pipefail

REPO_ROOT="/work"
BUNDLES="${BUNDLES:-appimage}"
TARGET="${TARGET:-}"

# manage.sh passes a space-separated list; tauri expects commas.
BUNDLES="${BUNDLES// /,}"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/target/container}"
# All caches live under <cargo target dir>/cache (manage.sh migrates the old
# layout on the host before starting the container).
export CACHE_DIR="${CACHE_DIR:-$CARGO_TARGET_DIR/cache}"
# Inconditionnel : l'image définit ENV CARGO_HOME=/usr/local/cargo (root-only),
# et le conteneur docker rootful tourne sous l'UID hôte (manage.sh --user) ;
# le repli ${VAR:-} ne s'appliquerait jamais.
export CARGO_HOME="$CACHE_DIR/cargo-home"
export npm_config_cache="${npm_config_cache:-$CACHE_DIR/npm-cache}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$CACHE_DIR}"
# Windows SDK/CRT downloaded by cargo-xwin, persistent across runs.
export XWIN_CACHE_DIR="${XWIN_CACHE_DIR:-$CACHE_DIR/xwin}"
# Keep temporary files on the same filesystem as the target directory:
# the NSIS bundler otherwise fails with "Invalid cross-device link"
# (tauri-apps/tauri#10647).
export TMPDIR="${TMPDIR:-$CACHE_DIR/tmp}"
# Final artifacts (see scripts/publish-artifacts.sh).
export DIST_DIR="${DIST_DIR:-$CARGO_TARGET_DIR/dist}"
export NO_STRIP=1

mkdir -p "$CARGO_HOME" "$npm_config_cache" "$XDG_CACHE_HOME" "$XWIN_CACHE_DIR" "$TMPDIR" "$DIST_DIR"

# TMPDIR ne sert qu'au build en cours : repartir propre évite qu'il ne gonfle.
if [ -n "$TMPDIR" ] && [ "$TMPDIR" != "/" ] && [ -d "$TMPDIR" ]; then
  rm -rf "${TMPDIR:?}"/*
fi

cd "$REPO_ROOT"

echo "== frontend =="
(
  cd frontend
  npm ci
  npm run build
)

# `all` is resolved by manage.sh, but stay tolerant if called directly.
case ",$BUNDLES," in
  *,all,*) BUNDLES="appimage,deb,rpm,windows" ;;
esac

# Split native bundles from the Windows group.
NATIVE=""
for b in appimage deb rpm; do
  echo ",$BUNDLES," | grep -q ",$b," && NATIVE="${NATIVE:+$NATIVE,}$b"
done
WINDOWS=0
PORTABLE=0
if echo ",$BUNDLES," | grep -qE ',(nsis|windows),'; then WINDOWS=1; fi
if echo ",$BUNDLES," | grep -q ',windows,'; then PORTABLE=1; fi

# Windows target triple (defaults to MSVC, the CI-parity target).
WIN_TARGET=""
if [ "$WINDOWS" = 1 ]; then
  WIN_TARGET="$TARGET"
  case "$WIN_TARGET" in
    *windows*) ;;
    *) WIN_TARGET="x86_64-pc-windows-msvc" ;;
  esac
fi

# Native triple for the publish step: only when it is not a Windows target.
NATIVE_TARGET=""
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    *windows*) ;;
    *) NATIVE_TARGET="$TARGET" ;;
  esac
fi

# --- Native bundles ----------------------------------------------------------
if [ -n "$NATIVE" ]; then
  echo "== tauri build ($NATIVE${TARGET:+ --target $TARGET}) =="
  TAURI_ARGS=(build --bundles "$NATIVE")
  [ -n "$TARGET" ] && TAURI_ARGS+=(--target "$TARGET")
  (
    cd crates/app
    tauri "${TAURI_ARGS[@]}"
  )

  # Post-process the AppImage so it follows the AppImage conventions.
  if echo ",$NATIVE," | grep -q ',appimage,'; then
    BUNDLE_DIR="$CARGO_TARGET_DIR"
    [ -n "$TARGET" ] && BUNDLE_DIR="$BUNDLE_DIR/$TARGET"
    BUNDLE_DIR="$BUNDLE_DIR/release/bundle/appimage"
    [ -d "$BUNDLE_DIR" ] || { echo "in-container: $BUNDLE_DIR not found" >&2; exit 1; }

    echo "== AppImage : post-traitement =="
    bash "$REPO_ROOT/scripts/fix-appimage.sh" --out-dir "$BUNDLE_DIR" "$BUNDLE_DIR"
  fi
fi

# --- Windows (MSVC cross via cargo-xwin) -------------------------------------
if [ "$WINDOWS" = 1 ]; then
  echo "== tauri build (nsis, $WIN_TARGET via cargo-xwin) =="
  (
    cd crates/app
    tauri build --bundles nsis --runner cargo-xwin --target "$WIN_TARGET"
  )
fi

# --- Publication dans dist/ --------------------------------------------------
KINDS=""
for b in appimage deb rpm; do
  echo ",$NATIVE," | grep -q ",$b," && KINDS="${KINDS:+$KINDS,}$b"
done
if [ "$WINDOWS" = 1 ]; then
  KINDS="${KINDS:+$KINDS,}nsis"
  [ "$PORTABLE" = 1 ] && KINDS="${KINDS:+$KINDS,}portable"
fi

if [ -n "$KINDS" ]; then
  echo
  echo "== publication dans dist/ =="
  VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$REPO_ROOT/crates/app/tauri.conf.json" | head -n 1)"
  PUBLISH_ARGS=(
    --build-root "$CARGO_TARGET_DIR"
    --dist "$DIST_DIR"
    --version "$VERSION"
    --kinds "$KINDS"
  )
  [ -n "$NATIVE_TARGET" ] && PUBLISH_ARGS+=(--native-target "$NATIVE_TARGET")
  [ -n "$WIN_TARGET" ] && PUBLISH_ARGS+=(--windows-target "$WIN_TARGET")
  bash "$REPO_ROOT/scripts/publish-artifacts.sh" "${PUBLISH_ARGS[@]}"
fi
