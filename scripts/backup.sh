#!/usr/bin/env bash
# Writes one compressed database backup. Usage: DATABASE_URL=... scripts/backup.sh [directory]
# Requires pg_dump 17 or newer. Set PG_DOCKER=1 to run it from the postgres:17 image instead.
set -euo pipefail

DIR="${1:-backups}"
: "${DATABASE_URL:?Set DATABASE_URL}"
mkdir -p "$DIR"
FILE="$DIR/blooms-$(date -u +%Y%m%dT%H%M%SZ).dump"

if [ "${PG_DOCKER:-0}" = "1" ]; then
  docker run --rm --network host -v "$(cd "$DIR" && pwd):/backups" postgres:17-alpine \
    pg_dump "$DATABASE_URL" --format=custom --no-owner --file="/backups/$(basename "$FILE").partial"
else
  pg_dump "$DATABASE_URL" --format=custom --no-owner --file="$FILE.partial"
fi
mv "$FILE.partial" "$FILE"
echo "$FILE"
