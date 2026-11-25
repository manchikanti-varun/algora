#!/usr/bin/env bash
# Logical backup of the Algora database with mongodump (needed on Atlas M0, which has no built-in backups).
# Usage: MONGODB_URI='mongodb+srv://...' ./scripts/ops/backup.sh [output-dir]
# Restore (to a NEW database first, then verify): mongorestore --uri "$TARGET_URI" --gzip --archive=<file> --nsFrom='algora.*' --nsTo='algora_restore.*'
set -euo pipefail
: "${MONGODB_URI:?MONGODB_URI is required}"
command -v mongodump >/dev/null || { echo "mongodump not found: install MongoDB Database Tools" >&2; exit 1; }
out="${1:-./backups}"; mkdir -p "$out"
file="$out/algora-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
mongodump --uri "$MONGODB_URI" --gzip --archive="$file"
echo "backup written: $file ($(du -h "$file" | cut -f1))"
