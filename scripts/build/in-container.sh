#!/usr/bin/env bash
# =============================================================================
# in-container.sh — build steps executed inside the release container
# (scripts/build/Containerfile.ubuntu2204).
#
# Driven by `./manage.sh build <targets> --container`; not meant to be run
# directly. See docs/appimage.md.
#
# Environment (set by manage.sh):
#   BUNDLES  comma-separated Tauri bundles (e.g. appimage,deb,rpm)
#   TARGET   optional Rust target triple (--target)
#   CARGO_HOME, CARGO_TARGET_DIR, npm_config_cache
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

cd "$REPO_ROOT"

echo "== frontend =="
(
  cd frontend
  npm ci
  npm run build
)

# `all` is resolved by manage.sh, but stay tolerant if called directly.
case ",$BUNDLES," in
  *,all,*) BUNDLES="appimage,deb,rpm" ;;
esac

echo "== tauri build ($BUNDLES${TARGET:+ --target $TARGET}) =="
TAURI_ARGS=(build --bundles "$BUNDLES")
[ -n "$TARGET" ] && TAURI_ARGS+=(--target "$TARGET")
(
  cd crates/app
  tauri "${TAURI_ARGS[@]}"
)

# Post-process the AppImage so it follows the AppImage conventions.
if echo ",$BUNDLES," | grep -q ',appimage,'; then
  BUNDLE_DIR="$CARGO_TARGET_DIR"
  [ -n "$TARGET" ] && BUNDLE_DIR="$BUNDLE_DIR/$TARGET"
  BUNDLE_DIR="$BUNDLE_DIR/release/bundle/appimage"
  [ -d "$BUNDLE_DIR" ] || { echo "in-container: $BUNDLE_DIR not found" >&2; exit 1; }

  echo "== AppImage : post-traitement =="
  bash "$REPO_ROOT/scripts/fix-appimage.sh" --out-dir "$BUNDLE_DIR" "$BUNDLE_DIR"
fi
