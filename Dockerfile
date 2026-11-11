# syntax=docker/dockerfile:1
# Single image: API + built web app. State lives in the /data volume.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- Build ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Build tools in case better-sqlite3 has no prebuilt binary for this architecture.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

# ---------- Production dependencies ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @openlibrary/server

# ---------- Runtime ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./web
# No VOLUME instruction: Railway rejects it, and compose bind-mounts /data anyway.
RUN mkdir -p /data && chown node:node /data
# Runs as "node". Started as root instead (Railway: RAILWAY_RUN_UID=0, because its volumes are
# owned by root; `railway ssh`), the server and the CLI hand DATA_DIR to "node" and drop to it
# before opening anything (src/privileges.ts).
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
