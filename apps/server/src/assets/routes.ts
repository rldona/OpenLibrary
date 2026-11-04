import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AssetId, FetchAssetRequest } from '@openlibrary/contracts';
import { notFound, parse } from '../errors.js';
import { requireAuth } from '../auth/routes.js';
import type { LookupService } from '../lookup/service.js';
import { MAX_UPLOAD_BYTES, type AssetService } from './service.js';

export async function assetAndLookupRoutes(
  app: FastifyInstance,
  opts: { assets: AssetService; lookup: LookupService },
) {
  const { assets, lookup } = opts;
  app.addHook('preHandler', async (req) => {
    requireAuth(req);
  });

  // Imagen binaria en el cuerpo (image/jpeg, image/png, image/webp…).
  app.addContentTypeParser(
    /^image\//,
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post('/assets', { bodyLimit: MAX_UPLOAD_BYTES }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      reply.code(415);
      return { title: 'Tipo no soportado', status: 415, detail: 'Envía la imagen con Content-Type image/*.' };
    }
    reply.code(201);
    return assets.store(body, 'upload');
  });

  /** Guarda la portada propuesta por un proveedor externo. */
  app.post('/assets/fetch', async (req, reply) => {
    const { url } = parse(FetchAssetRequest, req.body);
    reply.code(201);
    return assets.fetchFromProvider(url);
  });

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/assets/:id', async (req, reply) => {
    const id = parse(AssetId, req.params.id);
    const size = req.query.size === 'full' ? 'full' : 'thumb';
    const file = assets.pathOf(id, size);
    if (!assets.get(id) || !fs.existsSync(file)) throw notFound('Esa imagen no existe.');
    return reply
      .type('image/jpeg')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(fs.createReadStream(file));
  });

  app.get<{ Params: { isbn: string }; Querystring: { refresh?: string } }>(
    '/lookup/isbn/:isbn',
    async (req) => lookup.byIsbn(req.params.isbn, { refresh: req.query.refresh === '1' }),
  );
}
