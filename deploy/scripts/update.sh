#!/usr/bin/env bash
# Updates to the latest version of the repository: backup, build and restart.
# Run it with sudo (the backup settings are root-only); git still runs as the clone's owner,
# whose SSH key and known_hosts reach the remote.
# shellcheck source=deploy/scripts/common.sh
source "$(dirname "$(readlink -f "$0")")/common.sh"
[ "$(id -u)" = 0 ] || die "run it with sudo"
cd "$OL_REPO" || die "cannot enter $OL_REPO"
log "Backup first…"
"$OL_REPO/deploy/scripts/backup.sh" || log "WARNING: the pre-update backup failed; continuing."
log "Pulling changes…"
OWNER="$(stat -c %U "$OL_REPO")"
sudo -u "$OWNER" -H git -C "$OL_REPO" pull --ff-only
log "Building the image…"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d
log "Updated. Status:"
"${COMPOSE[@]}" ps
