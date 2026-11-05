import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { BACKUP_STALE_DAYS, IMPORT_MAX_BYTES, ImportQuery, type BackupStatus } from '@openlibrary/contracts';
import { parse } from '../errors.js';
import { requireAuth } from '../auth/routes.js';
import type { ExportService } from './export.js';
import type { ImportService } from './import.js';

/** Export, import and backup status. All of them require a session. */
export async function portabilityRoutes(
  app: FastifyInstance,
  opts: { exporter: ExportService; importer: ImportService; dataDir: string; now: () => Date },
) {
  const { exporter, importer } = opts;
  app.addHook('preHandler', async (req) => {
    requireAuth(req);
  });
  const day = () => opts.now().toISOString().slice(0, 10);

  app.get('/export/full', { compress: false }, async (_req, reply) =>
    reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="openlibrary-${day()}.zip"`)
      .header('cache-control', 'no-store')
      .send(Readable.from(exporter.zip())),
  );

  app.get('/export/json', async (_req, reply) =>
    reply
      .header('content-disposition', `attachment; filename="openlibrary-${day()}.json"`)
      .header('cache-control', 'no-store')
      .send(exporter.library()),
  );

  app.get('/export/csv', async (_req, reply) =>
    reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="openlibrary-${day()}.csv"`)
      .header('cache-control', 'no-store')
      .send(exporter.csv()),
  );

  // The file arrives as it is (zip, JSON or CSV, whatever the Content-Type); the format is detected.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/import', { bodyLimit: IMPORT_MAX_BYTES }, async (req) => {
    const { dryRun } = parse(ImportQuery, req.query, req.lang);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return importer.run(body, { dryRun, lang: req.lang, sessionId: req.session?.id ?? null });
  });

  app.get('/backups/status', async (): Promise<BackupStatus> => {
    let lastSuccessAt: string | null = null;
    try {
      const raw = fs.readFileSync(path.join(opts.dataDir, 'backups', 'last-success'), 'utf8').trim();
      if (!Number.isNaN(Date.parse(raw))) lastSuccessAt = new Date(raw).toISOString();
    } catch {
      // never backed up
    }
    const age = lastSuccessAt ? opts.now().getTime() - Date.parse(lastSuccessAt) : Infinity;
    return { lastSuccessAt, stale: age > BACKUP_STALE_DAYS * 86_400_000 };
  });
}
