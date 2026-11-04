#!/usr/bin/env bash
# Backup: consistent (hot) database snapshot + covers → restic.
# Requires RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE in /etc/openlibrary/backup.env.
# shellcheck source=deploy/scripts/common.sh
source "$(dirname "$(readlink -f "$0")")/common.sh"
: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY in /etc/openlibrary/backup.env}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE in /etc/openlibrary/backup.env}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

SNAP="$OL_DATA/backups/library.db"
log "Snapshotting the database…"
"${COMPOSE[@]}" exec -T app node dist/cli.js backup /data/backups/library.db \
  || die "could not create the snapshot (is the container running?)"

PATHS=("$SNAP")
[ -d "$OL_DATA/assets" ] && PATHS+=("$OL_DATA/assets")

log "Sending to restic ($RESTIC_REPOSITORY)…"
restic backup --tag openlibrary --host openlibrary "${PATHS[@]}"

log "Applying retention (7 daily, 4 weekly, 12 monthly)…"
restic forget --tag openlibrary --host openlibrary --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune

if [ "$(date +%u)" = "7" ]; then
  log "Sunday: checking the repository…"
  restic check --read-data-subset=5%
fi

date -u +%FT%TZ > "$OL_DATA/backups/last-success"
log "Backup completed."
