import { describe, it, expect } from 'vitest';
import { segmentAt } from './segments.js';

const CH = [
  { contentId: 'plex:ep1', start: 0, end: 10, offset: 0, duration: 10 },
  { contentId: 'plex:ep1', start: 20, end: 35, offset: 10, duration: 15 },
  { contentId: 'plex:ep2', start: 5, end: 15, offset: 25, duration: 10 }
];

describe('segmentAt — basics', () => {
  it('maps a position inside a segment to its place on the global rail', () => {
    expect(segmentAt({ segments: CH, contentId: 'plex:ep1', position: 25 }))
      .toEqual({ index: 1, globalSeconds: 15 });
  });

  it('reports nothing sounding inside dead time', () => {
    expect(segmentAt({ segments: CH, contentId: 'plex:ep1', position: 15 }))
      .toEqual({ index: -1, globalSeconds: 10 });
  });

  it('never matches a segment from a different media item', () => {
    // A position of 25s in ep2's own local timeline (its segment runs 5-15s)
    // must not resolve against ep1's segment that happens to span 25s.
    expect(segmentAt({ segments: CH, contentId: 'plex:ep2', position: 25 }).index).toBe(-1);
  });
});

/**
 * The tie-break contract, quoted from `withOffsets` in
 * backend/src/1_adapters/content/surround/segments.mjs:
 *
 *   "A segment owns the half-open interval [offset, offset + duration).
 *   Where several segments share one offset, the LAST of them wins. A
 *   zero-width segment's interval is empty, so it is never current for any
 *   position. A position landing exactly on a boundary belongs to the
 *   segment that is starting, not the one that just ended."
 *
 * Each test below is chosen so a specific, plausible wrong implementation
 * makes it fail -- see the comment on each for what that implementation is.
 */
describe('segmentAt — the tie-break contract', () => {
  it('a position exactly on a real segment\'s end boundary, with a gap after it, is dead time — not that segment', () => {
    // position=10 sits exactly on CH[0]'s end (half-open [0,10)) and CH[1]
    // doesn't start until 20, so nothing is current. FAILS if the end
    // comparison is closed (`position <= c.end`): CH[0] would wrongly match,
    // returning index 0 instead of -1 — reporting the segment that JUST
    // ENDED as still current.
    expect(segmentAt({ segments: CH, contentId: 'plex:ep1', position: 10 }))
      .toEqual({ index: -1, globalSeconds: 10 });
  });

  it('a zero-width segment parked between two real ones never wins, even though it shares an offset with the one starting there', () => {
    // The real production shape: an item's trailing segment has no
    // authored musicEndsAt, so it gets duration 0 and is placed at the same
    // offset (10) as the real segment that starts right after it. Three
    // segments here share/touch offset 10: CH[0] just ended there, CH[1] is
    // the zero-width one, CH[2] is starting.
    const segments = [
      { contentId: 'plex:season1', start: 0, end: 10, offset: 0, duration: 10 },
      { contentId: 'plex:season1', start: 10, end: 10, offset: 10, duration: 0 },
      { contentId: 'plex:season1', start: 10, end: 20, offset: 10, duration: 10 }
    ];
    // FAILS if the zero-width segment (index 1) is ever treated as current —
    // e.g. an implementation that matches on `position >= c.start` alone,
    // without also requiring `position < c.end`, would report index 1
    // instead of the segment that is actually starting.
    expect(segmentAt({ segments, contentId: 'plex:season1', position: 10 }))
      .toEqual({ index: 2, globalSeconds: 10 });
  });

  it('several segments sharing one offset (two untimed, one real) resolve to the real one, never the placeholders', () => {
    // Offsets can only repeat when duration is 0, so a real tie is always a
    // run of empty segments ending in at most one real one. All three of
    // these share offset 10.
    const segments = [
      { contentId: 'plex:etude', start: 0, end: 10, offset: 0, duration: 10 },
      { contentId: 'plex:etude', start: 10, end: 10, offset: 10, duration: 0 },
      { contentId: 'plex:etude', start: 10, end: undefined, offset: 10, duration: 0 },
      { contentId: 'plex:etude', start: 10, end: 25, offset: 10, duration: 15 }
    ];
    // FAILS if either untimed segment (index 1 or 2) is ever reported as
    // current, or if the offset tie causes the wrong index to be returned.
    expect(segmentAt({ segments, contentId: 'plex:etude', position: 10 }))
      .toEqual({ index: 3, globalSeconds: 10 });
  });

  it('genuinely overlapping real segments resolve to the LAST match, not the first', () => {
    // Explicit `spans:` are taken verbatim by the backend (a gap between two
    // is real content, so overlap is not rejected either), so two real
    // segments of the same item CAN legitimately overlap in local time —
    // e.g. an editorially-added highlight nested inside a longer segment.
    // Both of these contain position=15.
    const segments = [
      { contentId: 'plex:work', start: 0, end: 20, offset: 0, duration: 20 },
      { contentId: 'plex:work', start: 10, end: 30, offset: 20, duration: 20 }
    ];
    // THIS is the test that isolates "last wins" from mere half-open
    // correctness: both candidates are non-empty and both contain the
    // position, so only the tie-break rule (not the interval boundary rule)
    // decides between them. FAILS under first-match-wins (an early `return`
    // on the first containing segment instead of scanning to the end):
    // that would report index 0 / globalSeconds 15 instead of index 1 /
    // globalSeconds 25.
    expect(segmentAt({ segments, contentId: 'plex:work', position: 15 }))
      .toEqual({ index: 1, globalSeconds: 25 });
  });

  it('dead time before an item\'s own first segment reports the rail position where THIS item starts, not 0', () => {
    // The Eroica's own first segment starts at 21.35s, after applause. Here
    // it's the second item in a container (item A already claimed 500s of
    // sounding time), so its own lead-in applause should report 500, not 0.
    const segments = [
      { contentId: 'plex:itemA', start: 0, end: 500, offset: 0, duration: 500 },
      { contentId: 'plex:eroica', start: 21.35, end: 900, offset: 500, duration: 878.65 }
    ];
    // FAILS if dead time before the item's own first segment is computed
    // from a global default of 0 instead of that segment's own offset.
    expect(segmentAt({ segments, contentId: 'plex:eroica', position: 10 }))
      .toEqual({ index: -1, globalSeconds: 500 });
  });
});

describe('segmentAt — dead time and empty input', () => {
  it('reports dead time with globalSeconds 0 when the item owns no segments here at all', () => {
    expect(segmentAt({ segments: CH, contentId: 'plex:unknown', position: 42 }))
      .toEqual({ index: -1, globalSeconds: 0 });
  });

  it('reports dead time with globalSeconds 0 for an empty segments list', () => {
    expect(segmentAt({ segments: [], contentId: 'plex:ep1', position: 5 }))
      .toEqual({ index: -1, globalSeconds: 0 });
  });
});
