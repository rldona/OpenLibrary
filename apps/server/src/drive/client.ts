/**
 * Minimal Google Drive client (REST v3 over fetch, no SDK).
 * Scope `drive.file`: the app only sees the files and folders it created itself,
 * never the rest of the owner's Drive.
 */
import { randomBytes } from 'node:crypto';
import type { Params } from '@openlibrary/contracts';
import type { Fetch } from '../lookup/providers.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Google recommends simple multipart uploads only up to 5 MB; bigger files use a resumable session. */
const MULTIPART_MAX = 5 * 1024 * 1024;

export type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };
export type DriveFile = { id: string; name: string };

/** Failure talking to Google; `key` is an i18n message key. */
export class DriveError extends Error {
  constructor(
    public readonly key: string,
    public readonly params: Params = {},
    /** The authorisation is no longer valid: the owner has to connect Drive again. */
    public readonly reconnect = false,
  ) {
    super(key);
  }
}

export function authUrl(oauth: OAuthClient, state: string): string {
  const q = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // offline + consent: Google returns a refresh token so backups keep working unattended.
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function call(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new DriveError('errors.driveUnreachable');
  }
}

async function tokenRequest(fetchImpl: Fetch, body: Record<string, string>) {
  const res = await call(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (data.error === 'invalid_grant') throw new DriveError('errors.driveReconnect', {}, true);
  if (!res.ok || !data.access_token) throw new DriveError('errors.driveFailed', { status: res.status });
  return data as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** Exchanges the code Google sent to the callback for a refresh token. */
export async function exchangeCode(fetchImpl: Fetch, oauth: OAuthClient, code: string) {
  const t = await tokenRequest(fetchImpl, {
    code,
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    redirect_uri: oauth.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!t.refresh_token) throw new DriveError('errors.driveFailed', { status: 'no refresh token' });
  return { refreshToken: t.refresh_token, accessToken: t.access_token, expiresIn: t.expires_in ?? 3600 };
}

export async function revokeToken(fetchImpl: Fetch, token: string): Promise<void> {
  await call(fetchImpl, REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Drive client bound to one refresh token; caches the short-lived access token. */
export class DriveClient {
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly fetchImpl: Fetch,
    private readonly oauth: OAuthClient,
    readonly refreshToken: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  seed(accessToken: string, expiresIn: number): void {
    this.access = { token: accessToken, expiresAt: this.now().getTime() + expiresIn * 1000 };
  }

  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt - 60_000 > this.now().getTime()) return this.access.token;
    const t = await tokenRequest(this.fetchImpl, {
      refresh_token: this.refreshToken,
      client_id: this.oauth.clientId,
      client_secret: this.oauth.clientSecret,
      grant_type: 'refresh_token',
    });
    this.seed(t.access_token, t.expires_in ?? 3600);
    return t.access_token;
  }

  private async api(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    const headers = {
      ...(init.headers as Record<string, string>),
      authorization: `Bearer ${await this.token()}`,
    };
    const res = await call(this.fetchImpl, url, { ...init, headers }, timeoutMs);
    if (res.status === 401) {
      this.access = null;
      throw new DriveError('errors.driveReconnect', {}, true);
    }
    return res;
  }

  private async json<T>(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
    const res = await this.api(url, init, timeoutMs);
    if (!res.ok) throw new DriveError('errors.driveFailed', { status: res.status });
    return (await res.json()) as T;
  }

  /** E-mail of the connected Google account (null if Google does not say). */
  async account(): Promise<string | null> {
    try {
      const r = await this.json<{ user?: { emailAddress?: string } }>(
        `${API}/about?fields=user(emailAddress)`,
      );
      return r.user?.emailAddress ?? null;
    } catch {
      return null;
    }
  }

  /** A folder this app created, by name (the newest if there are several), or null. */
  async findFolder(name: string, parentId: string | null): Promise<string | null> {
    const params = new URLSearchParams({
      q: `name = '${q(name)}' and '${q(parentId ?? 'root')}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name)',
      orderBy: 'createdTime desc',
      pageSize: '1',
    });
    const r = await this.json<{ files: DriveFile[] }>(`${API}/files?${params}`);
    return r.files[0]?.id ?? null;
  }

  /**
   * Returns `knownId` if that folder still exists (not trashed); otherwise an existing folder with that
   * name (after reconnecting, or on a new installation); otherwise a new one.
   */
  async ensureFolder(name: string, parentId: string | null, knownId?: string): Promise<string> {
    if (knownId) {
      const res = await this.api(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`);
      if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed) return knownId;
      if (!res.ok && res.status !== 404) throw new DriveError('errors.driveFailed', { status: res.status });
    }
    const found = await this.findFolder(name, parentId);
    if (found) return found;
    const r = await this.json<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
    });
    return r.id;
  }

  /** Every (non-trashed) file directly inside a folder. */
  async list(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${q(folderId)}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      });
      const r = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
      out.push(...r.files);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async download(fileId: string): Promise<Buffer> {
    const res = await this.api(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, {}, 10 * 60_000);
    if (!res.ok) throw new DriveError('errors.driveFailed', { status: res.status });
    return Buffer.from(await res.arrayBuffer());
  }

  async upload(folderId: string, name: string, mime: string, data: Buffer): Promise<DriveFile> {
    const meta = JSON.stringify({ name, parents: [folderId] });
    if (data.length <= MULTIPART_MAX) {
      const b = `ol${randomBytes(12).toString('hex')}`;
      const body = Buffer.concat([
        Buffer.from(
          `--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\ncontent-type: ${mime}\r\n\r\n`,
        ),
        data,
        Buffer.from(`\r\n--${b}--`),
      ]);
      return this.json<DriveFile>(
        `${UPLOAD}?uploadType=multipart&fields=id,name`,
        { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${b}` }, body },
        120_000,
      );
    }
    const start = await this.api(`${UPLOAD}?uploadType=resumable&fields=id,name`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mime,
        'x-upload-content-length': String(data.length),
      },
      body: meta,
    });
    const session = start.headers.get('location');
    if (!start.ok || !session) throw new DriveError('errors.driveFailed', { status: start.status });
    return this.json<DriveFile>(
      session,
      { method: 'PUT', headers: { 'content-type': mime }, body: data as Uint8Array<ArrayBuffer> },
      10 * 60_000,
    );
  }

  async remove(fileId: string): Promise<void> {
    const res = await this.api(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new DriveError('errors.driveFailed', { status: res.status });
  }
}
