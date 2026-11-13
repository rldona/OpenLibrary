import type { FastifyInstance } from 'fastify';
import { DriveBackupSettings, type DriveConnectResponse } from '@openlibrary/contracts';
import { parse } from '../errors.js';
import { tr } from '../i18n.js';
import { requireAuth } from '../auth/routes.js';
import type { DriveBackupService } from './service.js';

export async function driveBackupRoutes(app: FastifyInstance, opts: { drive: DriveBackupService }) {
  const { drive } = opts;

  app.get('/backups/drive', async (req) => {
    requireAuth(req);
    return drive.status(tr(req.lang));
  });

  app.put('/backups/drive/settings', async (req) => {
    requireAuth(req);
    const body = parse(DriveBackupSettings, req.body, req.lang);
    drive.setInterval(body.intervalMinutes);
    return drive.status(tr(req.lang));
  });

  /** "Back up now": starts in the background; the web polls GET /backups/drive while `running`. */
  app.post('/backups/drive/run', async (req, reply) => {
    requireAuth(req);
    drive.run().catch(() => undefined);
    reply.code(202);
    return drive.status(tr(req.lang));
  });

  app.post('/backups/drive/connect', async (req) => {
    requireAuth(req);
    return { url: drive.connectUrl() } satisfies DriveConnectResponse;
  });

  /**
   * Google redirects the browser here after consent. It is a cross-site navigation, so the
   * SameSite=Strict session cookie is not sent: the single-use `state` (issued to an
   * authenticated session) is what authorises it.
   */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/backups/drive/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const outcome = await drive.completeConnect(req.query);
      return reply.redirect(`/data?drive=${outcome}`);
    },
  );

  app.delete('/backups/drive', async (req) => {
    requireAuth(req);
    await drive.disconnect();
    return drive.status(tr(req.lang));
  });
}
