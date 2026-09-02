import { describe, test, expect } from 'vitest';
import { findOrphanPairs, applyPairs } from './pairOrphanMedia.mjs';

const media = (contentId, data) => ({ type: 'media', data: { contentId, ...data } });
const S = 1_788_302_863_259;

describe('findOrphanPairs', () => {
  test('pairs a lone start with a lone end under the same contentId', () => {
    // Session 20260901154746: one 37-minute Insanity play split by a reload.
    const events = [
      media('plex:370729', { title: 'Modified—Friday Fight Round 2', start: S, end: null }),
      media('plex:370729', { title: null, parentTitle: 'Modifier Tracks', start: null, end: S + 2_222_896 }),
    ];
    const [pair] = findOrphanPairs(events);
    expect(pair.contentId).toBe('plex:370729');
    expect(Math.round(pair.spanMs / 60000)).toBe(37);
  });

  test('ignores a complete event', () => {
    expect(findOrphanPairs([media('plex:1', { start: S, end: S + 1000 })])).toEqual([]);
  });

  test('ignores halves belonging to different videos', () => {
    const events = [
      media('plex:1', { start: S, end: null }),
      media('plex:2', { start: null, end: S + 1000 }),
    ];
    expect(findOrphanPairs(events)).toEqual([]);
  });

  test('refuses to weld two separate plays of the same video', () => {
    // Two lone starts means the reload story does not hold; joining any of them
    // would invent a span longer than either play.
    const events = [
      media('plex:1', { start: S, end: null }),
      media('plex:1', { start: S + 5000, end: null }),
      media('plex:1', { start: null, end: S + 9000 }),
    ];
    expect(findOrphanPairs(events)).toEqual([]);
  });

  test('refuses a backwards pair', () => {
    const events = [
      media('plex:1', { start: S, end: null }),
      media('plex:1', { start: null, end: S - 1000 }),
    ];
    expect(findOrphanPairs(events)).toEqual([]);
  });

  test('leaves audio tracks alone', () => {
    const events = [
      media('plex:9', { contentType: 'track', artist: 'A', start: S, end: null }),
      media('plex:9', { contentType: 'track', artist: 'A', start: null, end: S + 1000 }),
    ];
    expect(findOrphanPairs(events)).toEqual([]);
  });
});

describe('applyPairs', () => {
  test('the start half absorbs the end and the end half is dropped', () => {
    const events = [
      media('plex:370729', { title: 'Fight Round 2', start: S, end: null }),
      media('plex:370729', { title: null, parentTitle: 'Modifier Tracks', start: null, end: S + 2_222_896 }),
      media('plex:674470', { title: 'Ride', start: S + 3_000_000, end: S + 4_000_000 }),
    ];
    const out = applyPairs(events, findOrphanPairs(events));
    expect(out).toHaveLength(2);
    const joined = out.find(e => e.data.contentId === 'plex:370729');
    expect(joined.data.start).toBe(S);
    expect(joined.data.end).toBe(S + 2_222_896);
    expect(joined.data.title).toBe('Fight Round 2');       // richer half wins
    expect(joined.data.parentTitle).toBe('Modifier Tracks'); // gap filled from the other
  });

  test('never overwrites a field the start half already has', () => {
    const events = [
      media('plex:1', { title: 'Real', start: S, end: null }),
      media('plex:1', { title: 'Other', start: null, end: S + 1000 }),
    ];
    const [joined] = applyPairs(events, findOrphanPairs(events));
    expect(joined.data.title).toBe('Real');
  });
});
