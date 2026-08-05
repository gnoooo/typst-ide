#!/usr/bin/env bash
# Install the shared git hooks for this repository (one-time per clone).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/hooks"

for hook in pre-commit pre-push; do
  [ -x "$HOOKS_DIR/$hook" ] || chmod +x "$HOOKS_DIR/$hook"
done

git -C "$REPO_ROOT" config core.hooksPath hooks
echo "git hooks installed: $(git -C "$REPO_ROOT" config core.hooksPath) (in $REPO_ROOT)"