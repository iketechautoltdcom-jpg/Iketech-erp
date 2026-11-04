#!/usr/bin/env bash
# IKETECH ERP — logical backup of the PostgreSQL database.
# Usage: DATABASE_URL=... BACKUP_DIR=/var/backups/iketech ./backup.sh
# Optional: BACKUP_GPG_RECIPIENT=ops@iketech... to encrypt the dump; RETENTION_DAYS (default 35).
# Run daily from cron or a scheduler; PITR (WAL archiving) is configured on the database host separately.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
mkdir -p "$BACKUP_DIR"
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/iketech-$STAMP.dump"

pg_dump --format=custom --compress=6 --no-owner --file="$FILE" "$DATABASE_URL"
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE" && rm -f "$FILE"
  FILE="$FILE.gpg"
fi
sha256sum "$FILE" > "$FILE.sha256"
find "$BACKUP_DIR" -name 'iketech-*.dump*' -mtime "+$RETENTION_DAYS" -delete
echo "$FILE"
