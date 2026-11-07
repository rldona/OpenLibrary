/** Star ratings, as the Android app's core/Rating.kt. */

/** Ratings go from 1 to MAX_RATING stars (the server also accepts halves, which are shown but not set here). */
export const MAX_RATING = 5;

/**
 * The rating after choosing star `star` (1-based): that many stars, or none when it was already exactly
 * that (choosing the same star again clears it).
 */
export function toggledRating(current: number | null | undefined, star: number): number | null {
  if (!Number.isInteger(star) || star < 1 || star > MAX_RATING)
    throw new RangeError(`star ${star} out of 1..${MAX_RATING}`);
  return current === star ? null : star;
}

export type StarFill = 'full' | 'half' | 'empty';

/** How star `star` looks for `rating`: full, half or empty. */
export function starFill(rating: number | null | undefined, star: number): StarFill {
  const r = rating ?? 0;
  return r >= star ? 'full' : r >= star - 0.5 ? 'half' : 'empty';
}
