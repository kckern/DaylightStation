// frontend/src/modules/Surround/segmentNav.test.js
import { describe, it, expect } from 'vitest';
import {
  nextSegmentAction,
  previousSegmentAction,
  RESTART_GRACE_SECONDS,
} from './segmentNav.js';

// The Eroica, verbatim from the live payload (GET /api/v1/play/plex:663134,
// surround.segments). One media item, four segments, and 21.35s of applause
// before the first note — the pre-first region the owner walked into.
const EROICA = Object.freeze([
  { n: 1, contentId: 'plex:663134', part: 0, start: 21.35, end: 976, offset: 0, duration: 954.65 },
  { n: 2, contentId: 'plex:663134', part: 0, start: 976, end: 1925, offset: 954.65, duration: 949 },
  { n: 3, contentId: 'plex:663134', part: 0, start: 1925, end: 2278, offset: 1903.65, duration: 353 },
  { n: 4, contentId: 'plex:663134', part: 0, start: 2278, end: 2955, offset: 2256.65, duration: 677 },
]);
const ERO = 'plex:663134';

// A composed container: part 0 holds TWO segments, parts 1 and 2 one each.
// Shaped like the polonaise season (plex:696237), which is one segment per
// media item, plus a second segment on the first item so the "next segment is
// in the same file" and "next segment is in the next file" cases are both
// reachable from one fixture.
const CONTAINER = Object.freeze([
  { n: 1, contentId: 'plex:ep1', part: 0, start: 0, end: 20, offset: 0, duration: 20 },
  { n: 2, contentId: 'plex:ep1', part: 0, start: 20, end: 30, offset: 20, duration: 10 },
  { n: 1, contentId: 'plex:ep2', part: 1, start: 0, end: 15, offset: 30, duration: 15 },
  { n: 1, contentId: 'plex:ep3', part: 2, start: 0, end: 40, offset: 45, duration: 40 },
]);

describe('RESTART_GRACE_SECONDS', () => {
  it('is the transport\'s one restart grace period, not a second copy of it', () => {
    expect(RESTART_GRACE_SECONDS).toBe(5);
  });
});

describe('nextSegmentAction', () => {
  describe('an item with no segments behaves exactly as today', () => {
    it('advances the queue on an empty segment list', () => {
      expect(nextSegmentAction({ segments: [], contentId: ERO, position: 0 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'no-segments' });
    });

    it('advances the queue when segments is absent altogether', () => {
      expect(nextSegmentAction({ contentId: ERO, position: 900 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'no-segments' });
    });

    it('advances the queue when no segment belongs to this media item', () => {
      expect(nextSegmentAction({ segments: EROICA, contentId: 'plex:999', position: 900 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'no-segments' });
    });
  });

  describe('the pre-first region is real and live', () => {
    it('skips the applause from a standing start', () => {
      expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 0 }))
        .toEqual({ kind: 'seek', seconds: 21.35, segmentIndex: 0 });
    });

    it('skips the applause from inside it', () => {
      expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 20 }))
        .toEqual({ kind: 'seek', seconds: 21.35, segmentIndex: 0 });
    });
  });

  it('seeks to the next segment from the middle of the current one', () => {
    // The owner's press: 500s into the first movement.
    expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 500 }))
      .toEqual({ kind: 'seek', seconds: 976, segmentIndex: 1 });
  });

  it('on the exact boundary, next means the segment AFTER the one starting here', () => {
    expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 976 }))
      .toEqual({ kind: 'seek', seconds: 1925, segmentIndex: 2 });
  });

  it('falls through to the queue from inside the last segment', () => {
    expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 2900 }))
      .toEqual({ kind: 'advance', step: 1, reason: 'last-segment' });
  });

  it('falls through to the queue on the last segment\'s own start', () => {
    expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 2278 }))
      .toEqual({ kind: 'advance', step: 1, reason: 'last-segment' });
  });

  it('falls through to the queue from the tail after the music ends', () => {
    // musicEndsAt 2955; the file runs to 3223.
    expect(nextSegmentAction({ segments: EROICA, contentId: ERO, position: 3000 }))
      .toEqual({ kind: 'advance', step: 1, reason: 'last-segment' });
  });

  describe('a multi-part container', () => {
    it('seeks within the item when the next segment is in the same file', () => {
      expect(nextSegmentAction({ segments: CONTAINER, contentId: 'plex:ep1', position: 5 }))
        .toEqual({ kind: 'seek', seconds: 20, segmentIndex: 1 });
    });

    it('advances the queue when the next segment is in the next item', () => {
      expect(nextSegmentAction({ segments: CONTAINER, contentId: 'plex:ep1', position: 25 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'next-part' });
    });

    it('advances the queue from a middle part whose one segment is running', () => {
      expect(nextSegmentAction({ segments: CONTAINER, contentId: 'plex:ep2', position: 14 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'next-part' });
    });

    it('names the container\'s end, not a next part, on the last item', () => {
      expect(nextSegmentAction({ segments: CONTAINER, contentId: 'plex:ep3', position: 39 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'last-segment' });
    });
  });

  describe('degenerate segments', () => {
    it('is never a seek target when it has no start', () => {
      const segs = [
        { contentId: 'x', start: 0, end: 10, offset: 0, duration: 10 },
        { contentId: 'x', start: undefined, end: undefined, offset: 10, duration: 0 },
      ];
      expect(nextSegmentAction({ segments: segs, contentId: 'x', position: 5 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'last-segment' });
    });

    it('a zero-width trailing segment still has a start, so next lands on it', () => {
      // `starts:` with no `musicEndsAt` — the last segment has a real start and
      // no end. It is never CURRENT (segments.js), but it is seekable.
      const segs = [
        { contentId: 'x', start: 0, end: 100, offset: 0, duration: 100 },
        { contentId: 'x', start: 100, end: undefined, offset: 100, duration: 0 },
      ];
      expect(nextSegmentAction({ segments: segs, contentId: 'x', position: 50 }))
        .toEqual({ kind: 'seek', seconds: 100, segmentIndex: 1 });
    });

    it('a single segment leaves nowhere to go but the queue', () => {
      const segs = [{ contentId: 'x', start: 0, end: 100, offset: 0, duration: 100 }];
      expect(nextSegmentAction({ segments: segs, contentId: 'x', position: 3 }))
        .toEqual({ kind: 'advance', step: 1, reason: 'last-segment' });
    });
  });
});

describe('previousSegmentAction', () => {
  describe('an item with no segments behaves exactly as today', () => {
    it('restarts the file when more than the grace period in', () => {
      expect(previousSegmentAction({ segments: [], contentId: ERO, position: 27 }))
        .toEqual({ kind: 'seek', seconds: 0, segmentIndex: -1, restart: true });
    });

    it('advances backwards through the queue when inside the grace period', () => {
      expect(previousSegmentAction({ segments: [], contentId: ERO, position: 3 }))
        .toEqual({ kind: 'advance', step: -1, reason: 'no-segments' });
    });

    it('treats exactly the grace period as still inside it, as today does', () => {
      expect(previousSegmentAction({ segments: [], contentId: ERO, position: 5 }))
        .toEqual({ kind: 'advance', step: -1, reason: 'no-segments' });
    });
  });

  it('restarts the current segment when more than the grace period into it', () => {
    // 24s into the funeral march.
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 1000 }))
      .toEqual({ kind: 'seek', seconds: 976, segmentIndex: 1, restart: true });
  });

  it('steps back a segment when only just inside the current one', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 979 }))
      .toEqual({ kind: 'seek', seconds: 21.35, segmentIndex: 0, restart: false });
  });

  it('steps back a segment on the current segment\'s exact start', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 976 }))
      .toEqual({ kind: 'seek', seconds: 21.35, segmentIndex: 0, restart: false });
  });

  it('exactly the grace period in still steps back', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 976 + RESTART_GRACE_SECONDS }))
      .toEqual({ kind: 'seek', seconds: 21.35, segmentIndex: 0, restart: false });
  });

  it('a hair past the grace period restarts instead', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 976 + RESTART_GRACE_SECONDS + 0.01 }))
      .toEqual({ kind: 'seek', seconds: 976, segmentIndex: 1, restart: true });
  });

  it('restarts the first segment when well inside it', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 30 }))
      .toEqual({ kind: 'seek', seconds: 21.35, segmentIndex: 0, restart: true });
  });

  it('falls through to the queue when only just inside the first segment', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 25 }))
      .toEqual({ kind: 'advance', step: -1, reason: 'first-segment' });
  });

  it('falls through to the queue from the pre-first region', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 10 }))
      .toEqual({ kind: 'advance', step: -1, reason: 'before-first-segment' });
  });

  it('restarts the last segment from the tail after the music ends', () => {
    expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: 3000 }))
      .toEqual({ kind: 'seek', seconds: 2278, segmentIndex: 3, restart: true });
  });

  describe('a multi-part container', () => {
    it('steps back within the item when the previous segment is in the same file', () => {
      expect(previousSegmentAction({ segments: CONTAINER, contentId: 'plex:ep1', position: 22 }))
        .toEqual({ kind: 'seek', seconds: 0, segmentIndex: 0, restart: false });
    });

    it('restarts the current segment when well into it', () => {
      expect(previousSegmentAction({ segments: CONTAINER, contentId: 'plex:ep1', position: 28 }))
        .toEqual({ kind: 'seek', seconds: 20, segmentIndex: 1, restart: true });
    });

    it('walks back into the previous item rather than seeking across files', () => {
      expect(previousSegmentAction({ segments: CONTAINER, contentId: 'plex:ep2', position: 3 }))
        .toEqual({ kind: 'advance', step: -1, reason: 'prev-part' });
    });

    it('restarts the part\'s own segment when past the grace period', () => {
      expect(previousSegmentAction({ segments: CONTAINER, contentId: 'plex:ep2', position: 10 }))
        .toEqual({ kind: 'seek', seconds: 0, segmentIndex: 2, restart: true });
    });

    it('names the container\'s start, not a previous part, on the first item', () => {
      expect(previousSegmentAction({ segments: CONTAINER, contentId: 'plex:ep1', position: 3 }))
        .toEqual({ kind: 'advance', step: -1, reason: 'first-segment' });
    });
  });

  describe('degenerate segments', () => {
    it('a segment with no start is not a step-back target', () => {
      const segs = [
        { contentId: 'x', start: undefined, end: undefined, offset: 0, duration: 0 },
        { contentId: 'x', start: 10, end: 100, offset: 0, duration: 90 },
      ];
      expect(previousSegmentAction({ segments: segs, contentId: 'x', position: 12 }))
        .toEqual({ kind: 'advance', step: -1, reason: 'first-segment' });
    });

    it('a non-finite position is read as the start of the file', () => {
      expect(previousSegmentAction({ segments: EROICA, contentId: ERO, position: NaN }))
        .toEqual({ kind: 'advance', step: -1, reason: 'before-first-segment' });
    });
  });
});
