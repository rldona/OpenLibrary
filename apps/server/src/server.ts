import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { AuthService } from './auth/service.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp({ config, db });

if (!new AuthService(db, config.sessionTtlMs).isConfigured()) {
  app.log.warn(
    'Aún no hay contraseña: ejecuta «ol set-password» (en desarrollo: npm run cli -w @openlibrary/server -- set-password) para poder iniciar sesión.',
  );
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
app.log.info(
  { data: config.dataDir, publicUrl: config.publicUrl.href, web: !!config.webDist },
  'OpenLibrary listo',
);
