/**
 * Covers: stored as DATA_DIR/assets/<aa>/<sha256>.jpg (normalised, max 1600 px)
 * and <sha256>.thumb.jpg (400 px wide). The id is the SHA-256 of the received file,
 * so uploading the same image twice does not duplicate anything (idempotent).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { eq } from 'drizzle-orm';
import type { AssetDTO } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import { assets } from '../db/schema.js';
import { badRequest, HttpError } from '../errors.js';
import type { Fetch } from '../lookup/providers.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Covers are only downloaded from known providers (prevents the server from making arbitrary requests). */
const ALLOWED_HOSTS = [
  /^covers\.openlibrary\.org$/,
  /(^|\.)archive\.org$/,
  /^books\.google\.com$/,
  /(^|\.)googleusercontent\.com$/,
  /^books\.googleapis\.com$/,
];
const hostAllowed = (u: URL) => u.protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(u.hostname));

export class AssetService {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  pathOf(id: string, size: 'full' | 'thumb'): string {
    return path.join(this.dir, id.slice(0, 2), `${id}${size === 'thumb' ? '.thumb' : ''}.jpg`);
  }

  get(id: string) {
    return this.db.select().from(assets).where(eq(assets.id, id)).get();
  }

  async store(buf: Buffer, origin: 'upload' | 'provider' | 'import'): Promise<AssetDTO> {
    if (!buf.length) throw badRequest('errors.imageEmpty');
    const id = createHash('sha256').update(buf).digest('hex');
    const existing = this.get(id);
    if (existing && fs.existsSync(this.pathOf(id, 'full'))) return toDto(existing);

    let img: Sharp;
    let meta: Metadata;
    try {
      img = sharp(buf, { failOn: 'error' }).rotate(); // honours the EXIF orientation of phone photos
      meta = await img.metadata();
    } catch {
      throw badRequest('errors.imageInvalid');
    }
    if (!meta.width || !meta.height) throw badRequest('errors.imageDims');
    // 1×1 px images are how some providers say "no cover".
    if (meta.width < 20 || meta.height < 20) throw badRequest('errors.imageTooSmall');

    fs.mkdirSync(path.dirname(this.pathOf(id, 'full')), { recursive: true });
    const full = await img
      .clone()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    await img
      .clone()
      .resize({ width: 400, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(this.pathOf(id, 'thumb'));
    fs.writeFileSync(this.pathOf(id, 'full'), full.data);

    const row = {
      id,
      mime: 'image/jpeg',
      width: full.info.width,
      height: full.info.height,
      bytes: full.data.length,
      origin,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(assets).values(row).onConflictDoNothing().run();
    return toDto(row);
  }

  /** Downloads a cover proposed by a provider (following redirects only to allowed hosts). */
  async fetchFromProvider(rawUrl: string): Promise<AssetDTO> {
    let url = new URL(rawUrl);
    for (let hop = 0; hop < 4; hop++) {
      if (!hostAllowed(url)) throw badRequest('errors.hostNotAllowed', { host: url.hostname });
      const res = await this.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        continue;
      }
      if (res.status === 404) throw new HttpError(404, 'no-cover', 'errors.noCover');
      if (!res.ok) throw new HttpError(502, 'provider-error', 'errors.providerError', { status: res.status });
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_UPLOAD_BYTES) throw badRequest('errors.imageTooLarge');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_UPLOAD_BYTES) throw badRequest('errors.imageTooLarge');
      return this.store(buf, 'provider');
    }
    throw new HttpError(502, 'provider-error', 'errors.tooManyRedirects');
  }
}

const toDto = (r: typeof assets.$inferSelect | AssetDTO): AssetDTO => ({
  id: r.id,
  mime: r.mime,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
});
