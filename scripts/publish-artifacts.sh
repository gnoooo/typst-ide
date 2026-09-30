#!/usr/bin/env bash
# =============================================================================
# publish-artifacts.sh — collect the build outputs into a single, tidy
# artifacts directory.
#
#   dist/
#   ├── linux/    AppImage (+ .zsync), .deb, .rpm
#   └── windows/  NSIS installer, portable .exe (+ WebView2Loader.dll for
#                 MinGW builds)
#
# Only the requested kinds are refreshed (so building one bundle does not wipe
# the others), and old files of the same kind are removed first so stale
# versions never linger.
#
# Usage:
#   scripts/publish-artifacts.sh --build-root DIR --dist DIR --version V \
#       --kinds appimage,deb,rpm,nsis,portable \
#       [--native-target TRIPLE] [--windows-target TRIPLE]
#
#   --build-root      cargo target directory (e.g. target or target/container)
#   --dist            destination directory (e.g. target/dist)
#   --version         project version, used for the portable exe name
#   --kinds           comma/space separated: appimage, deb, rpm, nsis, portable
#   --native-target   Rust triple used for the native bundles (optional; when
#                     absent the host triple output under BUILD_ROOT/release is
#                     used)
#   --windows-target  Rust triple used for the Windows build (optional; when
#                     absent BUILD_ROOT/release is used)
# =============================================================================

set -euo pipefail

die() { echo "publish-artifacts: $*" >&2; exit 1; }
info() { echo "publish-artifacts: $*"; }

usage() {
  sed -n '2,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

BUILD_ROOT=""
DIST=""
VERSION=""
KINDS=""
NATIVE_TARGET=""
WINDOWS_TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --build-root)     BUILD_ROOT="${2:-}"; [ -n "$BUILD_ROOT" ] || die "--build-root needs a value"; shift 2 ;;
    --dist)           DIST="${2:-}"; [ -n "$DIST" ] || die "--dist needs a value"; shift 2 ;;
    --version)        VERSION="${2:-}"; [ -n "$VERSION" ] || die "--version needs a value"; shift 2 ;;
    --kinds)          KINDS="${2:-}"; [ -n "$KINDS" ] || die "--kinds needs a value"; shift 2 ;;
    --native-target)  NATIVE_TARGET="${2:-}"; shift 2 ;;
    --windows-target) WINDOWS_TARGET="${2:-}"; shift 2 ;;
    -h|--help)        usage; exit 0 ;;
    *)                die "unknown option: $1 (see --help)" ;;
  esac
done

[ -n "$BUILD_ROOT" ] || die "--build-root is required"
[ -n "$DIST" ] || die "--dist is required"
[ -n "$VERSION" ] || die "--version is required"
[ -n "$KINDS" ] || die "--kinds is required"

# Spaces or commas are both accepted.
KINDS="${KINDS//,/ }"
for kind in $KINDS; do
  case "$kind" in
    appimage|deb|rpm|nsis|portable) ;;
    *) die "unknown kind: $kind (expected: appimage deb rpm nsis portable)" ;;
  esac
done

NATIVE_BUNDLE="$BUILD_ROOT"
[ -n "$NATIVE_TARGET" ] && NATIVE_BUNDLE="$NATIVE_BUNDLE/$NATIVE_TARGET"
NATIVE_BUNDLE="$NATIVE_BUNDLE/release/bundle"

WIN_RELEASE="$BUILD_ROOT"
[ -n "$WINDOWS_TARGET" ] && WIN_RELEASE="$WIN_RELEASE/$WINDOWS_TARGET"
WIN_RELEASE="$WIN_RELEASE/release"

mkdir -p "$DIST/linux" "$DIST/windows"

has_kind() { case " $KINDS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Copies the files matching the given find patterns from SRC into DEST.
# copy_kind SRC DEST LABEL "find-name-expression..."
copy_kind() {
  local src="$1" dest="$2" label="$3"
  shift 3
  local -a files=()
  mapfile -t files < <(find "$src" -maxdepth 1 -type f \( "$@" \) 2>/dev/null | sort)
  [ "${#files[@]}" -gt 0 ] || die "no $label file found in $src"
  local f
  for f in "${files[@]}"; do
    cp -f "$f" "$dest/"
  done
  info "$label: ${#files[@]} file(s) -> $dest"
}

# --- Linux -------------------------------------------------------------------
if has_kind appimage; then
  rm -f "$DIST/linux"/*.AppImage "$DIST/linux"/*.AppImage.zsync
  copy_kind "$NATIVE_BUNDLE/appimage" "$DIST/linux" appimage -name '*.AppImage' -o -name '*.AppImage.zsync'
fi
if has_kind deb; then
  rm -f "$DIST/linux"/*.deb
  copy_kind "$NATIVE_BUNDLE/deb" "$DIST/linux" deb -name '*.deb'
fi
if has_kind rpm; then
  rm -f "$DIST/linux"/*.rpm
  copy_kind "$NATIVE_BUNDLE/rpm" "$DIST/linux" rpm -name '*.rpm'
fi

# --- Windows -----------------------------------------------------------------
if has_kind nsis; then
  rm -f "$DIST/windows"/*setup.exe
  copy_kind "$WIN_RELEASE/bundle/nsis" "$DIST/windows" "nsis installer" -name '*setup.exe'
fi
if has_kind portable; then
  exe="$WIN_RELEASE/typst-ide.exe"
  [ -f "$exe" ] || die "windows executable not found: $exe"
  rm -f "$DIST/windows"/*portable.exe "$DIST/windows/WebView2Loader.dll"
  out="$DIST/windows/Typst IDE_${VERSION}_x64-portable.exe"
  cp -f "$exe" "$out"
  dll="$WIN_RELEASE/WebView2Loader.dll"
  if [ -f "$dll" ]; then
    cp -f "$dll" "$DIST/windows/"
    info "portable: $(basename "$out") (+ WebView2Loader.dll)"
  else
    info "portable: $(basename "$out")"
  fi
fi
