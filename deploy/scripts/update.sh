#!/usr/bin/env bash
# Actualiza a la última versión del repositorio: copia de seguridad, compilación y reinicio.
source "$(dirname "$(readlink -f "$0")")/common.sh"
cd "$OL_REPO"
log "Copia de seguridad previa…"
"$OL_REPO/deploy/scripts/backup.sh" || log "AVISO: la copia previa falló; continúo."
log "Descargando cambios…"
git pull --ff-only
log "Compilando la imagen…"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d
log "Actualizado. Estado:"
"${COMPOSE[@]}" ps
