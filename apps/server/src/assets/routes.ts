import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AssetId, FetchAssetRequest, MetadataSearchParams } from '@openlibrary/contracts';
import { HttpError, notFound, parse } from '../errors.js';
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

  // Binary image in the body (image/jpeg, image/png, image/webp…).
  app.addContentTypeParser(
    /^image\//,
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post('/assets', { bodyLimit: MAX_UPLOAD_BYTES }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body)) throw new HttpError(415, 'unsupported-media', 'errors.unsupportedMedia');
    reply.code(201);
    return assets.store(body, 'upload');
  });

  /** Stores the cover proposed by an external provider. */
  app.post('/assets/fetch', async (req, reply) => {
    const { url } = parse(FetchAssetRequest, req.body, req.lang);
    reply.code(201);
    return assets.fetchFromProvider(url);
  });

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/assets/:id', async (req, reply) => {
    const id = parse(AssetId, req.params.id, req.lang);
    const size = req.query.size === 'full' ? 'full' : 'thumb';
    const file = assets.pathOf(id, size);
    if (!assets.get(id) || !fs.existsSync(file)) throw notFound('errors.imageNotFound');
    return reply
      .type('image/jpeg')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(fs.createReadStream(file));
  });

  app.get<{ Params: { isbn: string }; Querystring: { refresh?: string } }>(
    '/lookup/isbn/:isbn',
    async (req) => lookup.byIsbn(req.params.isbn, { refresh: req.query.refresh === '1' }),
  );

  /**
   * Identifies a cover by the title/author text read on the phone. The query is logged at warn level
   * because it contains what the reader is looking at.
   */
  app.get<{ Querystring: { title?: string; author?: string } }>(
    '/lookup/search',
    { logLevel: 'warn' },
    async (req) => lookup.search(parse(MetadataSearchParams, req.query, req.lang)),
  );
}
