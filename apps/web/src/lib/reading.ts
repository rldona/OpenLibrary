/**
 * The reading-status row of the book panel, as the Android app's ui/detail/ReadingCard.kt: what choosing
 * a status does, given the work's derived status (BR13) and the reading in progress.
 */
import type { ReadingDTO, ReadingFields, WorkReadingStatus } from '@openlibrary/contracts/client';

/** The statuses offered, in order; "abandoned" is a session outcome, shown in the history only. */
export const STATUS_CHOICES: readonly WorkReadingStatus[] = ['pending', 'reading', 'read'];

export type ReadingAction =
  | { kind: 'start'; copyId: string; status: 'reading' | 'read' }
  | { kind: 'edit'; reading: ReadingDTO; fields: Partial<ReadingFields> }
  | { kind: 'reset'; readings: ReadingDTO[] };

/**
 * The reading in progress: the latest one still "reading", even if a later one was abandoned (the same
 * rule that makes the work's status "reading").
 */
export const currentReading = (readings: readonly ReadingDTO[]): ReadingDTO | undefined =>
  readings.findLast((r) => r.status === 'reading');

/**
 * What choosing `target` does: start (or read again), finish, mark as read, or reset the work to
 * "not read yet". Null when there is nothing to do: the status already is that one, or the change would
 * not produce the chosen status.
 *
 * Reset (design §4) is a work-level undo: every live reading of the work (finished and in progress) goes
 * back to pending and its dates are cleared, so a book with a finished read and a re-read becomes "not
 * read yet". Ratings and notes are kept.
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
    const toReset = readings.filter((r) => r.status === 'reading' || r.status === 'read');
    return toReset.length ? { kind: 'reset', readings: toReset } : null;
  }
  if (target === 'reading') return copyId ? { kind: 'start', copyId, status: 'reading' } : null;
  if (target === 'read' && current) return { kind: 'edit', reading: current, fields: { status: 'read' } };
  if (target === 'read') return copyId ? { kind: 'start', copyId, status: 'read' } : null;
  return null;
}
