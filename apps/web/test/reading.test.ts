// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ReadingDTO } from '@openlibrary/contracts/client';
import { starFill, toggledRating } from '../src/lib/rating';
import { currentReading, statusChange } from '../src/lib/reading';

/** The same cases as the Android app's ReadingUiTest. */
const T = '2026-11-01T10:00:00.000Z';
const session = (id: string, status: ReadingDTO['status'], copyId = 'c1'): ReadingDTO => ({
  id,
  version: 1,
  copyId,
  status,
  startedOn: '2026-11-01',
  finishedOn: null,
  rating: null,
  notes: '',
  createdAt: T,
  updatedAt: T,
});

describe('rating', () => {
  it('sets a star and clears it when chosen again', () => {
    expect(toggledRating(null, 3)).toBe(3);
    expect(toggledRating(3, 5)).toBe(5);
    expect(toggledRating(3, 3)).toBeNull();
    // A half rating is replaced, not cleared, by its nearest star.
    expect(toggledRating(3.5, 4)).toBe(4);
    expect(toggledRating(3.5, 3)).toBe(3);
    expect(() => toggledRating(null, 6)).toThrow(RangeError);
  });

  it('shows stars full, half and empty', () => {
    expect([1, 2, 3, 4, 5].map((s) => starFill(3.5, s))).toEqual(['full', 'full', 'full', 'half', 'empty']);
    expect([1, 2, 3, 4, 5].map((s) => starFill(null, s))).toEqual(Array(5).fill('empty'));
  });
});

describe('reading status', () => {
  const reading = session('r1', 'reading');
  const finished = session('r2', 'read', 'c2');

  it('starts, finishes, marks or resets the reading', () => {
    expect(statusChange('pending', undefined, 'pending', 'c1', [])).toBeNull();
    expect(statusChange('reading', reading, 'reading', 'c1', [reading])).toBeNull();
    expect(statusChange('pending', undefined, 'reading', 'c1', [])).toEqual({
      kind: 'start',
      copyId: 'c1',
      status: 'reading',
    });
    expect(statusChange('pending', undefined, 'read', 'c1', [])).toEqual({
      kind: 'start',
      copyId: 'c1',
      status: 'read',
    });
    expect(statusChange('reading', reading, 'read', 'c1', [reading])).toEqual({
      kind: 'edit',
      reading,
      fields: { status: 'read' },
    });
    expect(statusChange('read', undefined, 'reading', 'c1', [finished])).toEqual({
      kind: 'start',
      copyId: 'c1',
      status: 'reading',
    });
    // "Not read yet" resets every finished or in-progress reading of the work.
    expect(statusChange('reading', reading, 'pending', 'c1', [reading])).toEqual({
      kind: 'reset',
      readings: [reading],
    });
    expect(statusChange('reading', reading, 'pending', 'c1', [finished, reading])).toEqual({
      kind: 'reset',
      readings: [finished, reading],
    });
    expect(
      statusChange('reading', reading, 'pending', 'c1', [reading, session('r3', 'reading', 'c2')]),
    ).toEqual({ kind: 'reset', readings: [reading, session('r3', 'reading', 'c2')] });
    expect(statusChange('read', undefined, 'pending', 'c1', [finished])).toEqual({
      kind: 'reset',
      readings: [finished],
    });
    // Nothing starts without a copy.
    expect(statusChange('pending', undefined, 'reading', null, [])).toBeNull();
  });

  it('keeps a reading in progress before an abandoned one as the current one', () => {
    const readings = [reading, session('r2', 'abandoned', 'c2')];
    expect(currentReading(readings)).toBe(reading);
    expect(statusChange('reading', currentReading(readings), 'read', 'c1', readings)).toEqual({
      kind: 'edit',
      reading,
      fields: { status: 'read' },
    });
    expect(statusChange('reading', currentReading(readings), 'reading', 'c1', readings)).toBeNull();
  });
});
