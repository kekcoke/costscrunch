#!/bin/bash
# Read the worktree name/metadata from stdin if provided by Claude, or derive path
INPUT=$(cat)
WORKTREE_DIR=$(echo "$INPUT" | jq -r '.path')
ROOT_DIR=$(pwd)


# Symlink your massive shared workspace configs or node_modules instead of copying
ln -s "$ROOT_DIR/.env.shared" "$WORKTREE_DIR/.env.dev"
ln -s "$ROOT_DIR/tsconfig.base.json" "$WORKTREE_DIR/tsconfig.base.json"