# OpenLibrary — notes for Claude

Personal library app for physical books, single owner. Design and plan: `docs/01-analysis-and-design.md`. Deployment: `docs/deployment-runbook.md`.

## Conventions (agreed with the owner)

- **Language**: talk to the owner in Spanish. Everything in the repo is in **English**: docs, code, comments, test names, CLI/scripts output and **commit messages**.
- **The app is bilingual (English/Spanish)**. Never hardcode user-facing text:
  - Web: add keys to `apps/web/src/i18n/en.ts` and `es.ts` (es is type-checked against en).
  - Server: errors are `HttpError(status, code, 'i18n.key', params)`, translated per `Accept-Language` in `apps/server/src/i18n.ts`. Validation messages in schemas are keys too.
  - Shared labels/messages: `packages/contracts/src/i18n.ts`. A server test checks both languages have the same keys.
  - Android (F2+) must reuse the same keys.
- **Git**: author `Raúl López Doña <1206870+rldona@users.noreply.github.com>` (set in the repo's local config; never the work email). **No Claude attribution**: no `Co-Authored-By: Claude`, no "Generated with Claude Code" in commits or PRs. Commit only when asked.
- **Zero cost**: self-hosted on the owner's Ubuntu PC behind Tailscale (`tailscale serve`). Do not propose paid services, domains or managed databases unless asked. The app stays Internet-ready so publishing later is a deploy-only change (design doc §9.1).

## Stack and commands

npm workspaces, Node 24, TypeScript 6 (typescript-eslint does not support TS 7 yet).

```bash
npm install
npm test            # server tests (vitest)
npm run lint        # eslint + prettier --check
npm run typecheck
npm run build       # web (vite) + server (tsup)
npm run cli -w @openlibrary/server -- set-password | demo-data en|es | status
```

- `apps/server`: Fastify + Drizzle + SQLite (FTS5). New tables → edit `src/db/schema.ts`, then `npm run db:generate -w @openlibrary/server`.
- Every catalog entity has `version` + change log; updates send `baseVersion` and merge per field (`src/catalog/changes.ts`). Clients send only the fields the user changed. Zod 4: `.partial()` keeps defaults, use `patchOf()` in contracts.
- Tests never hit the network: inject `fetch` into `buildApp`.

## Status

- F0 foundations ✔, F1 web catalog ✔, bilingual UI ✔ (2026-11-04).
- Next: deploy on the Ubuntu PC (runbook), then F2 — Android browsing + sync pull.
- The Docker image has not been run on a real machine yet (it was built on a Mac without Docker); check the CI `docker` job and the first Ubuntu deploy.
