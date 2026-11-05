#!/usr/bin/env bash
# Restores a backup. Usage: TARGET_DATABASE_URL=... scripts/restore.sh <backup file>
#
# Refuses a database that already has tables unless RESTORE_REPLACE=yes, because restoring replaces
# what is there. Restore into a new database first, check it, and only then switch to it.
# Requires pg_restore 17 or newer. Set PG_DOCKER=1 to run it from the postgres:17 image instead.
set -euo pipefail

FILE="${1:?Usage: TARGET_DATABASE_URL=... scripts/restore.sh <backup file>}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

run() {
  if [ "${PG_DOCKER:-0}" = "1" ]; then
    docker run --rm -i --network host -v "$(cd "$(dirname "$FILE")" && pwd):/backups:ro" postgres:17-alpine "$@"
  else
    "$@"
  fi
}
LOCAL_FILE="$FILE"
[ "${PG_DOCKER:-0}" = "1" ] && LOCAL_FILE="/backups/$(basename "$FILE")"

EXISTING=$(run psql "$TARGET_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$EXISTING" != "0" ] && [ "${RESTORE_REPLACE:-}" != "yes" ]; then
  echo "That database already has $EXISTING tables. Refusing to overwrite it." >&2
  echo "Restore into an empty database, or set RESTORE_REPLACE=yes if you really mean to replace it." >&2
  exit 1
fi

run pg_restore --dbname="$TARGET_DATABASE_URL" --clean --if-exists --no-owner --exit-on-error "$LOCAL_FILE"
echo "Restored $FILE. Run npm run db:check against it before switching over."
