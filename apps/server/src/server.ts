import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { AuthService } from './auth/service.js';
import { dropPrivileges } from './privileges.js';
import { BackupScheduler } from './backup.js';

const config = loadConfig();
dropPrivileges(config.dataDir);
const db = openDb(config.dbPath);
const app = await buildApp({ config, db });

if (!new AuthService(db, config.sessionTtlMs).isConfigured()) {
  app.log.warn(
    'No password yet: run "ol set-password" (in development: npm run cli -w @openlibrary/server -- set-password).',
  );
}

let backups: BackupScheduler | undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await backups?.stop();
  db.$client.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
app.log.info(
  { data: config.dataDir, publicUrl: config.publicUrl.href, web: !!config.webDist },
  'OpenLibrary ready',
);

if (config.backupSchedule === 'daily') {
  backups = new BackupScheduler({
    db,
    dataDir: config.dataDir,
    keep: config.backupKeep,
    log: app.log,
  }).start();
  app.log.info({ next: backups.nextRunAt().toISOString(), keep: config.backupKeep }, 'in-process backups on');
}
