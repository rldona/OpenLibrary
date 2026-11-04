import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Carpeta de migraciones SQL generadas por drizzle-kit (junto al código o al bundle). */
function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../drizzle'), path.resolve(here, '../../drizzle')];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`No se encuentran las migraciones (buscado en ${candidates.join(', ')})`);
  return found;
}

/** Abre la base de datos (o ':memory:'), aplica PRAGMAs y migraciones pendientes. */
export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: migrationsFolder() });
  ensureEpoch(db);
  return db;
}

export function getMeta(db: Db, key: string): string | undefined {
  return db.select().from(schema.meta).where(eq(schema.meta.key, key)).get()?.value;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.insert(schema.meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.meta.key, set: { value } })
    .run();
}

/** El "epoch" identifica una línea temporal de datos; cambia tras restaurar una copia. */
function ensureEpoch(db: Db): void {
  if (!getMeta(db, 'epoch')) setMeta(db, 'epoch', randomUUID());
}

export function bumpEpoch(db: Db): string {
  const epoch = randomUUID();
  setMeta(db, 'epoch', epoch);
  return epoch;
}
