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
# Environment (set by manage.sh):
#   BUNDLES  space-separated list (appimage deb rpm nsis windows)
#   TARGET   optional Rust target triple (--target)
#   CARGO_HOME, CARGO_TARGET_DIR, npm_config_cache, XDG_CACHE_HOME
# =============================================================================
set -euo pipefail

REPO_ROOT="/work"
BUNDLES="${BUNDLES:-appimage}"
TARGET="${TARGET:-}"

# manage.sh passes a space-separated list; tauri expects commas.
BUNDLES="${BUNDLES// /,}"

export CARGO_HOME="${CARGO_HOME:-$REPO_ROOT/target/container/cargo-home}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/target/container}"
export npm_config_cache="${npm_config_cache:-$REPO_ROOT/target/container/npm-cache}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$REPO_ROOT/target/container/cache}"
export NO_STRIP=1

# Windows SDK/CRT downloaded by cargo-xwin, persistent across runs.
export XWIN_CACHE_DIR="${XWIN_CACHE_DIR:-$CARGO_TARGET_DIR/xwin}"
# Keep temporary files on the same filesystem as the target directory:
# the NSIS bundler otherwise fails with "Invalid cross-device link"
# (tauri-apps/tauri#10647).
export TMPDIR="${TMPDIR:-$CARGO_TARGET_DIR/tmp}"
mkdir -p "$XWIN_CACHE_DIR" "$TMPDIR"

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
  WIN_TARGET="$TARGET"
  case "$WIN_TARGET" in
    *windows*) ;;
    *) WIN_TARGET="x86_64-pc-windows-msvc" ;;
  esac

  echo "== tauri build (nsis, $WIN_TARGET via cargo-xwin) =="
  (
    cd crates/app
    tauri build --bundles nsis --runner cargo-xwin --target "$WIN_TARGET"
  )

  if [ "$PORTABLE" = 1 ]; then
    VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$REPO_ROOT/crates/app/tauri.conf.json" | head -n 1)"
    WIN_BASE="$CARGO_TARGET_DIR/$WIN_TARGET/release"
    EXE="$WIN_BASE/typst-ide.exe"
    OUT="$WIN_BASE/Typst IDE_${VERSION}_x64-portable.exe"
    [ -f "$EXE" ] || { echo "in-container: $EXE not found" >&2; exit 1; }
    cp -f "$EXE" "$OUT"
    echo "portable : $OUT"
  fi
fi
