/**
 * Change engine: per-entity versions, change log and field-level merging.
 *
 * An update arrives with `baseVersion` (the version the client had):
 *  - base == current → everything is applied.
 *  - base <  current → for each field sent, check whether someone changed it after base:
 *        no → applied (lossless merge);  yes, same value → convergent;  yes, different value → CONFLICT.
 *  - base >  current → invalid request.
 * Changes made by the same session never conflict with each other: a phone that edits a field twice
 * offline sends both ops with the same base version, and the second must win over the first.
 * Android sync (F3) reuses this very logic.
 */
import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { ConflictProblem } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import {
  changeLog,
  copies,
  editions,
  locations,
  quotes,
  readingSessions,
  wishlistItems,
  works,
} from '../db/schema.js';
import { badRequest, HttpError, notFound } from '../errors.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;
export type EntityName = 'work' | 'edition' | 'copy' | 'location' | 'reading' | 'wish' | 'quote';

export const TABLES = {
  work: works,
  edition: editions,
  copy: copies,
  location: locations,
  reading: readingSessions,
  wish: wishlistItems,
  quote: quotes,
} as const;
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

/** Fields of an entity modified after a given version by OTHER sessions than `bySession`. */
export function changedSince(
  tx: Tx,
  entity: EntityName,
  id: string,
  version: number,
  bySession: string | null = null,
): Set<string> {
  const others = bySession ? or(isNull(changeLog.sessionId), ne(changeLog.sessionId, bySession)) : undefined;
  const rows = tx
    .select({ fields: changeLog.fields })
    .from(changeLog)
    .where(
      and(eq(changeLog.entity, entity), eq(changeLog.entityId, id), gt(changeLog.version, version), others),
    )
    .all();
  return new Set(rows.flatMap((r) => Object.keys(r.fields)));
}

export class ConflictError extends HttpError {
  constructor(entity: EntityName, body: ConflictProblem) {
    super(
      409,
      'conflict',
      `errors.conflict.${entity}`,
      { fields: body.conflicts.map((c) => c.field).join(', ') },
      body,
    );
  }
}

/** Applies a partial update with field-level merging. Returns the resulting row and the applied fields. */
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
  if (baseVersion > row.version) throw badRequest('errors.baseVersionAhead');

  const current = row as unknown as Record<string, unknown>;
  const changed = Object.keys(fields).filter((k) => fields[k] !== undefined && !same(current[k], fields[k]));
  if (!changed.length) return { row, applied: {} };

  if (baseVersion < row.version) {
    const touched = changedSince(tx, entity, id, baseVersion, ctx.sessionId);
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

/** Soft delete (tombstone) so that deletions are synced too. */
export function softDelete(tx: Tx, entity: EntityName, id: string, now: string, sessionId: string | null) {
  const table = TABLES[entity] as AnyTable;
  const row = tx.select().from(table).where(eq(table.id, id)).get();
  if (!row || row.deletedAt) return;
  const version = row.version + 1;
  tx.update(table).set({ deletedAt: now, updatedAt: now, version }).where(eq(table.id, id)).run();
  recordChange(tx, entity, id, 'delete', version, {}, now, sessionId);
}
