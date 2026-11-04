# Despliegue en el PC Ubuntu (F0)

Resultado: `https://<tu-pc>.<tu-tailnet>.ts.net` accesible desde tus dispositivos en casa y fuera, **sin abrir puertos** ni exponer nada a Internet. Coste: 0 €.

```
Móvil / portátil ──(Tailscale, cifrado)──▶ PC Ubuntu
                                           tailscale serve :443 (HTTPS, certificado automático)
                                             └─▶ 127.0.0.1:8080 → contenedor openlibrary (API + web)
                                                                     └─ /srv/openlibrary/data (BD, portadas, copias)
```

## 1. Requisitos (una vez)

```bash
sudo apt update && sudo apt install -y git restic
# Docker Engine + plugin compose (https://docs.docker.com/engine/install/ubuntu/)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # cierra sesión y vuelve a entrar para que surta efecto
```

## 2. Tailscale

1. Crea una cuenta gratuita en https://login.tailscale.com (plan Personal).
2. En el PC:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=openlibrary
   ```
   Con `--hostname=openlibrary` la dirección será `https://openlibrary.<tu-tailnet>.ts.net`.
3. En la consola de administración → **DNS**: activa **MagicDNS** y **HTTPS Certificates**.
4. En el móvil Android y en tu portátil: instala la app de Tailscale e inicia sesión con la misma cuenta.

## 3. Código y configuración

```bash
sudo mkdir -p /opt/openlibrary /srv/openlibrary/data
sudo chown "$USER" /opt/openlibrary
sudo chown 1000:1000 /srv/openlibrary/data      # el contenedor corre como usuario 1000 (node)

git clone <url-de-tu-repositorio-privado> /opt/openlibrary
cd /opt/openlibrary/deploy
cp .env.example .env
nano .env        # PUBLIC_URL=https://openlibrary.<tu-tailnet>.ts.net
```

> Si no quieres usar GitHub, copia la carpeta del proyecto con `rsync -a --exclude node_modules OpenLibrary/ pc-ubuntu:/opt/openlibrary/`.

## 4. Arrancar

```bash
cd /opt/openlibrary/deploy
docker compose up -d --build
docker compose ps                         # debe aparecer «healthy» al cabo de unos segundos
sudo ln -sf /opt/openlibrary/deploy/scripts/ol /usr/local/bin/ol
ol set-password                           # te pide la contraseña (mínimo 12 caracteres)
```

Publicar por HTTPS dentro de tu tailnet (persiste tras reinicios):

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

Comprobaciones:

```bash
curl -s http://127.0.0.1:8080/api/v1/health            # en el PC
curl -s https://openlibrary.<tu-tailnet>.ts.net/api/v1/health   # desde otro dispositivo con Tailscale
```

Abre la URL en el navegador del móvil (con Tailscale activo): debe pedir la contraseña.

## 5. Copias de seguridad

Destino gratuito recomendado: un **disco USB** o un segundo disco montado de forma fija (por ejemplo, `/mnt/backup`). Si más adelante quieres una copia fuera de casa, restic admite Backblaze B2 (10 GB gratis) sin cambiar nada más.

```bash
sudo mkdir -p /etc/openlibrary
sudo sh -c 'openssl rand -base64 32 > /etc/openlibrary/restic.pass && chmod 600 /etc/openlibrary/restic.pass'
sudo tee /etc/openlibrary/backup.env >/dev/null <<'EOF'
RESTIC_REPOSITORY=/mnt/backup/openlibrary-restic
RESTIC_PASSWORD_FILE=/etc/openlibrary/restic.pass
EOF
sudo chmod 600 /etc/openlibrary/backup.env
sudo env $(sudo cat /etc/openlibrary/backup.env | xargs) restic init
```

> **Guarda una copia de `/etc/openlibrary/restic.pass` fuera del PC** (gestor de contraseñas). Sin ella, las copias no se pueden abrir.

Probar y programar:

```bash
sudo /opt/openlibrary/deploy/scripts/backup.sh
sudo cp /opt/openlibrary/deploy/systemd/openlibrary-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openlibrary-backup.timer
systemctl list-timers openlibrary-backup.timer
```

La copia se hace cada noche a las 3:30 y, si el PC estaba apagado, unos minutos después de encenderlo.

## 6. Restaurar

```bash
sudo env $(sudo cat /etc/openlibrary/backup.env | xargs) restic snapshots   # ver copias disponibles
sudo /opt/openlibrary/deploy/scripts/restore.sh            # la última
sudo /opt/openlibrary/deploy/scripts/restore.sh 4f2a9c1e   # una concreta
```

El estado actual no se borra: queda apartado como `library.db.antes-de-restaurar-<fecha>`. Tras restaurar, el servidor cambia su *epoch* y los móviles harán una resincronización completa.

**Simulacro recomendado** tras instalar: crea una copia, cambia la contraseña, restaura y comprueba que vuelve la anterior.

## 7. Operación diaria

| Tarea | Comando |
|-------|---------|
| Probar con datos de ejemplo (biblioteca vacía) | `ol demo-data` |
| Ver estado | `ol status` · `docker compose -f /opt/openlibrary/deploy/docker-compose.yml ps` |
| Ver logs | `docker compose -f /opt/openlibrary/deploy/docker-compose.yml logs -f --tail=100` |
| Cambiar contraseña (si la olvidas) | `ol set-password` (cierra todas las sesiones) |
| Actualizar a la última versión | `/opt/openlibrary/deploy/scripts/update.sh` |
| Revocar un móvil perdido | Web → Sesiones y dispositivos → Revocar |

## 8. Seguridad: qué protege a la biblioteca

- La app solo escucha en `127.0.0.1`; desde la red de casa o desde Internet no se ve.
- Solo los dispositivos de **tu** tailnet llegan a la URL; el tráfico va cifrado de extremo a extremo.
- Aun así la app se comporta como si estuviera en Internet: contraseña con Argon2id, bloqueo progresivo tras 5 fallos, cookies `Secure`/`HttpOnly`/`SameSite=Strict`, protección CSRF y cabeceras de seguridad. Por eso publicarla algún día solo cambiaría el despliegue (ver §9.1 del documento de diseño).
- Nota: detrás de `tailscale serve` todas las peticiones pueden llegar con la misma IP interna; el bloqueo por intentos fallidos se comporta entonces como un bloqueo global, lo que es aceptable para un único usuario.
