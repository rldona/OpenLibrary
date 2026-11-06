import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@openlibrary/contracts';
import { getMeta, openDb } from '../src/db/client.js';
import { CatalogService } from '../src/catalog/service.js';
import { SyncService } from '../src/sync/service.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ol-test-'));
const cli = (dataDir: string, ...args: string[]) =>
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    env: { ...process.env, DATA_DIR: dataDir, OL_PASSWORD: 'a long password', NODE_ENV: 'test' },
    encoding: 'utf8',
  });

describe('database', () => {
  it('migrations are idempotent and the epoch persists', () => {
    const dir = tmp();
    const file = path.join(dir, 'library.db');
    const a = openDb(file);
    const epoch = getMeta(a, 'epoch');
    a.$client.close();
    const b = openDb(file);
    expect(getMeta(b, 'epoch')).toBe(epoch);
    expect(b.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    b.$client.close();
  });
});

describe('migration 0008: delete discarded wishes', () => {
  const drizzleDir = fileURLToPath(new URL('../drizzle', import.meta.url));
  const migration = fs
    .readFileSync(path.join(drizzleDir, '0008_delete_discarded_wishes.sql'), 'utf8')
    .split('--> statement-breakpoint');

  /** A database migrated up to 0007, as it is in production before this release. */
  function before0008(file: string) {
    const folder = path.join(tmp(), 'drizzle');
    fs.cpSync(drizzleDir, folder, { recursive: true });
    const journalFile = path.join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag < '0008');
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    const sqlite = new Database(file);
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    return sqlite;
  }

  it('tombstones live discarded wishes once, like softDelete, and devices get them on pull', () => {
    const file = path.join(tmp(), 'library.db');
    const old = before0008(file);
    const insert = old.prepare(
      `INSERT INTO wishlist_items (id, version, created_at, updated_at, deleted_at, title, status)
       VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?, ?)`,
    );
    const ids = {
      open: uuidv7(),
      acquired: uuidv7(),
      discarded: uuidv7(),
      discarded2: uuidv7(),
      gone: uuidv7(),
    };
    insert.run(ids.open, 1, null, 'Open', 'open');
    insert.run(ids.acquired, 2, null, 'Bought', 'acquired');
    insert.run(ids.discarded, 2, null, 'Discarded', 'discarded');
    insert.run(ids.discarded2, 1, null, 'Discarded too', 'discarded');
    insert.run(ids.gone, 3, '2026-02-01T00:00:00.000Z', 'Already deleted', 'discarded');
    old.close();

    const db = openDb(file);
    const sql = db.$client;
    const wishes = () =>
      Object.fromEntries(
        (
          sql.prepare('SELECT id, version, deleted_at, updated_at FROM wishlist_items').all() as {
            id: string;
            version: number;
            deleted_at: string | null;
            updated_at: string;
          }[]
        ).map((w) => [w.id, w]),
      );
    const log = () =>
      sql
        .prepare(
          "SELECT entity_id, op, version, fields, session_id, at FROM change_log WHERE entity = 'wish'",
        )
        .all() as {
        entity_id: string;
        op: string;
        version: number;
        fields: string;
        session_id: string | null;
        at: string;
      }[];

    const after = wishes();
    expect(after[ids.open]).toMatchObject({ version: 1, deleted_at: null });
    expect(after[ids.acquired]).toMatchObject({ version: 2, deleted_at: null });
    expect(after[ids.gone]).toMatchObject({ version: 3, deleted_at: '2026-02-01T00:00:00.000Z' });
    for (const [id, version] of [
      [ids.discarded, 3],
      [ids.discarded2, 2],
    ] as const) {
      expect(after[id]!.version).toBe(version);
      expect(after[id]!.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(after[id]!.updated_at).toBe(after[id]!.deleted_at);
      const rows = log().filter((r) => r.entity_id === id);
      expect(rows).toEqual([
        { entity_id: id, op: 'delete', version, fields: '{}', session_id: null, at: after[id]!.deleted_at },
      ]);
    }
    expect(log()).toHaveLength(2);

    // Running it again (or reopening the database) changes nothing.
    for (const statement of migration) sql.exec(statement);
    db.$client.close();
    const again = openDb(file);
    const sql2 = again.$client;
    expect(sql2.prepare("SELECT count(*) n FROM change_log WHERE entity = 'wish'").get()).toEqual({ n: 2 });
    expect(sql2.prepare('SELECT id, version, deleted_at FROM wishlist_items ORDER BY id').all()).toEqual(
      Object.values(after)
        .map(({ id, version, deleted_at }) => ({ id, version, deleted_at }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );

    // A device whose cursor predates the migration receives the tombstones.
    const sync = new SyncService(again, new CatalogService(again));
    const page = sync.pull({ since: 0, epoch: getMeta(again, 'epoch')!, limit: 500 });
    expect(page.deleted.map((d) => d.id).sort()).toEqual([ids.discarded, ids.discarded2].sort());
    expect(page.deleted.every((d) => d.entity === 'wish')).toBe(true);
    again.$client.close();
  });
});

describe('admin CLI', () => {
  it('set-password, backup, after-restore and check', () => {
    const dir = tmp();
    expect(cli(dir, 'set-password')).toContain('Password created');
    const out = path.join(dir, 'backups', 'snap.db');
    expect(cli(dir, 'backup', out)).toContain('Backup created');

    // The copy is a valid DB with the owner and the same epoch.
    const copy = openDb(out);
    const original = openDb(path.join(dir, 'library.db'));
    expect(getMeta(copy, 'epoch')).toBe(getMeta(original, 'epoch'));
    expect(copy.$client.prepare('select count(*) n from owner').get()).toEqual({ n: 1 });
    const before = getMeta(original, 'epoch');
    copy.$client.close();
    original.$client.close();

    expect(cli(dir, 'after-restore')).toContain('New epoch');
    const after = openDb(path.join(dir, 'library.db'));
    expect(getMeta(after, 'epoch')).not.toBe(before);
    after.$client.close();
    expect(cli(dir, 'check')).toContain('Integrity: ok');
  });
});
