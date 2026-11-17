import { isNull } from 'drizzle-orm';
import type { Lang } from '@openlibrary/contracts';
import type { Db } from '../db/client.js';
import { works } from '../db/schema.js';
import type { CatalogService } from '../catalog/service.js';
import { translateSubjects } from './subjects.js';

export type RetranslateChange = { workId: string; title: string; before: string[]; after: string[] };

/**
 * Translates the subjects of the books already in the catalog (the ones saved in English before lookups
 * translated them). With `apply` each change goes through `patchWork`, so it gets a new version and
 * reaches the phones on their next sync; without it nothing is written (dry run).
 */
export function retranslateSubjects(
  db: Db,
  catalog: CatalogService,
  lang: Lang,
  apply: boolean,
): RetranslateChange[] {
  const rows = db
    .select({ id: works.id, title: works.title, version: works.version, subjects: works.subjects })
    .from(works)
    .where(isNull(works.deletedAt))
    .all();
  const changes: RetranslateChange[] = [];
  for (const w of rows) {
    const after = translateSubjects(w.subjects, lang);
    if (after.length === w.subjects.length && after.every((s, i) => s === w.subjects[i])) continue;
    changes.push({ workId: w.id, title: w.title, before: w.subjects, after });
    if (apply) catalog.patchWork(w.id, { baseVersion: w.version, fields: { subjects: after } });
  }
  return changes;
}
