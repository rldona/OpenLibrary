/**
 * Portadas: se guardan en DATA_DIR/assets/<aa>/<sha256>.jpg (normalizada, máx. 1600 px)
 * y <sha256>.thumb.jpg (400 px de ancho). El id es el SHA-256 del archivo recibido:
 * subir dos veces la misma imagen no duplica nada (idempotente).
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

/** Solo se descargan portadas de proveedores conocidos (evita que el servidor haga peticiones arbitrarias). */
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
    if (!buf.length) throw badRequest('La imagen está vacía.');
    const id = createHash('sha256').update(buf).digest('hex');
    const existing = this.get(id);
    if (existing && fs.existsSync(this.pathOf(id, 'full'))) return toDto(existing);

    let img: Sharp;
    let meta: Metadata;
    try {
      img = sharp(buf, { failOn: 'error' }).rotate(); // respeta la orientación EXIF de las fotos del móvil
      meta = await img.metadata();
    } catch {
      throw badRequest('El archivo no es una imagen válida (usa JPEG, PNG o WebP).');
    }
    if (!meta.width || !meta.height) throw badRequest('No se pueden leer las dimensiones de la imagen.');
    // Las portadas de 1×1 px son «sin portada» de algunos proveedores.
    if (meta.width < 20 || meta.height < 20)
      throw badRequest('La imagen es demasiado pequeña para ser una portada.');

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

  /** Descarga una portada propuesta por un proveedor (siguiendo redirecciones solo a hosts permitidos). */
  async fetchFromProvider(rawUrl: string): Promise<AssetDTO> {
    let url = new URL(rawUrl);
    for (let hop = 0; hop < 4; hop++) {
      if (!hostAllowed(url)) throw badRequest(`No se permiten imágenes de ${url.hostname}.`);
      const res = await this.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        continue;
      }
      if (res.status === 404)
        throw new HttpError(404, 'no-cover', 'El proveedor no tiene portada para este libro.');
      if (!res.ok) throw new HttpError(502, 'provider-error', `El proveedor respondió ${res.status}.`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_UPLOAD_BYTES) throw badRequest('La imagen es demasiado grande.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_UPLOAD_BYTES) throw badRequest('La imagen es demasiado grande.');
      return this.store(buf, 'provider');
    }
    throw new HttpError(502, 'provider-error', 'Demasiadas redirecciones.');
  }
}

const toDto = (r: typeof assets.$inferSelect | AssetDTO): AssetDTO => ({
  id: r.id,
  mime: r.mime,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
});
