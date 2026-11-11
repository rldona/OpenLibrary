import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackupScheduler, type Timers } from '../src/backup.js';
import { openDb } from '../src/db/client.js';
import { makeApp, webClient } from './helpers.js';

/** A fake clock and timers: nothing runs until the test fires the pending timer. */
function harness(opts: { lastSuccess?: string; keep?: number; check?: (f: string) => string } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-backup-'));
  const db = openDb(path.join(dataDir, 'library.db'));
  const backups = path.join(dataDir, 'backups');
  if (opts.lastSuccess) {
    fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(backups, 'last-success'), `${opts.lastSuccess}\n`);
  }
  const clock = { t: new Date('2026-11-11T15:00:00Z').getTime() };
  const pending: { fn: () => void; ms: number }[] = [];
  const timers: Timers = {
    set: (fn, ms) => pending.push({ fn, ms }),
    clear: () => (pending.length = 0),
  };
  const logs: { level: string; msg: string; obj: object }[] = [];
  const log = {
    info: (obj: object, msg: string) => logs.push({ level: 'info', msg, obj }),
    error: (obj: object, msg: string) => logs.push({ level: 'error', msg, obj }),
  };
  const scheduler = new BackupScheduler({
    db,
    dataDir,
    keep: opts.keep ?? 7,
    log,
    now: () => new Date(clock.t),
    timers,
    ...(opts.check ? { check: opts.check } : {}),
  });
  /** Advances the clock to the pending timer, fires it and waits for the backup it starts. */
  const fire = async () => {
    const next = pending.shift()!;
    clock.t += next.ms;
    next.fn();
    await scheduler.runOnce();
  };
  const files = () => fs.readdirSync(backups).sort();
  return { db, dataDir, backups, scheduler, pending, fire, logs, files, clock };
}

describe('in-process backups', () => {
  it('runs at boot when it never ran, then every night at 03:00 UTC', async () => {
    const h = harness();
    h.scheduler.start();
    expect(h.pending.map((p) => p.ms)).toEqual([0]);
    await h.fire();
    expect(h.files()).toEqual(['last-success', 'library-2026-11-11.db', 'library.db']);
    expect(fs.readFileSync(path.join(h.backups, 'last-success'), 'utf8')).toBe('2026-11-11T15:00:00.000Z\n');
    // Next: 03:00 UTC tomorrow, 12 hours later.
    expect(h.pending.map((p) => p.ms)).toEqual([12 * 3600_000]);
    await h.fire();
    expect(h.files()).toContain('library-2026-11-12.db');
    expect(h.logs.filter((l) => l.level === 'info').map((l) => l.msg)).toEqual([
      'backup completed',
      'backup completed',
    ]);
    // The snapshot is a usable database.
    const copy = openDb(path.join(h.backups, 'library.db'));
    expect(copy.$client.pragma('integrity_check', { simple: true })).toBe('ok');
    copy.$client.close();
    await h.scheduler.stop();
    expect(h.pending).toEqual([]);
  });

  it('skips the boot run when the last success is fresh', () => {
    const h = harness({ lastSuccess: '2026-11-11T03:00:05Z' });
    h.scheduler.start();
    expect(h.pending.map((p) => p.ms)).toEqual([12 * 3600_000]);
    expect(fs.readdirSync(h.backups)).toEqual(['last-success']);
  });

  it('runs at boot when the last success is more than a day old', () => {
    const h = harness({ lastSuccess: '2026-11-10T14:59:00Z' });
    h.scheduler.start();
    expect(h.pending.map((p) => p.ms)).toEqual([0]);
  });

  it('keeps only the newest dated snapshots', async () => {
    const h = harness({ keep: 3 });
    fs.mkdirSync(h.backups, { recursive: true });
    for (const d of ['2026-11-01', '2026-11-05', '2026-11-08', '2026-11-10']) {
      fs.writeFileSync(path.join(h.backups, `library-${d}.db`), '');
    }
    fs.writeFileSync(path.join(h.backups, 'notes.txt'), 'not ours');
    expect(await h.scheduler.runOnce()).toBe(true);
    expect(h.files()).toEqual([
      'last-success',
      'library-2026-11-08.db',
      'library-2026-11-10.db',
      'library-2026-11-11.db',
      'library.db',
      'notes.txt',
    ]);
  });

  it('a failed integrity check keeps the previous snapshot and last-success, and logs an error', async () => {
    let result = 'ok';
    const h = harness({ check: () => result });
    expect(await h.scheduler.runOnce()).toBe(true);
    const previous = fs.readFileSync(path.join(h.backups, 'library.db'));
    h.clock.t += 24 * 3600_000;
    result = '*** in database main *** Page 3: btree damaged';
    expect(await h.scheduler.runOnce()).toBe(false);
    expect(fs.readFileSync(path.join(h.backups, 'last-success'), 'utf8')).toBe('2026-11-11T15:00:00.000Z\n');
    expect(fs.readFileSync(path.join(h.backups, 'library.db'))).toEqual(previous);
    expect(h.files()).not.toContain('library-2026-11-12.db');
    expect(h.files().some((f) => f.endsWith('.tmp'))).toBe(false);
    const err = h.logs.find((l) => l.level === 'error')!;
    expect(err.msg).toBe('backup failed');
    expect(String((err.obj as { err: Error }).err.message)).toContain('integrity check');
  });

  it('a failed run is retried the next night and keeps the schedule going', async () => {
    const h = harness({ check: () => 'broken' });
    h.scheduler.start();
    await h.fire();
    expect(h.pending.map((p) => p.ms)).toEqual([0]);
  });

  it('GET /backups/status reflects the in-process backup', async () => {
    const { app, db, dataDir } = await makeApp();
    const c = await webClient(app);
    expect((await c.get('/backups/status')).body).toEqual({ lastSuccessAt: null, stale: true });
    const scheduler = new BackupScheduler({
      db,
      dataDir,
      keep: 7,
      log: { info: () => undefined, error: () => undefined },
      now: () => new Date('2026-11-04T09:00:00Z'),
    });
    expect(await scheduler.runOnce()).toBe(true);
    expect((await c.get('/backups/status')).body).toEqual({
      lastSuccessAt: '2026-11-04T09:00:00.000Z',
      stale: false,
    });
  });
});
