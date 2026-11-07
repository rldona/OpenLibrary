/**
 * The wishlist's order and priority filter, kept in the URL like the library's (`?sort=` and
 * `?priority=`). The server already returns open wishes by priority, then newest first.
 */
import { WISH_PRIORITIES, type WishDTO } from '@openlibrary/contracts/client';
import { foldSearch } from './recent';

export const WISH_SORTS = ['priority', 'added', 'title'] as const;
export type WishSort = (typeof WISH_SORTS)[number];
export type WishPriority = (typeof WISH_PRIORITIES)[number];
export type WishView = { sort: WishSort; priority: WishPriority | undefined };

export function wishViewOf(params: URLSearchParams): WishView {
  const sort = params.get('sort');
  const priority = params.get('priority');
  return {
    sort: (WISH_SORTS as readonly string[]).includes(sort ?? '') ? (sort as WishSort) : 'priority',
    priority: (WISH_PRIORITIES as readonly string[]).includes(priority ?? '')
      ? (priority as WishPriority)
      : undefined,
  };
}

const RANK: Record<WishPriority, number> = { high: 0, normal: 1, low: 2 };
const newestFirst = (a: WishDTO, b: WishDTO) => b.createdAt.localeCompare(a.createdAt);

/** The wishes to show, filtered and in order (ties: newest first). */
export function arrangeWishes(items: readonly WishDTO[], view: WishView): WishDTO[] {
  const shown = view.priority ? items.filter((w) => w.priority === view.priority) : [...items];
  const order: Record<WishSort, (a: WishDTO, b: WishDTO) => number> = {
    priority: (a, b) => RANK[a.priority] - RANK[b.priority] || newestFirst(a, b),
    added: newestFirst,
    title: (a, b) => foldSearch(a.title).localeCompare(foldSearch(b.title)) || newestFirst(a, b),
  };
  return shown.sort(order[view.sort]);
}
