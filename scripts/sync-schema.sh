#!/usr/bin/env bash
# sync-schema.sh — vendor bot Drizzle schemas into botpanel.
#
# Bot schemas are the source of truth (lives in each bot's repo). Botpanel
# never edits them and never runs drizzle-kit/db:migrate. This script rsyncs
# fresh copies into web/src/lib/db/schema/{squishy,otter}/ and prepends a
# DO-NOT-EDIT banner so accidental edits in the panel get caught in review.
#
# CI re-runs this script and fails on `git diff --exit-code` to catch drift
# (see web/package.json -> verify:schemas).
#
# Override the bot repo paths via env for CI runners:
#   SQUISHY_REPO=/tmp/squishybot-src OTTER_REPO=/tmp/otterbot-src \
#     bash scripts/sync-schema.sh

set -euo pipefail

SQUISHY_REPO="${SQUISHY_REPO:-/home/botuser/projects/squishybot}"
OTTER_REPO="${OTTER_REPO:-/home/botuser/projects/otterbot}"

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_BASE="$REPO_ROOT/web/src/lib/db/schema"

BANNER='// AUTO-GENERATED — DO NOT EDIT. Run scripts/sync-schema.sh in botpanel repo.'

log() { printf '[sync-schema] %s\n' "$*"; }

sync_one() {
  local name="$1"
  local src_repo="$2"
  local dest="$DEST_BASE/$name"
  local src="$src_repo/src/db/schema"

  if [ ! -d "$src_repo" ]; then
    echo "ERROR: $name repo not found at $src_repo" >&2
    exit 1
  fi
  if [ ! -d "$src" ]; then
    echo "ERROR: $name schema dir not found at $src" >&2
    exit 1
  fi

  log "syncing $name: $src -> $dest"
  mkdir -p "$dest"
  rsync -av --delete \
    --include='*.ts' --include='*/' --exclude='*' \
    "$src/" "$dest/"

  # Prepend the DO-NOT-EDIT banner to every .ts file (idempotent — skips files
  # that already start with the banner so re-runs don't accumulate headers).
  while IFS= read -r -d '' f; do
    if ! head -n 1 "$f" | grep -qF "$BANNER"; then
      tmp="$(mktemp)"
      {
        printf '%s\n' "$BANNER"
        cat "$f"
      } > "$tmp"
      mv "$tmp" "$f"
    fi
  done < <(find "$dest" -type f -name '*.ts' -print0)

  log "$name: $(find "$dest" -type f -name '*.ts' | wc -l) file(s) vendored"
}

log "botpanel schema sync starting"
log "  SQUISHY_REPO=$SQUISHY_REPO"
log "  OTTER_REPO=$OTTER_REPO"
log "  dest base=$DEST_BASE"

sync_one squishy "$SQUISHY_REPO"
sync_one otter   "$OTTER_REPO"

log "done"
