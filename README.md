# OpenLibrary

Biblioteca personal de libros físicos: servidor en un PC Ubuntu (accesible por Tailscale), web de gestión y app Android nativa con escaneo de ISBN y modo offline.

- **Análisis y diseño técnico** → [docs/01-analisis-y-diseno.md](docs/01-analisis-y-diseno.md)
- **Despliegue en Ubuntu** → [docs/runbook-despliegue.md](docs/runbook-despliegue.md)
- **Prototipos navegables** → `prototypes/`

## Estructura

```
apps/server         API (Fastify + TypeScript + SQLite/Drizzle) y CLI de administración
apps/web            Web (React + Vite), servida por el propio servidor
packages/contracts  Esquemas compartidos de la API (zod)
deploy/             Docker Compose, scripts de copia/restauración/actualización, timers systemd
prototypes/         Prototipos HTML de la web y de Android
```

## Desarrollo

Requisitos: Node 24.

```bash
npm install
npm run cli -w @openlibrary/server -- set-password   # crea la contraseña en ./apps/server/.data
npm run cli -w @openlibrary/server -- demo-data      # opcional: ubicaciones y 12 libros de ejemplo
npm run dev:server                                   # API en http://localhost:8080
npm run dev:web                                      # web en http://localhost:5173 (reenvía /api al servidor)
```

Para la web en modo desarrollo, crea `apps/server/.env` con `EXTRA_ORIGINS=http://localhost:5173`.

```bash
npm test            # pruebas del servidor
npm run lint        # ESLint + Prettier
npm run typecheck
npm run build       # web + servidor (apps/*/dist)
```

## Prototipos

```bash
python3 -m http.server 8765 --directory prototypes
```

Web: http://localhost:8765/web/ · Android: http://localhost:8765/android/
