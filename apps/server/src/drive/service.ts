/**
 * Backups to Google Drive, manual or every 1/5/10/15 minutes.
 *
 * Layout in the owner's Drive:
 *   OpenLibrary backups/
 *     library-2026-11-13T10-15-00Z.db.gz   consistent hot copy of the database (gzip)
 *     covers/<sha256>.jpg, <sha256>.thumb.jpg
 * Covers are content-addressed and never change, so each one is uploaded only once.
 *
 * Automatic runs only upload when the library changed since the last successful backup,
 * so a 1-minute interval costs nothing while nobody is editing.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { count, max } from 'drizzle-orm';
import {
  API_PREFIX,
  DRIVE_BACKUP_INTERVALS,
  type DriveBackupInterval,
  type DriveBackupStatus,
  type Params,
} from '@openlibrary/contracts';
import { fileIntegrity, snapshot } from '../backup.js';
import type { Config } from '../config.js';
import { deleteMeta, getMeta, setMeta, type Db } from '../db/client.js';
import { assets, changeLog } from '../db/schema.js';
import { HttpError } from '../errors.js';
import type { Fetch } from '../lookup/providers.js';
import { authUrl, DriveClient, DriveError, exchangeCode, revokeToken, type OAuthClient } from './client.js';

export const ROOT_FOLDER = 'OpenLibrary backups';
const COVERS_FOLDER = 'covers';
const DB_FILE_RE = /^library-(\d{4}-\d{2}-\d{2})T[\d-]+Z\.db\.gz$/;
const STATE_TTL_MS = 10 * 60_000;
const TICK_MS = 15_000;
/** Retention: the newest 24 database copies, plus the newest of each of the last 30 days. */
export const KEEP_RECENT = 24;
export const KEEP_DAYS = 30;

type DriveState = {
  refreshToken: string;
  account: string | null;
  connectedAt: string;
  folderId?: string;
  coversFolderId?: string;
};

type Translate = (key: string, params?: Params) => string;
type StoredError = { key: string; params?: Params };

export type RunResult = { file: string; coversUploaded: number; deleted: number };

const M = {
  interval: 'backup.intervalMinutes',
  lastAttemptAt: 'backup.lastAttemptAt',
  lastSuccessAt: 'backup.lastSuccessAt',
  lastFile: 'backup.lastFile',
  lastError: 'backup.lastError',
  fingerprint: 'backup.fingerprint',
} as const;

/** Picks which database copies to delete (names sort chronologically). */
export function filesToPrune<T extends { name: string }>(files: T[]): T[] {
  const db = files.filter((f) => DB_FILE_RE.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : -1));
  const keep = new Set(db.slice(0, KEEP_RECENT));
  const days = new Set<string>();
  for (const f of db) {
    const day = DB_FILE_RE.exec(f.name)![1]!;
    if (days.has(day)) continue;
    if (days.size >= KEEP_DAYS) break;
    days.add(day);
    keep.add(f);
  }
  return db.filter((f) => !keep.has(f));
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');

export class DriveBackupService {
  private running: Promise<RunResult> | null = null;
  private client: DriveClient | null = null;
  private readonly states = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly assetPath: (id: string, size: 'full' | 'thumb') => string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void } = {
      info: () => undefined,
      warn: () => undefined,
    },
  ) {}

  // ---------- state ----------

  private get oauth(): OAuthClient | null {
    const g = this.config.google;
    if (!g) return null;
    const redirectUri = `${this.config.publicUrl.origin}${API_PREFIX}/backups/drive/callback`;
    return { ...g, redirectUri };
  }

  private readState(): DriveState | null {
    try {
      return JSON.parse(fs.readFileSync(this.config.driveStateFile, 'utf8')) as DriveState;
    } catch {
      return null;
    }
  }

  private writeState(s: DriveState): void {
    const file = this.config.driveStateFile;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  private driveClient(s: DriveState): DriveClient {
    const oauth = this.oauth;
    if (!oauth) throw new HttpError(503, 'drive-not-configured', 'errors.driveNotConfigured');
    if (this.client?.refreshToken !== s.refreshToken) {
      this.client = new DriveClient(this.fetchImpl, oauth, s.refreshToken, this.now);
    }
    return this.client;
  }

  get interval(): DriveBackupInterval {
    const n = Number(getMeta(this.db, M.interval) ?? 0);
    return (DRIVE_BACKUP_INTERVALS as readonly number[]).includes(n) ? (n as DriveBackupInterval) : 0;
  }

  setInterval(minutes: DriveBackupInterval): void {
    setMeta(this.db, M.interval, String(minutes));
  }

  /** Changes whenever catalog data or covers change (or a backup is restored). */
  private fingerprint(): string {
    const seq =
      this.db
        .select({ v: max(changeLog.seq) })
        .from(changeLog)
        .get()?.v ?? 0;
    const covers = this.db.select({ n: count() }).from(assets).get()?.n ?? 0;
    return `${getMeta(this.db, 'epoch')}:${seq}:${covers}`;
  }

  status(t: Translate): DriveBackupStatus {
    const s = this.readState();
    const connected = !!s && !!this.oauth;
    const interval = this.interval;
    const lastAttemptAt = getMeta(this.db, M.lastAttemptAt) ?? null;
    const rawError = getMeta(this.db, M.lastError);
    const err = rawError ? (JSON.parse(rawError) as StoredError) : null;
    let nextCheckAt: string | null = null;
    if (connected && interval > 0) {
      const due = lastAttemptAt ? new Date(lastAttemptAt).getTime() + interval * 60_000 : 0;
      nextCheckAt = new Date(Math.max(due, this.now().getTime())).toISOString();
    }
    return {
      drive: { available: !!this.oauth, connected, account: s?.account ?? null },
      intervalMinutes: interval,
      running: !!this.running,
      upToDate: getMeta(this.db, M.fingerprint) === this.fingerprint(),
      lastAttemptAt,
      lastSuccessAt: getMeta(this.db, M.lastSuccessAt) ?? null,
      lastFile: getMeta(this.db, M.lastFile) ?? null,
      lastError: err ? t(err.key, err.params) : null,
      nextCheckAt,
    };
  }

  // ---------- connecting ----------

  /** Google consent URL. The state is single-use and expires in 10 minutes. */
  connectUrl(): string {
    const oauth = this.oauth;
    if (!oauth) throw new HttpError(503, 'drive-not-configured', 'errors.driveNotConfigured');
    const now = this.now().getTime();
    for (const [k, exp] of this.states) if (exp < now) this.states.delete(k);
    const state = randomBytes(24).toString('base64url');
    this.states.set(state, now + STATE_TTL_MS);
    return authUrl(oauth, state);
  }

  /** Callback from Google. Returns the outcome shown by the web app. */
  async completeConnect(q: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<'connected' | 'denied' | 'expired' | 'failed'> {
    const exp = q.state ? this.states.get(q.state) : undefined;
    if (q.state) this.states.delete(q.state);
    if (!exp || exp < this.now().getTime()) return 'expired';
    if (q.error || !q.code) return 'denied';
    const oauth = this.oauth;
    if (!oauth) return 'failed';
    try {
      const t = await exchangeCode(this.fetchImpl, oauth, q.code);
      const client = new DriveClient(this.fetchImpl, oauth, t.refreshToken, this.now);
      client.seed(t.accessToken, t.expiresIn);
      const previous = this.readState();
      this.client = client;
      this.writeState({
        refreshToken: t.refreshToken,
        account: await client.account(),
        connectedAt: this.now().toISOString(),
        // Same account again: keep using the same folder.
        ...(previous ? { folderId: previous.folderId, coversFolderId: previous.coversFolderId } : {}),
      });
      deleteMeta(this.db, M.lastError);
      this.log.info({}, 'google drive connected');
      return 'connected';
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'google drive connection failed');
      return 'failed';
    }
  }

  async disconnect(): Promise<void> {
    const s = this.readState();
    if (s) await revokeToken(this.fetchImpl, s.refreshToken);
    fs.rmSync(this.config.driveStateFile, { force: true });
    this.client = null;
    deleteMeta(this.db, M.lastError);
    deleteMeta(this.db, M.fingerprint);
    this.log.info({}, 'google drive disconnected');
  }

  // ---------- running ----------

  /** Starts a backup in the background (manual "Back up now"). */
  start(): void {
    void this.run().catch(() => undefined);
  }

  run(): Promise<RunResult> {
    if (this.running) throw new HttpError(409, 'backup-running', 'errors.backupRunning');
    const s = this.readState();
    if (!s || !this.oauth) throw new HttpError(409, 'drive-not-connected', 'errors.driveNotConnected');
    this.running = this.doRun(s).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Waits for the backup in progress, if any (tests and shutdown). */
  async idle(): Promise<void> {
    await this.running?.catch(() => undefined);
  }

  private async doRun(s: DriveState): Promise<RunResult> {
    const started = this.now();
    setMeta(this.db, M.lastAttemptAt, started.toISOString());
    const fingerprint = this.fingerprint();
    const tmp = path.join(this.config.dataDir, 'backups', 'drive-upload.db');
    try {
      const drive = this.driveClient(s);
      const folderId = await drive.ensureFolder(ROOT_FOLDER, null, s.folderId);
      const coversFolderId = await drive.ensureFolder(
        COVERS_FOLDER,
        folderId,
        folderId === s.folderId ? s.coversFolderId : undefined,
      );
      if (folderId !== s.folderId || coversFolderId !== s.coversFolderId) {
        s = { ...s, folderId, coversFolderId };
        this.writeState(s);
      }

      await snapshot(this.db, tmp, { check: fileIntegrity });
      const file = `library-${stamp(started)}.db.gz`;
      await drive.upload(folderId, file, 'application/gzip', gzipSync(fs.readFileSync(tmp)));

      // Covers missing in Drive (the first backup uploads them all, later ones only new ones).
      const present = new Set((await drive.list(coversFolderId)).map((f) => f.name));
      const pending: { name: string; file: string }[] = [];
      for (const { id } of this.db.select({ id: assets.id }).from(assets).all()) {
        for (const size of ['full', 'thumb'] as const) {
          const name = `${id}${size === 'thumb' ? '.thumb' : ''}.jpg`;
          const local = this.assetPath(id, size);
          if (!present.has(name) && fs.existsSync(local)) pending.push({ name, file: local });
        }
      }
      let next = 0;
      const worker = async () => {
        while (next < pending.length) {
          const p = pending[next++]!;
          await drive.upload(coversFolderId, p.name, 'image/jpeg', fs.readFileSync(p.file));
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));

      const prune = filesToPrune(await drive.list(folderId));
      for (const f of prune) await drive.remove(f.id);

      setMeta(this.db, M.lastSuccessAt, this.now().toISOString());
      setMeta(this.db, M.lastFile, file);
      setMeta(this.db, M.fingerprint, fingerprint);
      deleteMeta(this.db, M.lastError);
      const result = { file, coversUploaded: pending.length, deleted: prune.length };
      this.log.info(result, 'backup to google drive completed');
      return result;
    } catch (e) {
      const err: StoredError =
        e instanceof DriveError || e instanceof HttpError
          ? { key: e.key, params: e.params }
          : { key: 'errors.backupFailed', params: { reason: (e as Error).message } };
      setMeta(this.db, M.lastError, JSON.stringify(err));
      this.log.warn({ err: (e as Error).message }, 'backup to google drive failed');
      throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  // ---------- restoring ----------

  /**
   * Downloads a database copy from Drive (the newest, or the one named) to `<DATA_DIR>/restore.db`,
   * checks its integrity, and downloads the covers missing on this server into `assets/`.
   * It does not touch `library.db`: swapping it in is the operator's step (runbook, "Restore").
   */
  async fetchBackup(name?: string): Promise<{ file: string; path: string; coversDownloaded: number }> {
    const s = this.readState();
    if (!s || !this.oauth) throw new HttpError(409, 'drive-not-connected', 'errors.driveNotConnected');
    const drive = this.driveClient(s);
    const folderId = await drive.findFolder(ROOT_FOLDER, null);
    if (!folderId) throw new Error(`there is no "${ROOT_FOLDER}" folder in this Google Drive`);
    const files = await drive.list(folderId);
    const copies = files.filter((f) => DB_FILE_RE.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : -1));
    const pick = name ? copies.find((f) => f.name === name) : copies[0];
    if (!pick)
      throw new Error(name ? `${name} is not in Google Drive` : 'there is no backup in Google Drive');

    const out = path.join(this.config.dataDir, 'restore.db');
    const tmp = `${out}.tmp`;
    fs.writeFileSync(tmp, gunzipSync(await drive.download(pick.id)));
    const check = fileIntegrity(tmp);
    if (check !== 'ok') {
      fs.rmSync(tmp, { force: true });
      throw new Error(`${pick.name} failed the integrity check: ${check}`);
    }
    fs.renameSync(tmp, out);

    let coversDownloaded = 0;
    const coversId = files.find((f) => f.name === COVERS_FOLDER)?.id;
    if (coversId) {
      for (const f of await drive.list(coversId)) {
        const m = /^([0-9a-f]{64})(\.thumb)?\.jpg$/.exec(f.name);
        if (!m) continue;
        const local = this.assetPath(m[1]!, m[2] ? 'thumb' : 'full');
        if (fs.existsSync(local)) continue;
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fs.writeFileSync(local, await drive.download(f.id));
        coversDownloaded++;
      }
    }
    return { file: pick.name, path: out, coversDownloaded };
  }

  // ---------- scheduler ----------

  /** Runs an automatic backup if one is due and something changed (or the last one failed). */
  async tick(): Promise<RunResult | null> {
    const interval = this.interval;
    if (!interval || this.running || !this.oauth || !this.readState()) return null;
    const last = getMeta(this.db, M.lastAttemptAt);
    if (last && this.now().getTime() - new Date(last).getTime() < interval * 60_000) return null;
    const failed = !!getMeta(this.db, M.lastError);
    if (!failed && getMeta(this.db, M.fingerprint) === this.fingerprint()) return null;
    return this.run().catch(() => null);
  }

  startScheduler(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  async stopScheduler(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
  }
}
