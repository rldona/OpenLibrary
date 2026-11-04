import type { FastifyInstance } from 'fastify';
import { SyncPullQuery, SyncPushRequest } from '@openlibrary/contracts';
import { parse } from '../errors.js';
import { requireAuth } from '../auth/routes.js';
import type { SyncService } from './service.js';

/** Sync routes. They require a session or a device token. */
export async function syncRoutes(app: FastifyInstance, opts: { sync: SyncService }) {
  const { sync } = opts;
  app.addHook('preHandler', async (req) => {
    requireAuth(req);
  });

  app.get('/sync/snapshot', async () => sync.snapshot());
  app.get('/sync/pull', async (req) => sync.pull(parse(SyncPullQuery, req.query, req.lang)));
  app.post('/sync/push', async (req) =>
    sync.push(parse(SyncPushRequest, req.body, req.lang), req.session?.id ?? null, req.lang),
  );
}
