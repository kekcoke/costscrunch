#!/bin/bash
# WorktreeCreate hook for Claude Code.
#
# CONTRACT (per docs: https://docs.anthropic.com/en/docs/claude-code/hooks#worktreecreate)
#   • This hook COMPLETELY REPLACES Claude Code's built-in git-worktree creation.
#     It is therefore responsible for the ENTIRE process: creating the worktree
#     AND linking any shared config files that .worktreeinclude would normally copy.
#   • INPUT  (stdin JSON): { name, session_id, hook_event_name, cwd, transcript_path }
#       - `name` is a slug for the new worktree. The payload does NOT carry a path.
#   • OUTPUT: the hook MUST print the resulting ABSOLUTE worktree path to STDOUT
#     as a bare string — Claude Code reads stdout verbatim as the path.
#       => ALL human-readable logging MUST go to STDERR (via log()), never stdout,
#          otherwise the diagnostic text corrupts the returned path.
#   • Any non-zero exit (or a missing/invalid path) fails worktree creation.

set -euo pipefail

# stdout is reserved exclusively for the final worktree path; everything else → stderr.
log() { echo "$@" >&2; }

log "[syslink-configs] Hook invoked. Initializing workspace provisioning..."

# 1. NON-BLOCKING STDIN READ (bash-native; no `timeout` binary — it is ABSENT from
#    the macOS base system and unavailable on Claude Code's restricted GUI PATH).
#    `read -d ''` consumes the whole payload until EOF; `-t 2` caps the wait so a
#    parent that holds the pipe open WITHOUT sending EOF can never hang this hook.
INPUT=""
if [ ! -t 0 ]; then
    IFS= read -r -d '' -t 2 INPUT || true
fi

# 2. PARSE THE WORKTREE SLUG. Per the docs the field is `.name` (there is no `.path`).
NAME=""
if [ -n "$INPUT" ] && echo "$INPUT" | jq -e . >/dev/null 2>&1; then
    NAME=$(echo "$INPUT" | jq -r '.name // empty')
fi
if [ -z "$NAME" ]; then
    log "❌ Critical Error: No worktree 'name' slug found in hook payload."
    exit 1
fi
log "  • Resolved worktree slug: $NAME"

# 3. RESOLVE ABSOLUTE PROJECT ROOT + TARGET WORKTREE DIRECTORY.
ROOT_DIR=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)

# Worktrees are placed in a sibling directory OUTSIDE the main checkout to avoid
# nesting a worktree inside the repo. Change WORKTREE_BASE if you prefer elsewhere.
WORKTREE_BASE="${ROOT_DIR}/../$(basename "$ROOT_DIR").worktrees"
mkdir -p "$WORKTREE_BASE"
WORKTREE_BASE=$(cd "$WORKTREE_BASE" && pwd -P)
WORKTREE_DIR="${WORKTREE_BASE}/${NAME}"

# 3a. SELF-OVERWRITE GUARD RAIL (explicit, as requested).
#     If the resolved target ever collapses onto the repo root, the symlink step
#     in section 5 would point files AT THEMSELVES — e.g.
#         ln -sf "$ROOT_DIR/tsconfig.base.json" "$WORKTREE_DIR/tsconfig.base.json"
#     becomes tsconfig.base.json -> tsconfig.base.json, an ELOOP that DESTROYS the
#     real file's contents. This actually corrupted the repo before. Hard-abort.
if [ "$WORKTREE_DIR" = "$ROOT_DIR" ]; then
    log "❌ Critical Error: Worktree target equals repo root. Aborting to avoid self-symlink corruption."
    exit 1
fi

# 4. CREATE THE WORKTREE (idempotent). baseRef is HEAD, matching settings.local.json.
if git worktree list --porcelain | grep -qx "worktree $WORKTREE_DIR"; then
    log "  • Worktree already present at $WORKTREE_DIR; reusing."
elif git show-ref --verify --quiet "refs/heads/$NAME"; then
    git worktree add "$WORKTREE_DIR" "$NAME" >&2
    log "  • Created worktree from existing branch '$NAME'."
else
    git worktree add "$WORKTREE_DIR" -b "$NAME" HEAD >&2
    log "  • Created worktree on new branch '$NAME' from HEAD."
fi

# 5. LINK SHARED CONFIGURATION INTO THE WORKTREE.
ln -sf "$ROOT_DIR/.env.shared" "$WORKTREE_DIR/.env.dev"
ln -sf "$ROOT_DIR/tsconfig.base.json" "$WORKTREE_DIR/tsconfig.base.json"
log "  • Linked shared configs (.env.dev, tsconfig.base.json)."

# 6. RETURN THE PATH. This is the ONLY line that may write to stdout.
log "✅ [syslink-configs] Setup complete for '$NAME'."
echo "$WORKTREE_DIR"
