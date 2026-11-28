#!/usr/bin/env bash
# DocMinds hourly MySQL backup with rotation.
#
# Retention:
#   - today:      every hourly backup (up to 24)
#   - past days:  3 per day (the hours in KEEP_PAST_HOURS, default 09, 15, 23)
#                 for the last KEEP_PAST_DAYS days (default 30)
#   - older:      deleted
#
# Run from cron every hour. Credentials come from ~/.docminds-backup.cnf (chmod 600),
# never from this file.
set -euo pipefail

DB="rashtrotthana_db"
DIR="${BACKUP_DIR:-/home/doc-minds/db-backups}"
CNF="${BACKUP_CNF:-/home/doc-minds/.docminds-backup.cnf}"
KEEP_PAST_HOURS="09 15 23"   # backups kept for each past day
KEEP_PAST_DAYS=30            # how many past days to keep
LOG="$DIR/backup.log"

mkdir -p "$DIR"
chmod 700 "$DIR"

TODAY=$(date +%F)
OLDEST_PAST=$(date -d "$KEEP_PAST_DAYS days ago" +%F)
HOUR=$(date +%H)
FILE="$DIR/${DB}_${TODAY}_${HOUR}00.sql.gz"
TMP="$FILE.part"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# 1. Dump. --single-transaction = consistent snapshot without locking InnoDB tables.
if mysqldump --defaults-extra-file="$CNF" --single-transaction --quick \
     --routines --triggers --events --no-tablespaces "$DB" | gzip -6 > "$TMP" \
   && gzip -t "$TMP"; then
  mv "$TMP" "$FILE"
  log "OK     $(basename "$FILE")  $(du -h "$FILE" | cut -f1)"
else
  rm -f "$TMP"
  log "FAILED backup at hour $HOUR (previous backups kept)"
  exit 1
fi

# 2. Rotate. Only touch files that match our exact naming pattern.
for f in "$DIR"/${DB}_????-??-??_??00.sql.gz; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  d=${name#${DB}_}; d=${d:0:10}          # YYYY-MM-DD
  h=${name: -11:2}                        # HH from ..._HH00.sql.gz

  keep=no
  if [ "$d" = "$TODAY" ]; then
    keep=yes
  elif [[ "$d" > "$OLDEST_PAST" || "$d" = "$OLDEST_PAST" ]]; then
    for k in $KEEP_PAST_HOURS; do [ "$h" = "$k" ] && keep=yes; done
  fi

  if [ "$keep" = "no" ]; then
    rm -f "$f"
    log "DELETED $name"
  fi
done
