#!/usr/bin/env bash
# Regenerates the demo GIFs and static screenshots inside a disposable
# Ubuntu 24.04 container. Arch Linux does not ship WebKitWebDriver (required
# by tauri-driver), so the whole pipeline runs in the container, which also
# mirrors the tool versions pinned by the project (Rust 1.98.1, Node 20.20.2,
# Tauri CLI 2.12.0).
#
# Usage:
#   cd demo && bash run-container.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$REPO_ROOT/demo"
IMAGE="typst-ide-demo:latest"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required" >&2
    exit 1
fi

docker build -t "$IMAGE" "$DEMO_DIR"

docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "$REPO_ROOT:/work" \
    "$IMAGE" \
    bash /opt/demo/run-in-container.sh
