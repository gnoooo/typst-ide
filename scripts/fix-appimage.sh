#!/usr/bin/env bash
# =============================================================================
# fix-appimage.sh — turn the AppImage produced by `tauri build` into a
# conforming AppImage.
#
# What it does, in order:
#   1. locates the `.AppDir` left by Tauri (or extracts an existing .AppImage);
#   2. removes the libraries the AppImage conventions say must come from the
#      host (the pkg2appimage excludelist) and that linuxdeploy misses, today
#      `libwayland-*` (bundled libwayland-client breaks host Mesa/EGL);
#   3. records the bundled WebKitGTK version for the runtime AppRun;
#   4. installs the custom AppRun (see scripts/appimage/AppRun);
#   5. installs AppStream metadata and normalizes the desktop file to
#      `com.typst.ide.desktop`;
#   6. repacks with the official appimagetool, embedding the
#      `gh-releases-zsync` update information, and generates the .zsync file.
#
# Usage:
#   scripts/fix-appimage.sh [options] [BUNDLE_DIR | APPDIR | APPIMAGE]
#
# Options:
#   --version VERSION   version to use for the output name (default: read from
#                       crates/app/tauri.conf.json)
#   --out-dir DIR       where to write the fixed AppImage (default: the input's
#                       directory)
#   -h, --help          show this help
#
# Environment:
#   APPIMAGETOOL           path to an appimagetool AppImage (skips download)
#   TYPST_IDE_APPIMAGETOOL_URL  download URL override
#   TYPST_IDE_UPDATE_INFO  update information override
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APPIMAGE_NAME="typst-ide"
DEFAULT_APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
DEFAULT_UPDATE_INFO="gh-releases-zsync|gnoooo|typst-ide|latest|typst-ide-*-x86_64.AppImage.zsync"

VERSION=""
OUT_DIR=""
INPUT=""
TMP_DIR=""

die() { echo "fix-appimage: $*" >&2; exit 1; }
info() { echo "fix-appimage: $*"; }

cleanup() {
  [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR"
  return 0
}
trap cleanup EXIT

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
}

# -----------------------------------------------------------------------------
# Arguments
# -----------------------------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --version)  VERSION="${2:-}"; [ -n "$VERSION" ] || die "--version needs a value"; shift 2 ;;
    --out-dir)  OUT_DIR="${2:-}"; [ -n "$OUT_DIR" ] || die "--out-dir needs a value"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    -*)         die "unknown option: $1 (see --help)" ;;
    *)          [ -z "$INPUT" ] || die "too many arguments: $1"; INPUT="$1"; shift ;;
  esac
done

# -----------------------------------------------------------------------------
# Locate the bundle directory (when no input is given)
# -----------------------------------------------------------------------------

find_default_bundle_dir() {
  local dir
  for dir in \
    "$REPO_ROOT/target/release/bundle/appimage" \
    "$REPO_ROOT"/target/*/release/bundle/appimage
  do
    [ -d "$dir" ] && { printf '%s\n' "$dir"; return 0; }
  done
  return 1
}

if [ -z "$INPUT" ]; then
  INPUT="$(find_default_bundle_dir)" || die "no bundle/appimage directory found under target/; pass a path explicitly"
  info "using default bundle directory: $INPUT"
fi

# -----------------------------------------------------------------------------
# Resolve the input into an AppDir
# -----------------------------------------------------------------------------

DEFAULT_OUT_DIR=""
APPDIR=""

if [ -d "$INPUT" ]; then
  if [ -d "$INPUT/usr" ] && [ -e "$INPUT/AppRun" ]; then
    APPDIR="$(cd "$INPUT" && pwd)"
    DEFAULT_OUT_DIR="$(dirname "$APPDIR")"
  else
    DEFAULT_OUT_DIR="$(cd "$INPUT" && pwd)"
    APPDIR="$(find "$INPUT" -maxdepth 1 -mindepth 1 -type d -name '*.AppDir' | head -n 1 || true)"
    [ -n "$APPDIR" ] || die "no .AppDir found in $INPUT (build the appimage bundle first: tauri build --bundles appimage)"
  fi
elif [ -f "$INPUT" ]; then
  [ -x "$INPUT" ] || die "not executable: $INPUT"
  DEFAULT_OUT_DIR="$(cd "$(dirname "$INPUT")" && pwd)"
  TMP_DIR="$(mktemp -d)"
  info "extracting $(basename "$INPUT")..."
  ( cd "$TMP_DIR" && "$INPUT" --appimage-extract >/dev/null )
  APPDIR="$TMP_DIR/squashfs-root"
  [ -d "$APPDIR" ] || die "extraction failed"
else
  die "input not found: $INPUT"
fi

OUT_DIR="${OUT_DIR:-$DEFAULT_OUT_DIR}"

# -----------------------------------------------------------------------------
# Version
# -----------------------------------------------------------------------------

if [ -z "$VERSION" ]; then
  TAURI_CONF="$REPO_ROOT/crates/app/tauri.conf.json"
  if [ -f "$TAURI_CONF" ]; then
    VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TAURI_CONF" | head -n 1)"
  fi
fi
if [ -z "$VERSION" ] && [ -f "$INPUT" ]; then
  VERSION="$(basename "$INPUT" | sed -n 's/^[^_]*_\([^_]*\)_.*$/\1/p')"
fi
[ -n "$VERSION" ] || die "cannot determine the version; use --version"

OUT="$OUT_DIR/${APPIMAGE_NAME}-${VERSION}-x86_64.AppImage"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || info "warning: unusual version string '$VERSION'"

info "AppDir : $APPDIR"
info "version: $VERSION"

# -----------------------------------------------------------------------------
# 1. Sanity checks
# -----------------------------------------------------------------------------

BIN="$APPDIR/usr/bin/typst-ide"
[ -x "$BIN" ] || die "application binary not found: usr/bin/typst-ide (unexpected AppDir layout)"
[ -e "$APPDIR/.DirIcon" ] || die ".DirIcon is missing (invalid AppDir)"

# A previous run must never get packed into the next one.
find "$APPDIR" -maxdepth 1 -name '*.AppImage' -delete 2>/dev/null || true

# -----------------------------------------------------------------------------
# 2. Remove libraries that must come from the host
# -----------------------------------------------------------------------------

info "removing host-owned libraries from the bundle:"
for pattern in 'libwayland-client.so*' 'libwayland-cursor.so*' 'libwayland-egl.so*' 'libwayland-server.so*'; do
  while IFS= read -r lib; do
    [ -n "$lib" ] || continue
    echo "  - ${lib#"$APPDIR"/}"
  done < <(find "$APPDIR/usr" -name "$pattern" 2>/dev/null || true)
  find "$APPDIR/usr" -name "$pattern" -delete 2>/dev/null || true
done

# -----------------------------------------------------------------------------
# 3. Record the bundled WebKitGTK version (used by the runtime AppRun)
# -----------------------------------------------------------------------------

BUNDLED_WEBKIT="$(pkg-config --modversion webkit2gtk-4.1 2>/dev/null || true)"
if [ -z "$BUNDLED_WEBKIT" ]; then
  BUNDLED_WEBKIT="0.0"
  info "warning: pkg-config could not report the WebKitGTK version"
fi
printf '%s\n' "$BUNDLED_WEBKIT" > "$APPDIR/.bundled-webkitgtk-version"
info "bundled WebKitGTK version: $BUNDLED_WEBKIT"

# -----------------------------------------------------------------------------
# 4. Custom AppRun
# -----------------------------------------------------------------------------

install -m 0755 "$SCRIPT_DIR/appimage/AppRun" "$APPDIR/AppRun"
rm -rf "$APPDIR/AppRun.wrapped" "$APPDIR/apprun-hooks"

# -----------------------------------------------------------------------------
# 5. AppStream metadata + desktop file
# -----------------------------------------------------------------------------

APPS_DIR="$APPDIR/usr/share/applications"
mapfile -t DESKTOPS < <(find "$APPS_DIR" -maxdepth 1 -name '*.desktop' 2>/dev/null || true)
[ "${#DESKTOPS[@]}" -eq 1 ] || die "expected exactly one .desktop file in usr/share/applications, found ${#DESKTOPS[@]}"

DESKTOP_NAME="com.typst.ide.desktop"
if [ "${DESKTOPS[0]}" != "$APPS_DIR/$DESKTOP_NAME" ]; then
  mv "${DESKTOPS[0]}" "$APPS_DIR/$DESKTOP_NAME"
fi

# Exactly one desktop entry at the AppDir root, as a relative symlink.
find "$APPDIR" -maxdepth 1 -name '*.desktop' -exec rm -f {} +
ln -s "usr/share/applications/$DESKTOP_NAME" "$APPDIR/$DESKTOP_NAME"

mkdir -p "$APPDIR/usr/share/metainfo"
if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then
  BUILD_DATE="$(date -u -d "@$SOURCE_DATE_EPOCH" +%F 2>/dev/null || date -u +%F)"
else
  BUILD_DATE="$(date -u +%F)"
fi
sed -e "s/@VERSION@/$VERSION/" -e "s/@DATE@/$BUILD_DATE/" \
  "$SCRIPT_DIR/appimage/com.typst.ide.appdata.xml" \
  > "$APPDIR/usr/share/metainfo/com.typst.ide.appdata.xml"

if command -v desktop-file-validate >/dev/null 2>&1; then
  if desktop-file-validate "$APPS_DIR/$DESKTOP_NAME"; then
    info "desktop-file-validate: OK"
  else
    info "warning: desktop-file-validate reported issues (see above)"
  fi
fi

# -----------------------------------------------------------------------------
# 6. Repack with appimagetool
# -----------------------------------------------------------------------------

if [ -n "${APPIMAGETOOL:-}" ] && [ -x "$APPIMAGETOOL" ]; then
  TOOL="$APPIMAGETOOL"
else
  CACHE_DIR="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/typst-ide"
  mkdir -p "$CACHE_DIR"
  TOOL="$CACHE_DIR/appimagetool-x86_64.AppImage"
  if [ ! -x "$TOOL" ]; then
    info "downloading appimagetool..."
    curl -fL --retry 3 -o "$TOOL" "${TYPST_IDE_APPIMAGETOOL_URL:-$DEFAULT_APPIMAGETOOL_URL}" \
      || die "failed to download appimagetool (set APPIMAGETOOL to use a local copy)"
    chmod +x "$TOOL"
  fi
fi

UPDATE_INFO="${TYPST_IDE_UPDATE_INFO:-$DEFAULT_UPDATE_INFO}"
mkdir -p "$OUT_DIR"

# Snapshot the stock AppImage(s) already present so only those are removed
# after a successful repack (never touch unrelated files in OUT_DIR).
PRE_EXISTING=()
while IFS= read -r -d '' file; do
  PRE_EXISTING+=("$file")
done < <(find "$OUT_DIR" -maxdepth 1 \( -name '*.AppImage' -o -name '*.AppImage.zsync' \) \
           ! -name "$(basename "$OUT")" ! -name "$(basename "$OUT").zsync" -print0 2>/dev/null || true)

info "repacking with appimagetool..."
rm -f "$OUT" "$OUT.zsync"
# appimagetool writes the .zsync into the current directory: run it from OUT_DIR.
APPT_LOG="$TMP_DIR/appimagetool.log"
[ -n "$TMP_DIR" ] || APPT_LOG="$(mktemp)"
if ! ( cd "$OUT_DIR" && ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" -u "$UPDATE_INFO" "$APPDIR" "$OUT" ) >"$APPT_LOG" 2>&1; then
  cat "$APPT_LOG" >&2
  rm -f "$APPT_LOG"
  die "appimagetool failed (see output above)"
fi
rm -f "$APPT_LOG"

for file in "${PRE_EXISTING[@]+"${PRE_EXISTING[@]}"}"; do
  rm -f "$file"
done

[ -f "$OUT" ] || die "appimagetool did not produce $OUT"

info "AppImage : $OUT"
if [ -f "$OUT.zsync" ]; then
  info "zsync    : $OUT.zsync"
else
  info "warning: no .zsync generated (install 'zsync' for AppImageUpdate support)"
fi
