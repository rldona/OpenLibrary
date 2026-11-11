# OpenLibrary — Functional analysis and technical design (v0.2)

> Personal library of physical books. A single owner. Server on a home Ubuntu PC that is **not** always on. Web client (catalog and management from the computer) and native Android app (barcode scanner, camera for covers and offline browsing).

Living document. Confirmed decisions (2026-11-04): full-management web app, access from outside home, collection starts from scratch, reading tracked per copy, self-hosted at zero cost, **documentation in English and the app in English and Spanish**. Everything else is a recommendation open to review.

---

## 1. Requirements analysis: ambiguities, contradictions and dependencies

| # | Topic | Issue found | Proposal |
|---|-------|-------------|----------|
| A1 | **Role of the web app** | The conversation described the web as "catalog viewing", but the definition (§11) asks for manual entry, editing, copies, locations, import/export… | The web is the **full management station** (everything except scanning/photographing). Android is the **capture and browsing station**. Both edit; the web is online-only. **Decided:** full management. |
| A2 | **Reading status: copy or work?** | §8 says "each copy can have a reading status", but reading is an experience of the work (owning two copies of *1984* does not mean reading it twice), and §15 asks to distinguish metrics per work and per copy. | Reading is recorded as a **`ReadingSession` linked to a copy** (the one you held), and the **work status is derived** (read if any session of any copy/edition is finished). The UI shows a single status and a "Re-read" button that starts another session. **Decided** (revisable). |
| A3 | **Metadata with the PC off** | If ISBN lookup goes through the server, scanning with the PC off never retrieves data even if the phone has Internet. | Android queries the providers (Open Library, Google Books) **directly** when online; the web does it through the server (proxy). Same normalisation module in both. *As implemented (F3+), Android also uses the server proxy for ISBN and cover-text lookups; the OCR itself stays on the phone.* |
| A4 | **Access from outside home** | Not specified whether Android syncs only on the home Wi-Fi. Exposing the PC to the Internet conflicts with §16 (privacy). | **Tailscale** (mesh VPN, no open ports): works at home and away, with no public exposure. **Decided:** access from outside. The architecture is ready to go public without code changes (§9.1). **Superseded 2026-11-11:** public HTTPS URL on Railway (§9); Tailscale remains an option for self-hosting. |
| A5 | **"Server as central reference" vs offline edits** | If the server is authoritative and Android edits offline, we must define what happens when both touch the same data. | **Field-level** merge with a base version; conflict only if the *same field* changed on both sides → shown to the user (§6). |
| A6 | **Provisional books** | Offline creation: does it complete itself later? | Marked `metadata_status = provisional`. When back online the lookup is **proposed** (not applied); the user reviews it. Manually edited data is never overwritten. |
| A7 | **ISBN shared between works** | Some publishers reuse ISBNs, or one ISBN covers a multi-volume work. | ISBN is a **non-unique** index system-wide; the app warns about matches and lets you choose "same edition / a different one". |
| A8 | **Cover: edition or copy?** | You want to photograph covers. A photo of *your* copy (wear, dedication) differs from the "official" cover. | The cover belongs to the **edition**. A photo can be used as the edition cover or stored as a **copy photo** (MVP: edition cover only; copy photos → later). |
| A9 | **Import** | The format of "an existing collection" is not stated. | **Decided:** starting from scratch. MVP: import only our own format (CSV and JSON), useful for restore and migration. Goodreads and others come later. |
| A10 | **Offline phone security** | Private data on the phone: app lock? | Encrypted local DB (SQLCipher) + optional biometric lock. Device token revocable from the web. |
| A11 | **Series / collections / volumes** | Not mentioned but common (Dune, The Lord of the Rings, encyclopaedias). | `series` + `series_index` on the work; multiple volumes as a `volumes` field on the edition. No dedicated model in the MVP. |
| A12 | **Currency and price** | Purchase price without currency. | `price_cents` (integer) + `price_currency` (EUR by default). |
| A13 | **"Other identifiers"** | Open-ended. | Generic `edition_identifier (scheme, value)` table: OLID, Google Books ID, Spanish legal deposit, BNE, OCLC… |
| A14 | **Languages** | Not covered by the definition. | **Decided:** UI in English and Spanish (browser language by default, switchable and remembered); server messages follow `Accept-Language`; documentation, code and comments in English. |

**Unresolved dependencies**: availability/quality of metadata for old Spanish editions (Open Library and Google Books have major gaps; see risk R1), and the Ubuntu PC needs disk space and some external backup destination.

---

## 2. Use cases and main flows

### Actors
- **Owner** (single user), from web or Android.
- **External metadata providers** (system).
- **Server** (system): data reference, sync, backups.

### Use cases (MVP)

| ID | Use case | Web | Android | Offline (Android) |
|----|----------|:---:|:-------:|:-----------------:|
| UC01 | Scan an ISBN and add the book | — | ✔ | ✔ (provisional) |
| UC02 | Manual entry (with/without ISBN) | ✔ | ✔ | ✔ |
| UC03 | Review/fix proposed metadata | ✔ | ✔ | ✔ (no remote lookup) |
| UC04 | Photograph a cover | — | ✔ | ✔ (uploaded later) |
| UC05 | Add a copy to an existing edition | ✔ | ✔ | ✔ |
| UC06 | Move / retire a copy | ✔ | ✔ | ✔ |
| UC07 | Manage locations (tree) | ✔ | ✔ (browse + simple create) | browse |
| UC08 | Search, filter, sort | ✔ | ✔ | ✔ |
| UC09 | Change reading status, rate, notes, quotes | ✔ | ✔ | ✔ |
| UC10 | Wishlist and "I bought it" | ✔ | ✔ | ✔ |
| UC11 | Statistics | ✔ | ✔ | ✔ (on local data) |
| UC12 | Import collection | ✔ | — | — |
| UC13 | Export CSV / full JSON | ✔ | (share export) | — |
| UC14 | Backups and restore | ✔ (trigger/view) + CLI | — | — |
| UC15 | Sync and resolve conflicts | (online) | ✔ | persistent queue |
| UC16 | Manage credentials and devices | ✔ | login/logout | — |
| UC17 | Identify a book from its cover (OCR + text search) | — | ✔ | OCR offline; the provider search needs the server |

### Key flow UC01 — Scanning
```
Add → Camera (CameraX + ML Kit, on-device)
  → Code read → normalise → valid 978/979 EAN-13 or ISBN-10?
      no  → notice "Not an ISBN (e.g. ISSN 977…)" and keep scanning
      yes → is there an edition with that ISBN in the local DB?
              yes → "You already own this edition (N copies at …)" → [Add another copy] [View details]
              no  → is it on the wishlist? → notice "it will be marked as acquired"
                  → Internet available?
                      no  → form with the ISBN, marked PROVISIONAL
                      yes → query providers (6 s timeout, in parallel)
                             found → pre-filled form (source shown)
                             empty → "No results", empty form with the ISBN
  → Review/fix + copy data (location, condition, reading)
  → Save (local, transaction) → sync queue
```

### Flow UC10 — Wish → collection
Wish (free text or linked to a work/edition) → "I bought it" → opens the pre-filled creation form (reusing the work/edition if it exists) → on save, the wish becomes `acquired` with a reference to the new copy (it is not deleted: history).

---

## 3. Domain model

```
Work                        1 ── * Edition                      1 ── * Copy
 id, title, original_title       id, work_id, title?, subtitle        id, edition_id, code (EJ-0001)
 original_language               publisher, published_year            location_id?, condition
 description, series,            language, pages, format, volumes     acquired_on, price_cents,
 series_index                    isbn13?, isbn10?, cover_asset_id?    price_currency, notes,
 authors[], subjects[]           metadata_status, metadata_source     status (active|retired),
                                 *identifiers (scheme,value)          retired_reason, retired_on

Location (tree)              Copy * ── 0..1 Location
 id, parent_id?, name, kind (home|room|bookcase|shelf|box|other), sort_order

ReadingSession               Copy 1 ── * ReadingSession
 id, copy_id, status (pending|reading|read|abandoned), started_on?, finished_on?,
 rating (1–5, half points), notes

Quote                        id, work_id, copy_id?, text, page?, note
WishlistItem                 id, work_id?, edition_id?, free_title?, free_authors?, isbn13?,
                             priority, notes, status (open|acquired|discarded), acquired_copy_id?
Asset                        id = sha256, mime, width, height, bytes, origin (upload|provider|import)
```

> **Simplification applied in F1:** authors and subjects are stored as JSON lists on the work (`works.authors`, `works.subjects`) instead of `Person`/`Subject` tables. Each list is an atomic field for sync's field-level merge and is enough for search, filters and statistics. If needed later (author pages, translators), it can be normalised without changing the API.

**Why this design**
- *Work ↔ Edition ↔ Copy* follows a simplified FRBR (Work/Manifestation/Item); "Expression" (translation) is omitted to keep things simple: the translation is an attribute of the edition (`language`; translator as an edition-level contributor — later).
- Reading hangs off the **copy** (A2); work and edition derive their status.
- Content-addressed `Asset` (hash) → idempotent uploads, natural deduplication and simple backups.
- Every syncable entity has: client-generated UUIDv7 `id`, `version` (integer, bumped by the server), `created_at`, `updated_at`, `deleted_at` (tombstone).

---

## 4. Business rules and states

**Catalog**
- BR01. Only `Work.title` is required. An edition may have no ISBN.
- BR02. ISBNs are normalised: hyphens/spaces removed, ISBN-10 → ISBN-13 (and back when the prefix is 978). The check digit is validated. 979-xxx has no ISBN-10.
- BR03. Prefix 977 = ISSN, 979-0 = ISMN (sheet music): rejected with a clear message. The EAN-5 price add-on is ignored.
- BR04. Duplicate ISBN → no new edition without explicit confirmation.
- BR05. External data are **proposals**: never applied without review; clients only send the fields the user changed, so a lookup never silently overwrites manual edits.
- BR06. No cover → generated cover (title/author on a plain background). Provisional → visual badge.

**Copies and locations**
- BR07. A copy belongs to exactly one edition; it may have no location ("No location" is a filter).
- BR08. Retire ≠ delete: `status = retired` + reason (sold, given away, lost, damaged). Retired copies do not count in the collection but keep their reading history. Physical deletion only to fix wrong entries.
- BR09. A location cannot be its own ancestor (validated on the server). Deleting a location with content requires moving its copies/children first.
- BR10. Human-friendly copy code `EJ-0001` assigned by the server (a temporary code is shown offline). Enables physical labels in the future.

**Reading**
```
          start               finish
 pending ─────────▶ reading ─────────▶ read
    ▲                 │ abandon           │ re-read (new session)
    └──── reset ──────┴──▶ abandoned      └──────▶ reading
```
- BR11. Moving to `reading` sets `started_on` = today if empty; to `read`, `finished_on` = today. Dates are editable.
- BR12. Rating and notes per session; the details view shows the latest.
- BR13. Work status: `reading` if any session is active; `read` if any is finished; otherwise `pending`.
- *Favorites:* a `favorite` field on the work, so it syncs to Android and the web shares the same marks. The library listing returns `favorite` and the latest rating of the work, so both clients draw the orange heart (bottom-right of the cover) and the score flap (top-right); `POST`/`DELETE /works/{id}/favorite` toggles it.
- *Reset (web and Android):* choosing "not read yet" resets every live reading of the work (finished and in progress) to `pending` and clears their dates, so the work returns to `pending`. Ratings and notes are kept. It is the way to undo a read or a reread.

**Wishlist**
- BR14. A wish never counts as collection. On acquisition: a copy is created (plus edition/work if missing) and the wish becomes `acquired`.
- BR15. Scanning an ISBN that is on the wishlist shows a notice and links it.
- *As implemented (F4):* a wish holds its own title, authors and optional ISBN (no `edition_id`; `work_id` is an optional link). "I bought it" is two operations in order — create the book (or just a copy when you already own that edition) and then mark the wish acquired — so it works offline like any other change. Android also offers "Add to wishlist" from the add-book form (scanning in a bookshop).
- *Sync format (Android):* the phone records which entity types its local copy was downloaded with; an app update that syncs new types takes a snapshot, because an older app skipped those records while its cursor moved on.

---

## 5. Technical architecture and technologies

```
┌──────────────── Android (Kotlin) ────────────────┐         ┌────────────── Ubuntu PC ───────────────┐
│ Compose UI ─ ViewModels ─ Repositories            │         │ tailscale serve (TLS) ─ API (Fastify)  │
│ Room + FTS4 (SQLCipher)   Operation outbox        │◀─HTTPS─▶│   ├ SQLite (WAL) + FTS5                │
│ CameraX + ML Kit Barcode/Text  WorkManager (sync) │ Tailnet │   ├ /data/assets (covers by hash)      │
│ Coil (cover cache)        ISBN provider client    │         │   ├ ISBN providers (proxy for web)     │
└───────────────────────────────────────────────────┘         │   └ Static web (React) served here     │
            Browser (React + Vite + TanStack Query) ─────────▶│ systemd timers: nightly backup         │
                                                              └────────────────────────────────────────┘
```

### Decisions (alternatives evaluated)

| Area | Recommendation | Alternatives considered | Reason |
|------|----------------|-------------------------|--------|
| Mobile app | Native **Kotlin + Jetpack Compose** | Flutter, React Native, PWA | Native was requested. Direct CameraX/ML Kit access, WorkManager for reliable background sync, mature Room for offline. A PWA cannot reliably guarantee camera + persistent storage. |
| Scanner | **ML Kit Barcode + Text Recognition (bundled models)** | ZXing, cloud OCR/vision | 100% offline, fast, no Google Play dependency with the *bundled* variants. Cover identification reads the title/author on the phone and searches by text, not by image embeddings. |
| Mobile DB | **Room (SQLite) + FTS4**, encrypted with SQLCipher | Realm, DataStore | Standard SQL, offline full-text search over thousands of books in ms. |
| Backend | **Node.js 24 + TypeScript + Fastify** | Kotlin/Ktor, Python/FastAPI, Go, PocketBase | Shares types and validation (Zod) with the web; simple ecosystem; low footprint. Ktor would allow sharing models with Android via KMP but adds build complexity not worth it for a one-person project. PocketBase/Supabase solve CRUD but not a sync protocol with field-level conflicts. |
| Server DB | **SQLite (WAL) + FTS5**, via Drizzle ORM | PostgreSQL | One user, thousands of rows: SQLite is plenty. A single file → trivial backups and reliable restore. Drizzle allows moving to Postgres if ever needed. |
| Web | **React + Vite + TanStack Query**, served by the backend | SvelteKit, Next.js | Static SPA without SSR (no SEO, it is private). Leaves the door open to an offline PWA (later). |
| i18n | Own lightweight layer: shared message catalog (`packages/contracts`), web dictionaries type-checked for completeness, server messages by `Accept-Language` | i18next, FormatJS | Two languages and a few hundred strings: no heavy dependency needed. Error messages travel as keys, so Android can reuse the catalog. |
| Contract | **OpenAPI 3.1** as source of truth, generated from Zod schemas | GraphQL, gRPC | REST + JSON is the simplest to consume from Kotlin (OpenAPI generator/Retrofit) and TS. |
| Network | **Tailscale** + HTTPS with `tailscale serve` (automatic certificate, no extra proxy) | Port forwarding + DDNS, Cloudflare Tunnel | No open ports or public exposure, free for personal use, works at home and away. Cloudflare Tunnel exposes to the Internet (even behind Access). |
| Deployment | **Docker Compose** (1 container: API + web) with a `/srv/openlibrary` volume, listening on 127.0.0.1 only | Native systemd | Isolated and reproducible; updates via `deploy/scripts/update.sh`. Backups run from a systemd timer on the host. |
| Metadata | **Open Library** (primary) + **Google Books** (fallback) | ISBNdb (paid), BNE (SRU/MARC) | Free. BNE is very valuable for Spanish books: proposed for later (F5). Cover identification adds a title/author search: Open Library returns work-level candidates (no ISBN); Google Books returns the exact volume ISBN. |
| Auth | Password (Argon2id) + **cookie session** (web) and long-lived revocable **device token** (Android) | OAuth/OIDC, Basic | Single user: OIDC is overkill. Per-device tokens allow revoking a lost phone. |

---

## 6. Offline operation and sync protocol

### Principles
1. **Local-first on Android**: the UI *always* reads and writes Room. The network is never in the interaction path.
2. **Client-generated IDs** (UUIDv7) → create offline without collisions or reassignment.
3. **Persistent outbox**: each change is stored in the same transaction as the data as an operation with a unique `op_id`.
4. **Idempotency**: the server records each applied `op_id`; repeating it returns the same result without re-applying.
5. **Cursor pull**: the server keeps a `change_log` with a monotonic sequence; the client asks "everything since sequence N".
6. **Field-level conflicts**, never a silent "last write wins".

### Operation (push)
```json
{
  "op_id": "0192f4c1-7a3e-7c2e-9d1a-4b6f3c2e1a90",
  "entity": "copy",
  "entity_id": "0192f4c1-6b10-7aa1-8c33-55e1d0b2f001",
  "kind": "update",            // create | update | delete
  "base_version": 7,           // version the client had
  "fields": { "location_id": "…", "notes": "Not lent to anyone, it is on the bedside table" },
  "client_ts": "2026-11-04T09:12:33Z"
}
```

### Server algorithm (per operation, in a transaction)
```
if op_id ∈ applied_ops → return the stored result (idempotent)
load the current entity (version = v)
if kind=create and it does not exist → insert (version 1)
if base_version == v → apply every field
if base_version <  v → for each field sent:
       did that field change in change_log between base_version and v?
          no  → apply
          yes, same value      → ignore (convergent)
          yes, different value → record CONFLICT (do not apply that field)
if kind=delete and there are changes after base_version → "edited vs deleted" conflict
bump version, write change_log(seq++, entity, id, version, fields)
store op_id → result
```
*(Implemented in F1 in `apps/server/src/catalog/changes.ts` and already used by the web; F2 adds the pull endpoints in `apps/server/src/sync/`; F3 adds `applied_ops` and push.)*

**As implemented in F3** (differences from the sketch above, on purpose):
- Ops are typed (`book.create`, `copy.create`, `location.create`, `work|edition|copy|location.update`) and run through the same catalog service as the web, so validation and merging rules are identical. Copies are retired, not deleted; deleting from the phone is not offered.
- A conflict applies **nothing** of that op (like the web's 409): the device shows every conflicting field with both values and resolves with a new op ("keep mine" = same fields on `currentVersion`; "keep the server's" = drop it; "combine" for text). Only applied ops are stored in `applied_ops`, so a rejected op can succeed later once its cause is fixed (e.g. its parent location arrives).
- Changes made by the **same session** never conflict with each other: a phone that edits a field twice offline sends both ops with the same base version and the second wins.
- After any refused op the phone takes a snapshot instead of a pull, so the optimistic local value is replaced by the server's. Pending ops are re-applied on top of every snapshot and pull page.
- There is no `/sync/conflicts` endpoint: conflicts live in the device's outbox, where the user resolves them.
- Cover photos are content addressed (SHA-256 of the bytes = asset id), so a book created offline can reference its photo; the photo is uploaded before the ops in the next sync.

### Sync cycle (client)
```
1. PUSH   POST /sync/push   { device_id, batch_id, ops[≤100] }  → { results[op_id: applied|duplicate|conflict|rejected] }
2. ASSETS POST /assets (pending covers; idempotent by hash)
3. PULL   GET  /sync/pull?since=<cursor>&epoch=<epoch>&limit=500
                → { works[], editions[], copies[], locations[], deleted[], cursor, hasMore, epoch }
4. Apply remote changes in Room (entities with pending local ops are rebased)
5. Download new covers in the background (300 px thumbnail; original on demand)
```
- Triggers: on app open, after each change (5 s debounce), when the network returns (WorkManager with `NetworkType.CONNECTED`), every 30 min, and a manual button.
- Retries: exponential backoff (5 s → 10 min). The same batch is resent with the same `op_id`s → no duplicates even if the response was lost.
- **First connection**: `GET /sync/snapshot` (compressed JSON of everything + cursor), then covers are queued. 10,000 copies: ~160 ms on the server, 11 MB before gzip.
- **Pull is state based** (F2 ✔): each entity whose latest change is after the cursor comes back once, with its *current* state, ordered by that latest `seq`; deletions come as tombstones. An entity changed again while paging just reappears in a later page. A page is not in dependency order, so the client applies it in one transaction without local foreign keys.
- **Resync**: the client sends its `epoch`; after a restore the pull answers 409 `epoch-mismatch` (also `cursor-ahead` if the cursor is past the log) and the client takes a new snapshot.
- **Visible states**: `Synced · 2 min ago` · `3 pending changes` · `Server unavailable — data from 4 Nov 09:12` · `1 conflict to review`.
- **Conflicts**: listed under "Sync" with local vs server value per field → *Keep mine / Keep server / Combine (text)*. The resolution is just another operation.
- **Rejections** (validation): shown with a readable message; the op can be edited or discarded; it does not block the rest of the queue.
- Web: online, uses the same mutation API with `baseVersion` (so a stale web form never overwrites a phone change either).

### Offline scope on Android
| Available offline | Requires connection |
|---|---|
| Browse, search, filter, statistics | Metadata lookup (Internet) |
| Manual/provisional entry, cover photos | Sync (server) |
| Copies, reading, notes, quotes, wishlist | Import/export/backups (web) |
| Browse locations, create a simple location | Reorganise the location tree (web, to avoid structural conflicts) |

---

## 7. Client–backend contracts (summary)

Base: `https://openlibrary.<tailnet>.ts.net/api/v1` · JSON · errors as RFC 9457 (`application/problem+json`) with a stable `code` and a `detail` translated according to `Accept-Language`. Shapes live in `packages/contracts` (Zod).

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/health` | status, version, data `epoch` | F0 ✔ |
| POST | `/auth/login` · `/auth/logout` · GET `/auth/me` | web session (cookie) | F0 ✔ |
| POST | `/auth/devices` | registers a device → `{deviceId, token}` (Android) | F0 ✔ |
| GET / DELETE | `/auth/devices[/{id}]` | list / revoke sessions and devices | F0 ✔ |
| POST | `/auth/password` | change password (revokes other sessions) | F0 ✔ |
| GET | `/library?q=&location=&subject=&language=&favorite=&sort=&limit=&offset=` · `/library/facets` | paginated listing with FTS search; facets; each item carries `favorite` and the latest rating | F1 ✔ |
| POST | `/books` | work (new or existing) + edition + first copy, atomically; 409 `duplicate-isbn` | F1 ✔ |
| GET / PATCH | `/works/{id}` | work + editions + copies; PATCH with `baseVersion` and field merge | F1 ✔ |
| POST / DELETE | `/works/{id}/favorite` | favorite mark (a synced work field; web and Android) | Web ✔ · Android ✔ |
| PATCH / DELETE | `/editions/{id}` | update / delete an edition | F1 ✔ |
| POST / PATCH | `/copies`, `/copies/{id}` | add, move, edit, retire, restore | F1 ✔ |
| GET / POST / PATCH / DELETE | `/locations[/{id}]` | tree with cumulative counts | F1 ✔ |
| GET | `/lookup/isbn/{isbn}` | normalised metadata proposal (provider proxy, 30-day cache) + existing edition | F1 ✔ |
| GET | `/lookup/search?title=&author=` | up to 8 candidates from text read on a cover (Open Library + Google Books; partial results if a provider fails; `owned` for candidates with an ISBN already in the catalog) | F6 ✔ |
| POST / GET | `/assets` · `/assets/fetch` · `/assets/{sha256}?size=thumb\|full` | upload / fetch provider cover / download | F1 ✔ |
| GET | `/sync/snapshot` · `/sync/pull?since=&epoch=&limit=` | full snapshot; state-based incremental pull (§6) | F2 ✔ |
| POST | `/sync/push` | batch of offline ops, idempotent by `opId` (§6) | F3 ✔ |
| POST / PATCH | `/reading-sessions`, `/reading-sessions/{id}` | start, finish, abandon, re-read, rate (BR11–BR13); `WorkDetail` carries `readings` and the derived `readingStatus`; synced as entity `reading` | F4 ✔ |
| GET / POST / PATCH | `/wishlist`, `/wishlist/{id}` | wishes (BR14); "I bought it" = create the book or copy, then `status: acquired` + `acquiredCopyId`; synced as entity `wish` | F4 ✔ |
| POST / PATCH / DELETE | `/quotes`, `/quotes/{id}` | quotes of a work (`WorkDetail.quotes`); synced as entity `quote` (push `quote.delete` sends a tombstone) | F4 ✔ |
| GET | `/stats` | collection, reading, acquisitions, rankings, wishlist (definitions in `packages/contracts/src/stats.ts`); Android computes the same offline | F4 ✔ |
| GET / POST | `/export/full` (zip) · `/export/json` · `/export/csv` · `/import?dryRun=` · `/backups/status` | portability and backups: the import detects zip/JSON/CSV from the content, the dry run returns the exact report (same transaction, rolled back); backup status reads `backups/last-success` written by `backup.sh` | F5 ✔ |

**Lookup response**
```json
{ "isbn13": "9788432221477", "isbn10": "8432221477", "found": true, "sources": ["Open Library"],
  "proposal": { "title": "…", "subtitle": null, "authors": ["…"], "publisher": "…",
                "publishedYear": 2013, "language": "es", "pages": 240,
                "subjects": ["…"], "description": "…", "coverUrl": "…" },
  "existing": null, "errors": [] }
```

**Full export format** (`library.json`, `"format": "openlibrary"`, versioned `format_version: 1`, schemas in `packages/contracts/src/portability.ts`): arrays `works, editions, copies, locations, reading_sessions, quotes, wishlist, assets` of live records (camelCase fields as in the API, without `version`) with ID-based relations; covers under `assets/<id>.jpg`. Re-importable without loss (it is also the "logical" restore format).

**Import rules**: an id already in the library is a duplicate (skipped, so importing twice changes nothing); an edition whose ISBN exists is a duplicate and its copies/readings/quotes go to the existing edition and work; a record that fails validation or needs a record that is neither in the file nor in the library is invalid; optional links to something missing (location, cover, copy of a quote…) are dropped with a warning; copy codes are kept and a taken code gets a new one. Every created record goes to the change log, so devices pull it. The CSV (one row per copy, columns in `CSV_COLUMNS`, `,` or `;`) creates works, editions, copies, location paths and the latest reading; a row without `code`/`copy_id` for a book already in the library is taken as a duplicate.

---

## 8. Repository structure

```
OpenLibrary/
├── apps/
│   ├── server/            # Fastify + Drizzle + SQLite. src/{auth,catalog,lookup,assets,db}, i18n.ts, cli.ts; drizzle/ (migrations); test/
│   ├── web/               # React + Vite. src/{pages,components,lib,i18n (en/es)}
│   └── android/           # (F2 ✔) Gradle, single `app` module for now: packages core, data (Room), network,
│                          #   sync, ui/{setup,library,detail,locations,settings}; manual DI (AppContainer).
│                          #   i18n/ generates res/values{,-es}/strings.xml from the shared + web catalogs.
│                          #   Split into core/feature modules when F3 makes the build slow enough to matter.
├── packages/
│   └── contracts/         # Zod schemas, ISBN logic, UUIDv7, shared i18n catalog; openapi.yaml (Android
│                          #   surface, checked against real responses) and fixtures/ decoded by Android tests
├── deploy/                # docker-compose.yml, .env.example, systemd/openlibrary-backup.{service,timer}, scripts/{backup,restore,update}.sh + ol (CLI)
├── docs/                  # this document, deployment runbook
└── prototypes/            # clickable prototypes (web and Android, Spanish)
```
Monorepo with **npm workspaces** for the TypeScript side; Android uses its own Gradle build. Its client is small and hand-written (OkHttp + kotlinx.serialization) rather than generated: `openapi.yaml` is the contract, the server test validates real responses against it and writes `fixtures/`, and the Android test decodes those fixtures without ignoring unknown keys, so drift on either side fails CI.

---

## 9. Deployment, backups and restore

**Decided (2026-11-11): Railway** (owner decision, epic #1). The app no longer depends on the owner's Ubuntu PC being on, nor on Tailscale being installed on every device: it runs as the same single container on Railway with a public HTTPS URL. The PC + Tailscale setup of 2026-11-04 stays documented and supported for self-hosters ([self-hosting.md](self-hosting.md)). Why Railway rather than the options in §9.1:

- **Railway volumes made SQLite viable.** The plan of 2026-11-04 assumed that moving to Railway meant Postgres plus S3 for covers. A volume mounted at `/data` keeps the database, the covers and the snapshots as "one folder": no rewrite of the catalog, sync or FTS5 code, and moving away again is copying that folder. Cost of the choice: one replica, and a few seconds without service on every deploy.
- **The real library starts empty.** The owner decided not to migrate the data from the PC: the cutover begins with an empty volume, a new password and a new passkey, and the phone is set up again.
- **No off-site copy, no volume backups.** The library holds nothing sensitive and losing it is acceptable. Railway only offers volume backups on Pro workspaces, and the service runs on Hobby. The only backup is the nightly in-process snapshot on the same volume.
- **Passkeys** replace the planned TOTP second factor (§9.1).
- **Configuration as code:** `.railway/railway.ts` (Railway's Infrastructure as Code, which replaced `railway.json` before 2026-12-01) and `deploy/railway/provision.sh`. Continuous deployment runs from GitHub Actions after CI.

### Deployment
- One Railway service `app` (project `openlibrary`, environment `production`, `europe-west4-drams3a`) built from the root `Dockerfile`, with a volume at `/data`: `library.db`, `assets/`, `backups/`. Variables in the service (`PUBLIC_URL`, `TRUST_PROXY=x-real-ip`, `BACKUP_SCHEDULE=daily`, `ANDROID_CERT_SHA256`…), never in git. Step-by-step guide: [deployment-runbook.md](deployment-runbook.md); service notes and measurements: [railway.md](railway.md).
- Railway starts the container as root because its volumes are owned by root. The server and the CLI hand `/data` to the `node` account and drop to it before opening anything.
- Every push to `main` that changes the image deploys after CI. `/api/v1/health` reports the commit as `version`.
- First run: `set-password` through `railway ssh` sets the owner password (never from the web, so nobody can get there first).

### Backups
- **Nightly in-process snapshot** (`BACKUP_SCHEDULE=daily`), at 03:00 UTC and at boot when the last one is more than a day old: a consistent hot copy of the database, checked for integrity, plus 7 dated copies and `backups/last-success`. The web's Import and export page warns when it is older than 3 days.
- It covers a bad release or a logical mistake, not losing the volume or the project. Covers are not in it.
- The web lets you download the **full export** (zip with every record and cover) at any time: the copy that does not depend on the app.
- Android is in practice another copy of the data (not of the original covers).
- Self-hosted: restic to an external disk, as before ([self-hosting.md](self-hosting.md)).

### Restore
- **Nightly snapshot on Railway**: replace `library.db` with one of the dated snapshots while the server is stopped, then `after-restore`. Step by step in the runbook.
- `after-restore` checks integrity, rebuilds the search index and **bumps the data epoch**: clients detect it and perform a **full resync** (their pending changes are resent and, if they clash, show up as conflicts, never lost).
- Alternative logical restore: import the export zip into a new installation.
- Self-hosted: `deploy/scripts/restore.sh` from restic. The restore drill is automated in CI (§12).

### 9.1 Internet-ready from day one

The app was built as if it were on the Internet while it ran on the PC behind Tailscale, so publishing it (2026-11, Railway) changed the deployment, not the code. Moving it found two gaps, both closed before going public: the global login lockout (a denial-of-service lever, replaced by the throttling below) and the second factor that was never implemented (replaced by passkeys).

**Application requirements (since F0):**
- Always HTTPS; the public URL is configured (`PUBLIC_URL`) and nothing assumes a "trusted" network.
- Argon2id passwords, progressive per-address lockout after failed attempts, bounded admission of password checks (no global lockout, see below) and rate limiting on `/auth/*`.
- `Secure`, `HttpOnly`, `SameSite=Strict` cookies, CSRF protection and security headers (CSP, HSTS).
- Passkey sign-in (WebAuthn) instead of the planned TOTP second factor (owner decision, 2026-11-11): once a passkey is registered, the password alone no longer signs in; it is accepted only with a single-use recovery code. A wrong password and a wrong code count the same for the lockout, so the lockout never reveals which one was right. Last resort: CLI `passkeys-reset`.
- Revocable device tokens; access log visible in the web.
- Covers served only with a session: nothing in the library is accessible unauthenticated.
- All state lives in one folder (`/data` on Railway, `/srv/openlibrary/data` self-hosted), so moving the server means copying a folder or restoring a backup.

**Login throttling on a public URL (2026-11-11).** The first design had a global lockout (100 failures an hour from all addresses → every password check refused for 15 minutes). In a tailnet that was a safety net. On the Internet it is a lever against the owner: 100 wrong passwords an hour, from anywhere, would keep the web login, device registration and password change locked forever. Existing sessions and device tokens would keep working, but nobody could sign in again. It was replaced by limits that degrade instead of denying:

- **Per address, progressive and persistent.** 5 free failures, then a lockout of 1 minute that doubles with every further failure up to 1 hour. The count is forgotten 24 hours after the address's *last* failure, not 15 minutes after its first, so a persistent address does not start over. After the ramp it gets about one guess an hour: roughly 30 the first day and 24 a day after that.
- **Admission gate for password checks** (`auth/gate.ts`). At most 2 Argon2id verifications run at once and the rest wait in a FIFO queue. One check in flight per address, at most 64 waiting from unknown addresses; beyond that the answer is `429` with `Retry-After: 2`. Addresses that signed in successfully in the last 30 days skip ahead of unknown ones.
- **The real client address** comes from `TRUST_PROXY` (on Railway, the `X-Real-IP` header set by its edge), so a client cannot choose its own lockout key.
- **An IPv6 client counts as its /64** (`auth/throttleKey.ts`) for the lockout, the gate and the known addresses: one home or one server controls a whole /64 (2^64 addresses), and keying by the exact address would give an attacker a fresh budget on every attempt. IPv4-mapped IPv6 counts as the IPv4 address. A household or a mobile network behind one /64 shares one budget, which is fine for a single owner; logs keep the full address.
- Failure rows of addresses that stopped failing are pruned, so one-off addresses do not pile up.

*Attack rates against cost.* An Argon2id verification (19 MiB, t=2) costs about 50–100 ms of one core, so the gate caps the server at about 20–40 checks a second: at most ~3 million a day, whatever the attacker owns. The per-address budget is what actually limits them. A botnet of 10,000 addresses gets ~250,000 guesses a day. Against a password of at least 12 characters that is not a dictionary word, that is still decades for any password worth the name. A weak password remains the weak point; passkeys (which turn password-only sign-in off once one is registered) close it.

*What the owner sees during an attack.* From an address that signed in recently: at most the checks already running, a few hundred milliseconds. From a new address: at most a queue of 64 checks shared by 2 slots, about 2–4 seconds, or a "too many requests, retry in 2 s" while more than 64 strangers are waiting at that very moment. Never a lockout that outlasts the attack. A flood big enough to keep the queue full at all times is a denial of service of the whole server, which belongs to the edge (Railway's WAF / rate limits), not to the login.

**Options considered to publish it (2026-11-04):**

| Option | What changes | Cost | Pros | Cons |
|--------|--------------|------|------|------|
| **A. Tailscale** | — | €0 | Private, no open ports, works away from home | Every device needs Tailscale; no web when the PC is off |
| **B. Cloudflare Tunnel from the PC** | Add a `cloudflared` container + domain | ~€10/year (domain) | Web from any browser; no open ports; Cloudflare Access as an extra login layer | Still depends on the PC being on |
| **C. VPS** (Hetzner, OVH…) | Same `docker compose` on another machine + restore a backup | €4–6/month | Web always available; the PC no longer matters | Data on a rented server (encrypted disk and backups) |

Going from A to B or C: roughly **an afternoon of deployment work**. The API, sync and apps do not change; on Android only the server URL changes in Settings.

**Decided (2026-11-04): option A**, zero cost. Vercel (web) + Railway (API + Postgres) was also evaluated: viable, but it needs an own domain (cross-site cookies), private storage for covers and a monthly usage-based cost. Discarded for the MVP.

**Superseded (2026-11-11): Railway**, see §9. The worry about cross-site cookies did not apply because the web is served by the same process (same origin, the generated `*.up.railway.app` domain is enough), and the move to Postgres + S3 was not needed thanks to volumes. The usage-based cost (about $2/month of usage, inside the Hobby plan's $5) is accepted by the owner.

---

## 10. MVP plan by phases

| Phase | Content | Verifiable acceptance criteria |
|-------|---------|--------------------------------|
| **F0 · Foundations** (1 wk) | Monorepo, CI (lint, test, build), DB schema + migrations, auth (login, devices), Docker Compose + `tailscale serve`, backup/restore scripts **(done 2026-11-04)** | `docker compose up` on Ubuntu serves `/api/v1/health` over HTTPS on the tailnet; password login; no access from outside the tailnet; backup produces a verifiable restic snapshot |
| **F1 · Web catalog** (2 wk) | CRUD work/edition/copy/location, manual entry, ISBN lookup (proxy), covers, FTS search + filters + sorting, details view, location tree **(done 2026-11-04)**; bilingual UI EN/ES | Manual entry without ISBN ✔; ISBN → editable proposal ✔; 2 copies of one edition without duplicating it ✔; filtering by "Living room › Bookcase" includes child shelves ✔; search < 150 ms with 10,000 synthetic copies ✔ (4–46 ms) |
| **F2 · Android browsing + sync pull** (2 wk) | Room + FTS, snapshot + incremental pull, cover cache, offline list/search/details/locations, sync status, EN/ES **(done 2026-11-04)** | With the PC off, the whole library and its covers can be browsed and searched ✔ (checked on a Galaxy S26 Ultra; covers by unit test); a change made on the web appears on Android after syncing ✔ |
| **F3 · Android capture + offline writes** (3 wk) | Scanner, provisional entry, cover photos, editing copies/reading/notes, outbox + idempotent push, conflicts **(done 2026-11-04; reading status moves to F4)** | Full UC01 flow ✔ (lookup, owned-edition warning, provisional offline entry, provider cover; camera scan and photo pending a check on the phone); changes made offline survive killing the app and rebooting ✔ (emulator); resending the same batch 3 times does not duplicate ✔; editing the same field on web and Android produces a visible conflict ✔ |
| **F4 · Reading, wishlist, statistics** (1.5 wk) | Reading sessions and re-reads, quotes, wishlist → acquisition, statistics (works vs copies) **(done 2026-11-04: web + Android, synced)** | "I bought it" creates a copy without duplicating the work ✔; stats match reference SQL queries ✔ (`stats.test.ts`), and Android's offline stats match the server's on the same data ✔ (`StatsParityTest`) |
| **F5 · Portability and hardening** (1.5 wk) **(done 2026-11-05)** | CSV/JSON+zip export, import (own format) with dry-run and report, restore + resync, app lock, local encryption, accessibility, performance, bulk insert path | Export → clean install → import = same counts and relations ✔; restore.sh recovers last night's backup ✔ (`restore-drill.test.ts`); import reports duplicates and invalid rows ✔; bulk entry: scanning a shelf saves every book, offline too, never twice ✔ (`BulkScanTest`); 10,000 copies on the phone: first sync ~1 s, search ~5 ms, a local change ~10 ms on the JVM ✔ (`PerformanceTest`); accessibility pass: labelled controls, landmarks, skip link, visible focus, AA contrast, reduced motion, focus handling in panels ✔ |

Indicative total: **~11 weeks** part-time. Every phase ends with something usable.

**Traceability with §19 of the definition**: no ISBN → F1; scanning → F3; fixing data → F1/F3; several copies → F1; locating by location → F1/F2; reading status → F3/F4; offline search → F2; PC off → F2; offline changes → F3; no duplicates → F3; conflicts → F3; export/restore → F5; privacy → F0/F5.

---

## 11. Risks

| ID | Risk | Prob. | Impact | Mitigation |
|----|------|:-----:|:------:|------------|
| R1 | Poor metadata for Spanish / old books | High | Medium | Two providers + BNE later; fast manual entry; cover photos; never block creation |
| R2 | Subtle sync bugs (loss/duplication) | Medium | High | Simple protocol (outbox + cursor), property-based and fault-injection tests, readable sync logs |
| R3 | Loss of the Railway volume or project (no volume backups on Hobby, no off-site copy) | Low | Medium (accepted by the owner) | Nightly snapshot for logical mistakes; the full export zip can be downloaded any time; Android holds a copy of the records |
| R4 | The phone cannot reach the server (network, Railway outage, a deploy) | Medium | Low | Offline is the normal mode; clear status; automatic retries |
| R5 | Restoring a backup "breaks" clients with newer data | Low | High | `epoch` + full resync that keeps pending ops as conflicts |
| R6 | Scanning in low light / EAN-5 add-on | Medium | Low | Torch, manual ISBN entry, add-on ignored |
| R7 | Scope too large for a personal project | High | Medium | Deliverable phases; non-MVP items in the backlog; web and Android share contracts |
| R8 | Provider API changes/outages | Medium | Low | Adapter layer + lookup cache; stored data does not depend on them |
| R9 | Private data leak (lost phone) | Low | Medium | SQLCipher, biometric lock, revoke the token from the web |
| R10 | Translations drifting apart | Medium | Low | Spanish dictionaries type-checked against English; server catalog parity test |
| R11 | Public exposure: brute force, abuse of the login, scanning | Medium | High | Passkeys (password alone refused once one exists), per-address lockout with the real client address from Railway's edge, bounded admission of password checks, rate limits, security headers; nothing readable without a session |
| R12 | Provider lock-in or price change | Low | Low | Standard Docker image and one data folder; the self-hosting path stays supported; `provision.sh` and `.railway/railway.ts` document the whole setup |

---

## 12. Testing strategy

| Level | What | Tools |
|-------|------|-------|
| Unit | ISBN (shared TS/Kotlin vectors: valid, invalid, ISSN, ISMN, X), reading rules, field merge, status derivation, location cycles, language negotiation, cover-text title/author heuristics | Vitest, JUnit5 + Kotest |
| Property | Sync convergence: random op sequences on 2 replicas + reordering + duplication ⇒ same final state or an explicit conflict, never loss | fast-check (server), Kotest property |
| Contract | Server conforms to `openapi.yaml`; the generated Android client compiles against it; response snapshots | Schemathesis / Dredd, deserialisation tests |
| Server integration | Real API + temporary SQLite: CRUD, search, text lookup, import/export round trip, `/sync/push` idempotency, messages in both languages | Vitest + Fastify inject |
| Network faults | Fault proxy (Toxiproxy) between app and server: cut **after** the server commits and before the response arrives → retry ⇒ `duplicate`, no duplication; high latency; intermittent 500; server shut down mid-batch | Toxiproxy, MockWebServer (Android) |
| Android | Room + migrations, outbox survives process death, WorkManager retries, Compose UI (offline search, scan flow with a test image) | Robolectric, Compose UI tests, WorkManager TestDriver |
| Web E2E | Add, details, locations, wishlist, import with a broken file, language switch | Playwright |
| Backups | CI job: create data → backup → delete → restore → compare counts and integrity | script + ephemeral container |
| Performance | 10,000 synthetic copies: web search < 150 ms (✔ F1), Android < 100 ms, initial snapshot < 10 s on LAN | Vitest benchmark, Macrobenchmark |
| Manual (per-release checklist) | Airplane mode, PC off, PC reboot during sync, two devices editing, low-light scanning, both languages | scenario matrix in `docs/qa-checklist.md` |

---

## 13. Beyond the MVP — evolutions with real value
1. **BNE (Spanish National Library)** as a metadata provider (big improvement for Spanish books).
2. **Loans** (to whom, when) — fits the model as an entity on `Copy`.
3. **QR labels per shelf/copy** (the `EJ-0001` code already prepares for it).
4. **Offline web PWA** (the architecture does not prevent it).
5. Several photos per copy (dedications, condition).
6. Series as an entity, translators per edition.
7. Suggest the existing work when adding an edition in another language (e.g. "Nineteen Eighty-Four" for "1984").
8. Re-rank cover-search candidates by visual similarity (image embeddings) or fall back to a vision model when OCR fails: deferred. OCR + text search covers the normal case at zero cost and without a large model in the APK.

---

## 14. Prototypes
Clickable, dependency-free, with sample data (`prototypes/shared/data.js`). They predate the bilingual decision and are in Spanish; they are kept as design references and are not maintained:
- **Web**: `prototypes/web/index.html` — catalog, search, filters, work/edition/copy details, locations, wishlist, statistics, import/export, sync and backups.
- **Android**: `prototypes/android/index.html` — phone frame with a scenario panel (PC on/off, Internet yes/no, network faults, conflicts) to try scanning, cover photos, details, locations, wishlist and the sync queue.
