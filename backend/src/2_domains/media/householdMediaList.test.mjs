import { describe, it, expect } from 'vitest';
import {
  addFavourite,
  removeFavourite,
  markRemoved,
  restoreRemoved,
  isHiddenByRemoval,
  buildHouseholdRecent,
  buildCarryOn,
  finishedEpisodeCandidates,
} from './householdMediaList.mjs';

const rec = (contentId, over = {}) => ({ contentId, namespaceId: 'plex/6_movies', playhead: 0, duration: 0, lastPlayed: null, ...over });

describe('favourites (RQ-FIND-14)', () => {
  it('adds newest first and is idempotent per id (re-adding refreshes, never duplicates)', () => {
    let list = addFavourite([], { id: 'plex:1', kind: 'item', title: 'A' }, '2026-10-01T00:00:00Z');
    list = addFavourite(list, { id: 'plex:2', kind: 'collection', title: 'B' }, '2026-10-02T00:00:00Z');
    list = addFavourite(list, { id: 'plex:1', kind: 'item', title: 'A2' }, '2026-10-03T00:00:00Z');
    expect(list.map((f) => f.id)).toEqual(['plex:1', 'plex:2']);
    expect(list[0]).toMatchObject({ title: 'A2', addedAt: '2026-10-03T00:00:00Z', kind: 'item' });
  });
  it('defaults kind to item and rejects a kind it does not know', () => {
    expect(addFavourite([], { id: 'plex:1' }, 't')[0].kind).toBe('item');
    expect(() => addFavourite([], { id: 'plex:1', kind: 'banana' }, 't')).toThrow(/kind/);
    expect(() => addFavourite([], { id: '' }, 't')).toThrow(/id/);
  });
  it('removes by id', () => {
    const list = addFavourite([], { id: 'plex:1' }, 't');
    expect(removeFavourite(list, 'plex:1')).toEqual([]);
    expect(removeFavourite(list, 'plex:9')).toEqual(list);
  });
});

describe('removal from the household list (RQ-FIND-15)', () => {
  it('hides what was played before the removal, and lets a later play bring it back', () => {
    const removed = markRemoved({}, 'plex:1', '2026-10-02T12:00:00Z');
    expect(isHiddenByRemoval(removed, 'plex:1', '2026-10-02 04:00:00')).toBe(true);
    expect(isHiddenByRemoval(removed, 'plex:1', '2099-01-01 00:00:00')).toBe(false);
    expect(isHiddenByRemoval(removed, 'plex:2', '2026-10-02 04:00:00')).toBe(false);
  });
  it('restore (undo) un-removes', () => {
    const removed = markRemoved({}, 'plex:1', '2026-10-02T12:00:00Z');
    expect(restoreRemoved(removed, 'plex:1')).toEqual({});
  });
});

describe('buildHouseholdRecent (RQ-FIND-11)', () => {
  const records = [
    rec('plex:old', { lastPlayed: '2026-09-01 10:00:00', playhead: 100, duration: 1000 }),
    rec('plex:tv', {
      lastPlayed: '2026-10-01 21:00:00', playhead: 4800, duration: 7200, lastDevice: 'fleet:livingroom-tv',
      spots: { 'fleet:livingroom-tv': { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' } },
    }),
    rec('plex:kid', {
      lastPlayed: '2026-10-02 08:00:00', playhead: 720, duration: 7200, lastDevice: 'browser:kid',
      spots: { 'browser:kid': { playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00' } },
    }),
    rec('plex:marked', { lastPlayed: null, playhead: 100, duration: 100 }),
    rec('plex:gone', { lastPlayed: '2026-10-02 07:00:00', playhead: 10, duration: 100 }),
  ];
  const removed = markRemoved({}, 'plex:gone', '2026-10-02T23:00:00');

  it('lists items played on any screen, newest first, each labelled with where it played', () => {
    const out = buildHouseholdRecent(records, { removed, limit: 10 });
    expect(out.map((e) => e.contentId)).toEqual(['plex:kid', 'plex:tv', 'plex:old']);
    expect(out[0].playedOn).toEqual({ deviceId: 'browser:kid', kind: 'browser', screenId: null });
    expect(out[1].playedOn).toEqual({ deviceId: 'fleet:livingroom-tv', kind: 'screen', screenId: 'livingroom-tv' });
    expect(out[2].playedOn).toBeNull();
  });
  it('carries every screen\'s spot', () => {
    const out = buildHouseholdRecent(records, { removed, limit: 10 });
    expect(out[1].spots).toEqual([
      expect.objectContaining({ deviceId: 'fleet:livingroom-tv', playhead: 4800, duration: 7200, percent: 67, open: true }),
    ]);
  });
  it('honours the limit', () => {
    expect(buildHouseholdRecent(records, { removed, limit: 1 }).map((e) => e.contentId)).toEqual(['plex:kid']);
  });
  it('merges the same content id seen in two namespaces, keeping the newest', () => {
    const dup = [
      rec('plex:x', { lastPlayed: '2026-10-01 00:00:00', namespaceId: 'plex' }),
      rec('plex:x', { lastPlayed: '2026-10-02 00:00:00', namespaceId: 'plex/6_movies' }),
    ];
    const out = buildHouseholdRecent(dup, { removed: {}, limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].namespaceId).toBe('plex/6_movies');
  });
});

describe('buildCarryOn (RQ-FIND-12, RQ-PLAY-09)', () => {
  const records = [
    rec('plex:film', {
      lastPlayed: '2026-10-02 09:00:00', playhead: 7100, duration: 7200, completedAt: '2026-10-02 09:00:00', lastDevice: 'fleet:office-tv',
      spots: {
        'fleet:office-tv': { playhead: 7100, duration: 7200, lastPlayed: '2026-10-02 09:00:00' },
        'fleet:livingroom-tv': { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' },
      },
    }),
    rec('plex:done', {
      lastPlayed: '2026-10-02 10:00:00', playhead: 7100, duration: 7200, lastDevice: 'fleet:office-tv',
      spots: { 'fleet:office-tv': { playhead: 7100, duration: 7200, lastPlayed: '2026-10-02 10:00:00' } },
    }),
    rec('plex:barely', { lastPlayed: '2026-10-02 11:00:00', playhead: 60, duration: 7200 }),
    rec('plex:legacy', { lastPlayed: '2026-09-20 11:00:00', playhead: 1200, duration: 3600 }),
    rec('plex:playing', { lastPlayed: '2026-10-02 12:00:00', playhead: 1200, duration: 3600 }),
    rec('plex:removed', { lastPlayed: '2026-10-02 12:30:00', playhead: 1200, duration: 3600 }),
  ];
  const removed = markRemoved({}, 'plex:removed', '2026-10-02T23:59:59');
  const nowPlaying = [{ deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', contentId: 'plex:playing', state: 'playing', position: 1300 }];

  it('lists unfinished items; an item stays while ANY screen holds an open spot', () => {
    const { items } = buildCarryOn(records, { removed, nowPlaying, limit: 10 });
    expect(items.map((e) => e.contentId)).toEqual(['plex:film', 'plex:legacy']);
    expect(items[0].spots.map((s) => s.deviceId)).toEqual(['fleet:livingroom-tv']);
    expect(items[0].reason).toBe('unfinished');
  });
  it('drops finished items and items under 5 min / 5%', () => {
    const { items } = buildCarryOn(records, { removed, nowPlaying, limit: 10 });
    expect(items.find((e) => e.contentId === 'plex:done')).toBeUndefined();
    expect(items.find((e) => e.contentId === 'plex:barely')).toBeUndefined();
  });
  it('moves anything playing on a screen right now to nowOn instead', () => {
    const { items, nowOn } = buildCarryOn(records, { removed, nowPlaying, limit: 10 });
    expect(items.find((e) => e.contentId === 'plex:playing')).toBeUndefined();
    expect(nowOn).toEqual([expect.objectContaining({ contentId: 'plex:playing', deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', state: 'playing', position: 1300 })]);
  });
  it('hides removed items', () => {
    const { items } = buildCarryOn(records, { removed, nowPlaying, limit: 10 });
    expect(items.find((e) => e.contentId === 'plex:removed')).toBeUndefined();
  });
});

describe('finishedEpisodeCandidates', () => {
  it('offers recently finished items with no open spot, newest first, not removed', () => {
    const records = [
      rec('plex:e1', { lastPlayed: '2026-10-01 20:00:00', playhead: 1300, duration: 1400, completedAt: '2026-10-01 20:00:00' }),
      rec('plex:e2', { lastPlayed: '2026-10-02 20:00:00', playhead: 1300, duration: 1400, completedAt: '2026-10-02 20:00:00' }),
      rec('plex:half', { lastPlayed: '2026-10-02 21:00:00', playhead: 700, duration: 1400 }),
      rec('plex:gone', { lastPlayed: '2026-10-02 19:00:00', playhead: 1400, duration: 1400 }),
    ];
    const removed = markRemoved({}, 'plex:gone', '2026-10-03T00:00:00');
    expect(finishedEpisodeCandidates(records, { removed, limit: 5 }).map((r) => r.contentId)).toEqual(['plex:e2', 'plex:e1']);
  });
});

describe('buildHouseholdRecent with the play ledger', () => {
  const plays = [
    { startedAt: '2026-10-01T03:00:00.000Z', localTime: '2026-09-30 20:00:00', deviceId: 'fleet:livingroom-tv', contentId: 'plex:legacy', origin: null },
    { startedAt: '2026-10-02T15:00:00.000Z', localTime: '2026-10-02 08:00:00', deviceId: 'browser:kid', contentId: 'plex:legacy', origin: 'cast' },
    { startedAt: '2026-10-02T16:00:00.000Z', localTime: '2026-10-02 09:00:00', deviceId: 'fleet:office-tv', contentId: 'plex:ledger-only', origin: null },
  ];
  const records = [rec('plex:legacy', { lastPlayed: '2026-10-02 08:30:00', playhead: 100, duration: 1000 })];

  it('labels a pre-spots record with the screen that last started it, and lists starts newest first', () => {
    const out = buildHouseholdRecent(records, { removed: {}, plays });
    const legacy = out.find((e) => e.contentId === 'plex:legacy');
    expect(legacy.playedOn).toEqual({ deviceId: 'browser:kid', kind: 'browser', screenId: null });
    expect(legacy.plays.map((p) => [p.deviceId, p.origin])).toEqual([['browser:kid', 'cast'], ['fleet:livingroom-tv', null]]);
  });
  it('includes items only the ledger saw', () => {
    const out = buildHouseholdRecent(records, { removed: {}, plays });
    expect(out.map((e) => e.contentId)).toEqual(['plex:ledger-only', 'plex:legacy']);
    expect(out[0].playedOn.screenId).toBe('office-tv');
  });
});
