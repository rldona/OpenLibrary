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

- `apps/android`: Kotlin + Compose + Room, its own Gradle build (JDK 21, SDK in `~/Android/Sdk`). From `apps/android`: `./gradlew :app:testDebugUnitTest :app:assembleDebug`. Strings are generated: `npm run android:strings` after changing any catalog. API changes: update `packages/contracts/openapi.yaml`, regenerate fixtures (`UPDATE_FIXTURES=1 npx vitest run test/openapi.test.ts test/stats.test.ts` in apps/server, then `npm run format`) and the Kotlin DTOs.
- Testing on the owner's phone: it is connected to the REAL server — never make test edits there; use the emulator (`ol-test` AVD) against the dev server.
- Dev server for the app: launch config `server-android` (port 8081, demo data in `apps/server/.data`, its password in `.data/dev-password`). Emulator reaches it at `http://10.0.2.2:8081`; a phone over adb at `http://localhost:8081` after `adb reverse tcp:8081 tcp:8081`.
- `apps/server`: Fastify + Drizzle + SQLite (FTS5). New tables → edit `src/db/schema.ts`, then `npm run db:generate -w @openlibrary/server`.
- Every catalog entity has `version` + change log; updates send `baseVersion` and merge per field (`src/catalog/changes.ts`). Clients send only the fields the user changed. Zod 4: `.partial()` keeps defaults, use `patchOf()` in contracts.
- Tests never hit the network: inject `fetch` into `buildApp`.

## Status

- F0 foundations ✔, F1 web catalog ✔, bilingual UI ✔ (2026-11-04).
- Deployed on the Ubuntu PC (2026-11-04): `https://openlibrary.<tailnet>.ts.net`, runbook followed.
- F2 ✔ (2026-11-04): `/sync/snapshot` + `/sync/pull`, `openapi.yaml`, Android app (browse, search, details, locations, offline).
- F3 ✔ (2026-11-04): `POST /sync/push` (idempotent ops, `applied_ops`), Android outbox + local writes, add book (scan, ISBN lookup, provisional, cover photo), edit/move/retire copies, conflicts screen.
- F4 ✔ (2026-11-04): reading sessions, wishlist + "I bought it", quotes (sync entities `reading`, `wish`, `quote`), statistics (`GET /stats`; Android computes them offline, `StatsParityTest` keeps both equal).
- F5 ✔ (2026-11-04): export (`/export/full` zip with covers, `/export/csv`), import of our own zip/JSON/CSV with dry run and report (`src/portability/`), backup status in the web, restore drill test (`test/restore-drill.test.ts`), Android local DB encrypted with SQLCipher (key sealed by the Keystore, plain databases encrypted in place on upgrade) and optional fingerprint/PIN app lock. The Android Room database needs the native SQLCipher library, so JVM unit tests build in-memory databases and `AppContainer.db` is lazy.
- F5 finished (2026-11-05): Android bulk entry ("Scan many": `sync/BulkScan.kt`, books saved as scanned, provisional with an `ISBN …` stand-in title when offline or unknown; the library shows a "to complete" filter), local writes reindex only the editions they touch (`reindexFor`), `PerformanceTest` with 10,000 copies, accessibility pass on web and Android. The MVP plan (F0–F5) is complete; next steps are the owner's choice (BNE metadata, Goodreads import, copy photos and labels…).
- F6 cover identification ✔ (2026-11-05): Android Add Book has an "Identify" camera tab (CameraX + bundled ML Kit text recognition, on-device OCR with corner dots, `core/CoverText.kt` heuristics) and a Goodreads-style candidate modal. `GET /lookup/search?title=&author=` returns up to 8 candidates from Open Library + Google Books (`lookup/search.ts`, no cache; Open Library never carries an ISBN, Google Books carries the exact volume ISBN; `owned` for ISBNs already in the catalog). Picking a candidate fills the form; with an ISBN it reuses `/lookup/isbn`. Scope: Add Book only; wishlist, visual re-ranking and a vision fallback are deferred.
- Adding a synced entity type: server table + `TABLES` + sync snapshot/pull/push, `openapi.yaml` + fixtures, Kotlin DTO/Room entity, and bump `SYNC_FORMAT` in the Android app so old copies re-download.
- The Docker image builds and runs healthy on the Ubuntu PC (2026-11-04). The lockfile must resolve from registry.npmjs.org (never a work registry).
