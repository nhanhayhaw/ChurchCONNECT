#!/usr/bin/env bash
#
# RT AG Connect backup.
#
# Backs up BOTH things that matter and are not reproducible:
#   1. the PostgreSQL database
#   2. the uploaded member photographs
#
# Backing up only the database is the mistake to avoid - you would restore a
# congregation with every photograph missing and no way to recover them.
#
# Install (run from the deploy/ directory):
#   chmod +x backup.sh
#   crontab -e
#   15 2 * * * cd /opt/churchconnect/deploy && ./backup.sh >> /var/log/cc-backup.log 2>&1
#
# A backup you have never restored is not a backup. See docs/OPERATIONS.md for
# the restore drill, and do it once before you take on a paying church.

set -euo pipefail

cd "$(dirname "$0")"

# shellcheck disable=SC1091
set -a; source .env; set +a

BACKUP_DIR="./backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] backup started"

# --- 1. Database -------------------------------------------------------------
# --format=custom so the dump can be restored selectively and is compressed.
docker compose exec -T db pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  > "${BACKUP_DIR}/db_${STAMP}.dump"

DB_SIZE=$(du -h "${BACKUP_DIR}/db_${STAMP}.dump" | cut -f1)
echo "  database  -> db_${STAMP}.dump (${DB_SIZE})"

# A zero-length dump means pg_dump failed but the pipeline swallowed it.
if [ ! -s "${BACKUP_DIR}/db_${STAMP}.dump" ]; then
  echo "  ERROR: database dump is empty - failing loudly rather than rotating a good backup away."
  rm -f "${BACKUP_DIR}/db_${STAMP}.dump"
  exit 1
fi

# --- 2. Member photographs ---------------------------------------------------
docker compose run --rm --no-deps \
  --volume "$(pwd)/${BACKUP_DIR}:/backup" \
  app tar czf "/backup/uploads_${STAMP}.tar.gz" -C /app uploads

UP_SIZE=$(du -h "${BACKUP_DIR}/uploads_${STAMP}.tar.gz" | cut -f1)
echo "  uploads   -> uploads_${STAMP}.tar.gz (${UP_SIZE})"

# --- 3. Rotate ---------------------------------------------------------------
find "$BACKUP_DIR" -name 'db_*.dump'        -mtime "+${KEEP_DAYS}" -delete
find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -mtime "+${KEEP_DAYS}" -delete

echo "  retained  : ${KEEP_DAYS} days"
echo "[$(date -Iseconds)] backup complete"

# --- 4. Off-site -------------------------------------------------------------
# A backup sitting on the same server as the database survives a bad UPDATE.
# It does not survive the server being lost, billed to a lapsed card, or
# encrypted by ransomware. Uncomment one of these once you have credentials.
#
# rclone copy "$BACKUP_DIR" remote:churchconnect-backups --max-age 48h
# aws s3 sync "$BACKUP_DIR" s3://your-bucket/churchconnect/ --storage-class STANDARD_IA
