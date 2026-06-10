import { describe, it, test, expect, beforeEach } from 'vitest';
import { recordRecent, readRecents, RECENTS_KEY, MAX_RECENTS } from './recents.js';

beforeEach(() => { localStorage.clear(); });

test('readRecents returns empty array initially', () => {
  expect(readRecents()).toEqual([]);
});

test('recordRecent stores at the front', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  recordRecent({ contentId: 'plex:2', title: 'B', thumbnail: null });
  expect(readRecents().map((r) => r.contentId)).toEqual(['plex:2', 'plex:1']);
});

test('re-recording an existing item moves it to the front, no duplicates', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  recordRecent({ contentId: 'plex:2', title: 'B', thumbnail: null });
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  expect(readRecents().map((r) => r.contentId)).toEqual(['plex:1', 'plex:2']);
});

test('caps at MAX_RECENTS', () => {
  for (let i = 0; i < MAX_RECENTS + 5; i += 1) {
    recordRecent({ contentId: `plex:${i}`, title: String(i), thumbnail: null });
  }
  expect(readRecents()).toHaveLength(MAX_RECENTS);
});

test('ignores items without a contentId', () => {
  recordRecent({ title: 'no id' });
  expect(readRecents()).toEqual([]);
});

test('survives corrupted storage', () => {
  localStorage.setItem(RECENTS_KEY, 'not-json');
  expect(readRecents()).toEqual([]);
});
