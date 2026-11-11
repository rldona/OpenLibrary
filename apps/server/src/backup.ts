import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Db } from './db/client.js';

/** `PRAGMA integrity_check` of an open database: "ok" or the first problems found. */
export const integrityOf = (sqlite: Database.Database) =>
  String(sqlite.pragma('integrity_check', { simple: true }));

/** Integrity check of a database file, opened read-only. */
export function fileIntegrity(file: string): string {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return integrityOf(sqlite);
  } finally {
    sqlite.close();
  }
}

/**
 * Consistent hot copy of the database to `out` (tmp + rename: `out` is never half written).
 * With `check`, the copy must pass it ("ok") before it replaces `out`.
 */
export async function snapshot(
  db: Db,
  out: string,
  opts: { check?: (file: string) => string } = {},
): Promise<number> {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const tmp = `${out}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    await db.$client.backup(tmp);
    // The copy inherits WAL mode: make it one self-contained file (no -wal/-shm beside it).
    const copy = new Database(tmp, { fileMustExist: true });
    copy.pragma('journal_mode = DELETE');
    copy.close();
    const r = opts.check?.(tmp) ?? 'ok';
    if (r !== 'ok') throw new Error(`the snapshot failed the integrity check: ${r}`);
    fs.renameSync(tmp, out);
  } finally {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
  }
  return fs.statSync(out).size;
}

export type BackupLog = {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms).unref(),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

const DAY_MS = 24 * 60 * 60_000;
/** Nightly run at this hour, UTC. */
const RUN_AT_UTC_HOUR = 3;

/**
 * Nightly backup inside the server process, for hosts without a scheduler of their own (Railway):
 * snapshot to `backups/library.db` (the same file the CLI `backup` and restic use), integrity check,
 * a dated copy `backups/library-YYYY-MM-DD.db` keeping the newest `keep`, then `backups/last-success`
 * (read by GET /backups/status). Runs at boot too when the last success is more than a day old.
 * Covers (`assets/`) are not copied: this layer only protects the database.
 */
export class BackupScheduler {
  private handle: unknown;
  private running: Promise<boolean> | undefined;
  private stopped = false;
  private readonly dir: string;

  constructor(
    private readonly opts: {
      db: Db;
      dataDir: string;
      keep: number;
      log: BackupLog;
      now?: () => Date;
      timers?: Timers;
      /** Integrity check of the new snapshot (tests replace it). */
      check?: (file: string) => string;
    },
  ) {
    this.dir = path.join(opts.dataDir, 'backups');
  }

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  private get timers(): Timers {
    return this.opts.timers ?? realTimers;
  }

  lastSuccess(): Date | null {
    try {
      const t = Date.parse(fs.readFileSync(path.join(this.dir, 'last-success'), 'utf8').trim());
      return Number.isNaN(t) ? null : new Date(t);
    } catch {
      return null;
    }
  }

  /** When the next backup should run: now if the last success is missing or a day old, else tonight. */
  nextRunAt(): Date {
    const now = this.now();
    const last = this.lastSuccess();
    if (!last || now.getTime() - last.getTime() >= DAY_MS) return now;
    const next = new Date(now);
    next.setUTCHours(RUN_AT_UTC_HOUR, 0, 0, 0);
    if (next <= now) next.setTime(next.getTime() + DAY_MS);
    return next;
  }

  start(): this {
    this.stopped = false;
    this.schedule();
    return this;
  }

  /** Cancels the timer and waits for a backup in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.handle !== undefined) this.timers.clear(this.handle);
    this.handle = undefined;
    await this.running;
  }

  /** One backup now. Returns whether it succeeded; failures are logged, never thrown. */
  runOnce(): Promise<boolean> {
    this.running ??= this.backup().finally(() => (this.running = undefined));
    return this.running;
  }

  private schedule(): void {
    if (this.stopped) return;
    const wait = Math.max(0, this.nextRunAt().getTime() - this.now().getTime());
    this.handle = this.timers.set(() => {
      this.handle = undefined;
      void this.runOnce().then(() => this.schedule());
    }, wait);
  }

  private async backup(): Promise<boolean> {
    const started = this.now();
    try {
      const latest = path.join(this.dir, 'library.db');
      const bytes = await snapshot(this.opts.db, latest, { check: this.opts.check ?? fileIntegrity });
      fs.copyFileSync(latest, path.join(this.dir, `library-${started.toISOString().slice(0, 10)}.db`));
      const pruned = this.prune();
      fs.writeFileSync(path.join(this.dir, 'last-success'), `${started.toISOString()}\n`);
      this.opts.log.info({ bytes, pruned }, 'backup completed');
      return true;
    } catch (e) {
      this.opts.log.error({ err: e }, 'backup failed');
      return false;
    }
  }

  /** Removes dated snapshots beyond the newest `keep`. Returns the removed file names. */
  private prune(): string[] {
    const dated = fs
      .readdirSync(this.dir)
      .filter((f) => /^library-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse();
    const old = dated.slice(this.opts.keep);
    for (const f of old) fs.rmSync(path.join(this.dir, f), { force: true });
    return old;
  }
}
