#!/bin/bash
# run-in-container.sh — executed inside the demo container (see Dockerfile).
# Builds the app, records the demo scenarios and converts them to GIFs and
# static screenshots. The repo is mounted at /work.
set -euo pipefail

export HOME=/tmp/home
mkdir -p /tmp/home /tmp/cargo-home /tmp/npm-global /tmp/npm-cache /tmp/xdg /tmp/xdg-cache

export PATH="/root/.cargo/bin:/tmp/npm-global/bin:/usr/local/bin:$PATH"
export npm_config_prefix=/tmp/npm-global
export npm_config_cache=/tmp/npm-cache
export CARGO_HOME=/tmp/cargo-home
export RUSTUP_HOME=/root/.rustup
export XDG_RUNTIME_DIR=/tmp/xdg
export XDG_CACHE_HOME=/tmp/xdg-cache
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export NO_AT_BRIDGE=1
export DISPLAY=:99

# wdio.conf.js resolves tauri-driver through $HOME/.cargo/bin
mkdir -p /tmp/home/.cargo/bin
ln -sf /root/.cargo/bin/tauri-driver /tmp/home/.cargo/bin/tauri-driver

echo "==> npm install -g tauri CLI"
npm install -g @tauri-apps/cli@2.12.0

# `cargo tauri` resolves the `cargo-tauri` subcommand; the npm package only
# ships the `tauri` bin, so expose a wrapper next to it. Cargo passes the
# subcommand name as the first argument, which the CLI doesn't expect.
cat > /tmp/npm-global/bin/cargo-tauri <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = "tauri" ] && shift
exec node /tmp/npm-global/lib/node_modules/@tauri-apps/cli/tauri.js "$@"
EOF
chmod +x /tmp/npm-global/bin/cargo-tauri

echo "==> frontend npm ci"
(cd /work/frontend && npm ci)

echo "==> demo npm ci"
(cd /work/demo && npm ci)

echo "==> Xvfb"
Xvfb :99 -screen 0 1280x900x24 &
XVFB_PID=$!
sleep 2

echo "==> demo.sh"
cd /work/demo
bash demo.sh

kill "$XVFB_PID" 2>/dev/null || true
