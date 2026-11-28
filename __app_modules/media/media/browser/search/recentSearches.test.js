import { describe, it, expect, beforeEach } from 'vitest';
import {
  RECENT_SEARCHES_KEY, RECENT_SEARCHES_CAP, recentSearches, rememberSearch, forgetSearch, clearSearches,
  subscribeRecentSearches, resetRecentSearchesCache,
} from './recentSearches.js';
import { continueRows, searchRows } from './useSearchRecents.js';

beforeEach(() => {
  localStorage.clear();
  resetRecentSearchesCache();
});

describe('recent searches storage (owner ruling 2026-11-27)', () => {
  it('keeps the words with their scope, newest first, in localStorage', () => {
    rememberSearch({ text: 'arrival', scopeKey: 'video-movies', scopeLabel: 'Movies' }, 1);
    rememberSearch({ text: 'nephi', scopeKey: 'books-scripture', scopeLabel: 'Scripture' }, 2);
    expect(recentSearches().map((e) => [e.text, e.scopeKey, e.scopeLabel])).toEqual([
      ['nephi', 'books-scripture', 'Scripture'],
      ['arrival', 'video-movies', 'Movies'],
    ]);
    resetRecentSearchesCache();
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY))[0].text).toBe('nephi');
    expect(recentSearches()).toHaveLength(2);
  });

  it('dedupes case-insensitively: the newest spelling and scope win, once', () => {
    rememberSearch({ text: 'Nephi', scopeKey: 'all', scopeLabel: 'All' }, 1);
    rememberSearch({ text: 'arrival', scopeKey: 'all', scopeLabel: 'All' }, 2);
    rememberSearch({ text: 'nephi', scopeKey: 'books-scripture', scopeLabel: 'Scripture' }, 3);
    expect(recentSearches().map((e) => [e.text, e.scopeKey])).toEqual([
      ['nephi', 'books-scripture'],
      ['arrival', 'all'],
    ]);
  });

  it(`caps at ${RECENT_SEARCHES_CAP}`, () => {
    for (let i = 0; i < 25; i += 1) rememberSearch({ text: `word ${i}` }, i);
    const list = recentSearches();
    expect(list).toHaveLength(RECENT_SEARCHES_CAP);
    expect(list[0].text).toBe('word 24');
    expect(list.at(-1).text).toBe('word 5');
  });

  it('ignores words too short to have been a search', () => {
    rememberSearch({ text: ' a ' });
    expect(recentSearches()).toEqual([]);
  });

  it('× forgets one (any case); Clear forgets all; listeners hear both', () => {
    let heard = 0;
    const off = subscribeRecentSearches(() => { heard += 1; });
    rememberSearch({ text: 'nephi' });
    rememberSearch({ text: 'arrival' });
    forgetSearch('NEPHI');
    expect(recentSearches().map((e) => e.text)).toEqual(['arrival']);
    clearSearches();
    expect(recentSearches()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY))).toEqual([]);
    expect(heard).toBe(4);
    off();
  });

  it('survives unreadable storage', () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, '{not json');
    resetRecentSearchesCache();
    expect(recentSearches()).toEqual([]);
  });
});

describe('rows for the empty box', () => {
  it('Continue: unfinished only, most recently played first, at most 4, as result rows', () => {
    const entries = [
      { contentId: 'plex:1', title: 'Old', lastPlayed: '2026-11-20 10:00:00', finished: false, type: 'movie' },
      { contentId: 'plex:2', title: 'Done', lastPlayed: '2026-11-27 10:00:00', finished: true },
      { contentId: 'plex:3', title: 'Newest', lastPlayed: '2026-11-27 09:00:00', grandparentTitle: 'Boethius', type: 'track' },
      { contentId: 'plex:4', title: 'B', lastPlayed: '2026-11-25 09:00:00' },
      { contentId: 'plex:5', title: 'C', lastPlayed: '2026-11-24 09:00:00' },
      { contentId: 'plex:6', title: 'D', lastPlayed: '2026-11-23 09:00:00' },
    ];
    const rows = continueRows(entries);
    expect(rows.map((r) => r.id)).toEqual(['plex:3', 'plex:4', 'plex:5', 'plex:6']);
    expect(rows[0]).toMatchObject({ title: 'Newest', itemType: 'leaf', parentTitle: 'Boethius', type: 'track' });
    expect(continueRows(undefined)).toEqual([]);
  });

  it('Recent searches: 5 rows, words plus the scope tag (none for All)', () => {
    const list = [
      { text: 'nephi', scopeKey: 'books-scripture', scopeLabel: 'Scripture' },
      { text: 'arrival', scopeKey: 'all', scopeLabel: 'All' },
      ...Array.from({ length: 6 }, (_, i) => ({ text: `w${i}`, scopeKey: null, scopeLabel: null })),
    ];
    const rows = searchRows(list, 'all');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ text: 'nephi', tag: 'Scripture', scopeKey: 'books-scripture' });
    expect(rows[1].tag).toBeNull();
  });
});
