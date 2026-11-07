import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRecentSearch,
  clearRecentSearches,
  RECENT_MAX,
  recentSearches,
  removeRecentSearch,
} from '../src/lib/recent';

beforeEach(() => clearRecentSearches());

describe('recent searches', () => {
  it('keeps the newest first, stored on this browser', () => {
    addRecentSearch('dune');
    addRecentSearch('  Orwell  ');
    expect(recentSearches()).toEqual(['Orwell', 'dune']);
    expect(JSON.parse(localStorage.getItem('ol.recentSearches')!)).toEqual(['Orwell', 'dune']);
  });

  it('does not repeat a search that differs in case or accents, and moves it to the top', () => {
    addRecentSearch('García Márquez');
    addRecentSearch('dune');
    addRecentSearch('garcia marquez');
    expect(recentSearches()).toEqual(['garcia marquez', 'dune']);
  });

  it(`keeps at most ${RECENT_MAX}`, () => {
    for (let i = 1; i <= 10; i++) addRecentSearch(`q${i}`);
    expect(recentSearches()).toHaveLength(RECENT_MAX);
    expect(recentSearches()[0]).toBe('q10');
    expect(recentSearches()).not.toContain('q2');
  });

  it('ignores empty searches and removes one or all', () => {
    addRecentSearch('   ');
    addRecentSearch('a');
    addRecentSearch('b');
    removeRecentSearch('a');
    expect(recentSearches()).toEqual(['b']);
    clearRecentSearches();
    expect(recentSearches()).toEqual([]);
  });
});
