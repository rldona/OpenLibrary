#!/usr/bin/env bash
# Updates to the latest version of the repository: backup, build and restart.
source "$(dirname "$(readlink -f "$0")")/common.sh"
cd "$OL_REPO"
log "Backup first…"
"$OL_REPO/deploy/scripts/backup.sh" || log "WARNING: the pre-update backup failed; continuing."
log "Pulling changes…"
git pull --ff-only
log "Building the image…"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d
log "Updated. Status:"
"${COMPOSE[@]}" ps
