#!/usr/bin/env bash
# Dumps the INFOdns MariaDB database to a timestamped SQL file.
# Usage: ./scripts/backup.sh [output_dir]

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_FILE="$OUTPUT_DIR/infodns_${TIMESTAMP}.sql.gz"

echo "Dumping database to $OUT_FILE ..."

docker compose exec -T db \
  mariadb-dump \
    --user=infodns \
    --password="${DB_PASSWORD:-changeme_infodns}" \
    --single-transaction \
    --routines \
    --triggers \
    infodns \
  | gzip > "$OUT_FILE"

echo "Backup complete: $OUT_FILE"
