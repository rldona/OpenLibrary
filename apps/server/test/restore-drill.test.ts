/**
 * Restore drill (design §9, §12), with the same CLI commands restore.sh runs: back up, keep working,
 * put the backup back, `after-restore`. The library is the one from the backup, the search index is
 * rebuilt and the epoch changes so every device performs a full resync.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getMeta, openDb } from '../src/db/client.js';
import { CatalogService } from '../src/catalog/service.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX = path.join(ROOT, '../../node_modules/.bin/tsx');

describe('restore drill', () => {
  it('backup → more changes → restore gives back the backed-up library with a new epoch', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-drill-'));
    const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: dataDir, LOG_LEVEL: 'silent' };
    const cli = (...args: string[]) =>
      execFileSync(TSX, ['src/cli.ts', ...args], { cwd: ROOT, env, encoding: 'utf8' });
    const dbFile = path.join(dataDir, 'library.db');
    const backupFile = path.join(dataDir, 'backups', 'library.db');

    cli('demo-data', 'es');
    const before = openDb(dbFile);
    const epoch = getMeta(before, 'epoch');
    const count = (c: CatalogService, q?: string) =>
      c.library({ q, sort: 'title', limit: 1, offset: 0 }).total;
    const total = count(new CatalogService(before));
    before.$client.close();
    expect(total).toBeGreaterThan(0);

    cli('backup', backupFile);
    const after = openDb(dbFile);
    new CatalogService(after).createBook({
      work: { title: 'Escrito después de la copia', authors: [], subjects: [] },
      edition: { metadataStatus: 'complete' },
      copy: { condition: 'good', priceCurrency: 'EUR', notes: '' },
      allowDuplicateIsbn: false,
    } as never);
    expect(count(new CatalogService(after))).toBe(total + 1);
    after.$client.close();

    // What restore.sh does once the app is stopped: set the current state aside, put the backup in place.
    for (const f of ['library.db', 'library.db-wal', 'library.db-shm']) {
      if (fs.existsSync(path.join(dataDir, f)))
        fs.renameSync(path.join(dataDir, f), path.join(dataDir, `${f}.before`));
    }
    fs.copyFileSync(backupFile, dbFile);
    expect(cli('after-restore')).toContain('Restore verified');

    const restored = openDb(dbFile);
    const catalog = new CatalogService(restored);
    expect(count(catalog)).toBe(total);
    expect(count(catalog, 'después')).toBe(0);
    expect(getMeta(restored, 'epoch')).not.toBe(epoch);
    expect(String(restored.$client.pragma('integrity_check', { simple: true }))).toBe('ok');
    restored.$client.close();
  }, 60_000);
});
