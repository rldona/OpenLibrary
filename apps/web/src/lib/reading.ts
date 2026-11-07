/**
 * The reading-status row of the book panel, as the Android app's ui/detail/ReadingCard.kt: what choosing
 * a status does, given the work's derived status (BR13) and the reading in progress.
 */
import type { ReadingDTO, ReadingFields, WorkReadingStatus } from '@openlibrary/contracts/client';

/** The statuses offered, in order; "abandoned" is a session outcome, shown in the history only. */
export const STATUS_CHOICES: readonly WorkReadingStatus[] = ['pending', 'reading', 'read'];

export type ReadingAction =
  | { kind: 'start'; copyId: string; status: 'reading' | 'read' }
  | { kind: 'edit'; reading: ReadingDTO; fields: Partial<ReadingFields> };

/**
 * The reading in progress: the latest one still "reading", even if a later one was abandoned (the same
 * rule that makes the work's status "reading").
 */
export const currentReading = (readings: readonly ReadingDTO[]): ReadingDTO | undefined =>
  readings.findLast((r) => r.status === 'reading');

/**
 * What choosing `target` does: start (or read again), finish, mark as read, or reset a reading in
 * progress to "not read yet". Null when there is nothing to do: the status already is that one, or the
 * change would not produce the chosen status.
 *
 * Reset (design §4, the "reset" arrow) only applies to a work that was never read: it clears the dates
 * of the single reading in progress. After a previous finished reading the work is "read" (a re-read is
 * in progress), so "not read yet" would be a lie; "Abandon" is the way out.
 */
export function statusChange(
  status: WorkReadingStatus,
  current: ReadingDTO | undefined,
  target: WorkReadingStatus,
  copyId: string | null | undefined,
  readings: readonly ReadingDTO[],
): ReadingAction | null {
  if (target === status) return null;
  if (target === 'pending') {
    if (!current) return null;
    if (readings.some((r) => r.status === 'read')) return null;
    if (readings.filter((r) => r.status === 'reading').length !== 1) return null;
    return {
      kind: 'edit',
      reading: current,
      fields: { status: 'pending', startedOn: null, finishedOn: null },
    };
  }
  if (target === 'reading') return copyId ? { kind: 'start', copyId, status: 'reading' } : null;
  if (target === 'read' && current) return { kind: 'edit', reading: current, fields: { status: 'read' } };
  if (target === 'read') return copyId ? { kind: 'start', copyId, status: 'read' } : null;
  return null;
}
