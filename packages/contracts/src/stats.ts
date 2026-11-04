/**
 * Statistics (F4, UC11). The same definitions are computed by the server (GET /stats) and by the Android
 * app on its local copy; a shared fixture keeps both in step.
 *
 * - A work or edition is "in the collection" when it has at least one active copy (BR14: wishes never count).
 * - Reading status per work in the collection is derived from its sessions (BR13).
 * - Reading by year counts sessions finished as `read` in that year: distinct works and the pages of the
 *   edition of each session's copy. Acquired by year counts every copy (also retired) by `acquiredOn`.
 * - Rankings are by count, then by name; authors and subjects count works, languages count editions.
 */
export type CountBy = { key: string; count: number };

export type StatsDTO = {
  collection: {
    works: number;
    editions: number;
    copies: number;
    retiredCopies: number;
    copiesWithoutLocation: number;
    provisionalEditions: number;
    locations: number;
    /** Sum of the price of active copies, per currency (cents). */
    value: { currency: string; cents: number }[];
  };
  reading: {
    read: number;
    reading: number;
    pending: number;
    finishedSessions: number;
    abandonedSessions: number;
    /** Average rating of finished sessions that have one, rounded to 2 decimals. */
    averageRating: number | null;
    byYear: { year: number; works: number; pages: number }[];
  };
  acquiredByYear: { year: number; copies: number }[];
  authors: CountBy[];
  subjects: CountBy[];
  /** Language code of the edition; '' when unknown. */
  languages: CountBy[];
  wishlistOpen: number;
};

export const STATS_TOP = 10;
