/**
 * Motor de cambios: versiones por entidad, historial (change_log) y fusión por campo.
 *
 * Una modificación llega con `baseVersion` (la versión que el cliente tenía):
 *  - base == actual  → se aplica todo.
 *  - base <  actual  → para cada campo enviado se mira si alguien lo cambió después de base:
 *        no → se aplica (fusión sin pérdida);  sí y mismo valor → convergente;  sí y distinto → CONFLICTO.
 *  - base >  actual  → petición inválida.
 * Esta misma lógica servirá a la sincronización de Android (F3).
 */
import { and, eq, gt } from 'drizzle-orm';
import type { ConflictProblem } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import { changeLog, copies, editions, locations, works } from '../db/schema.js';
import { badRequest, HttpError, notFound } from '../errors.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;
export type EntityName = 'work' | 'edition' | 'copy' | 'location';

export const TABLES = { work: works, edition: editions, copy: copies, location: locations } as const;
type AnyTable = (typeof TABLES)[EntityName];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function recordChange(
  tx: Tx,
  entity: EntityName,
  entityId: string,
  op: 'create' | 'update' | 'delete',
  version: number,
  fields: Record<string, unknown>,
  at: string,
  sessionId: string | null,
): void {
  tx.insert(changeLog).values({ entity, entityId, op, version, fields, at, sessionId }).run();
}

/** Campos modificados en una entidad después de una versión dada. */
export function changedSince(tx: Tx, entity: EntityName, id: string, version: number): Set<string> {
  const rows = tx
    .select({ fields: changeLog.fields })
    .from(changeLog)
    .where(and(eq(changeLog.entity, entity), eq(changeLog.entityId, id), gt(changeLog.version, version)))
    .all();
  return new Set(rows.flatMap((r) => Object.keys(r.fields)));
}

export class ConflictError extends HttpError {
  constructor(entity: EntityName, body: ConflictProblem) {
    super(
      409,
      'conflict',
      `Otro dispositivo cambió ${body.conflicts.map((c) => c.field).join(', ')} de este ${LABEL[entity]} mientras lo editabas. No se ha sobrescrito nada.`,
      body,
    );
  }
}
const LABEL: Record<EntityName, string> = {
  work: 'libro',
  edition: 'edición',
  copy: 'ejemplar',
  location: 'ubicación',
};

/** Aplica una modificación parcial con fusión por campo. Devuelve la fila resultante y los campos aplicados. */
export function patchEntity<R extends { id: string; version: number; deletedAt: string | null }>(
  tx: Tx,
  entity: EntityName,
  id: string,
  baseVersion: number,
  fields: Record<string, unknown>,
  ctx: { now: string; sessionId: string | null; derived?: (merged: R) => Record<string, unknown> },
): { row: R; applied: Record<string, unknown> } {
  const table = TABLES[entity] as AnyTable;
  const row = tx.select().from(table).where(eq(table.id, id)).get() as R | undefined;
  if (!row || row.deletedAt) throw notFound();
  if (baseVersion > row.version) throw badRequest('baseVersion es mayor que la versión actual.');

  const current = row as unknown as Record<string, unknown>;
  const changed = Object.keys(fields).filter((k) => fields[k] !== undefined && !same(current[k], fields[k]));
  if (!changed.length) return { row, applied: {} };

  if (baseVersion < row.version) {
    const touched = changedSince(tx, entity, id, baseVersion);
    const conflicts = changed.filter((k) => touched.has(k));
    if (conflicts.length) {
      throw new ConflictError(entity, {
        currentVersion: row.version,
        conflicts: conflicts.map((field) => ({ field, current: current[field], yours: fields[field] })),
      });
    }
  }

  const applied = Object.fromEntries(changed.map((k) => [k, fields[k]]));
  const version = row.version + 1;
  const merged = { ...row, ...applied, version, updatedAt: ctx.now } as R;
  const derived = ctx.derived?.(merged) ?? {};
  tx.update(table)
    .set({ ...applied, ...derived, version, updatedAt: ctx.now })
    .where(eq(table.id, id))
    .run();
  recordChange(tx, entity, id, 'update', version, applied, ctx.now, ctx.sessionId);
  return { row: { ...merged, ...derived }, applied };
}

/** Borrado lógico (lápida) para que la baja también se sincronice. */
export function softDelete(tx: Tx, entity: EntityName, id: string, now: string, sessionId: string | null) {
  const table = TABLES[entity] as AnyTable;
  const row = tx.select().from(table).where(eq(table.id, id)).get();
  if (!row || row.deletedAt) return;
  const version = row.version + 1;
  tx.update(table).set({ deletedAt: now, updatedAt: now, version }).where(eq(table.id, id)).run();
  recordChange(tx, entity, id, 'delete', version, {}, now, sessionId);
}
