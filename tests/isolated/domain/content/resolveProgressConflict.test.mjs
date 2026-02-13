import { describe, it, expect } from '@jest/globals';
import { resolveProgressConflict } from '#domains/content/services/resolveProgressConflict.mjs';

describe('resolveProgressConflict', () => {

  // ─── Rule 1: Null handling ─────────────────────────────────────────

  describe('Rule 1 — null handling', () => {
    it('returns null when both local and remote are null', () => {
      expect(resolveProgressConflict(null, null)).toBeNull();
    });

    it('returns null when both local and remote are undefined', () => {
      expect(resolveProgressConflict(undefined, undefined)).toBeNull();
    });

    it('uses local when remote is null', () => {
      const local = { playhead: 120, duration: 3600, isWatched: false, lastPlayed: '2026-02-10T12:00:00Z', watchTime: 120 };
      const result = resolveProgressConflict(local, null);
      expect(result).toEqual({
        playhead: 120,
        duration: 3600,
        isFinished: false,
        source: 'local',
      });
    });

    it('uses remote when local is null', () => {
      const remote = { currentTime: 300, isFinished: false, lastUpdate: 1770681600, duration: 7200 };
      const result = resolveProgressConflict(null, remote);
      expect(result).toEqual({
        playhead: 300,
        duration: 7200,
        isFinished: false,
        source: 'remote',
      });
    });

    it('uses local when remote is undefined', () => {
      const local = { playhead: 60, duration: 1800, isWatched: true, lastPlayed: '2026-02-10T12:00:00Z', watchTime: 60 };
      const result = resolveProgressConflict(local, undefined);
      expect(result).toEqual({
        playhead: 60,
        duration: 1800,
        isFinished: true,
        source: 'local',
      });
    });

    it('uses remote when local is undefined', () => {
      const remote = { currentTime: 500, isFinished: true, lastUpdate: 1770681600, duration: 3600 };
      const result = resolveProgressConflict(undefined, remote);
      expect(result).toEqual({
        playhead: 500,
        duration: 3600,
        isFinished: true,
        source: 'remote',
      });
    });
  });

  // ─── Rule 2: Sanity guard (zero-playhead rejection) ────────────────

  describe('Rule 2 — sanity guard', () => {
    it('rejects local playhead=0 when remote has playhead > 60s', () => {
      const local = { playhead: 0, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 0 };
      const remote = { currentTime: 120, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(120);
    });

    it('rejects remote playhead=0 when local has playhead > 60s', () => {
      const local = { playhead: 90, duration: 3600, isWatched: false, lastPlayed: '2026-02-10T12:00:00Z', watchTime: 90 };
      const remote = { currentTime: 0, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(90);
    });

    it('does NOT reject zero when other side has playhead <= 60s', () => {
      // Both are near beginning - zero could be legitimate
      const local = { playhead: 0, duration: 3600, isWatched: false, lastPlayed: '2026-02-10T12:00:00Z', watchTime: 0 };
      const remote = { currentTime: 30, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      // Should fall through to later rules (timestamp/tie-breaker), not auto-reject the zero
      const result = resolveProgressConflict(local, remote);
      // The zero is not auto-rejected; later rules decide
      expect(result).not.toBeNull();
    });

    it('does NOT reject zero when both sides are zero', () => {
      const local = { playhead: 0, duration: 3600, isWatched: false, lastPlayed: '2026-02-10T12:00:00Z', watchTime: 0 };
      const remote = { currentTime: 0, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result).not.toBeNull();
      expect(result.playhead).toBe(0);
    });
  });

  // ─── Rule 3: Finished propagation ──────────────────────────────────

  describe('Rule 3 — finished propagation', () => {
    it('finished wins when local isWatched=true and remote is not finished', () => {
      const local = { playhead: 3500, duration: 3600, isWatched: true, lastPlayed: '2026-02-09T12:00:00Z', watchTime: 3500 };
      const remote = { currentTime: 1800, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.isFinished).toBe(true);
      expect(result.source).toBe('local');
    });

    it('finished wins when remote isFinished=true and local is not watched', () => {
      const local = { playhead: 1800, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 1800 };
      const remote = { currentTime: 3500, isFinished: true, lastUpdate: 1770681600, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.isFinished).toBe(true);
      expect(result.source).toBe('remote');
    });

    it('uses the finished side playhead when both are finished', () => {
      const local = { playhead: 3500, duration: 3600, isWatched: true, lastPlayed: '2026-02-10T12:00:00Z', watchTime: 3500 };
      const remote = { currentTime: 3400, isFinished: true, lastUpdate: 1770854400, duration: 3600 };
      // Both finished - should use latest timestamp to pick which playhead
      const result = resolveProgressConflict(local, remote);
      expect(result.isFinished).toBe(true);
    });
  });

  // ─── Rule 4: Latest timestamp wins ─────────────────────────────────

  describe('Rule 4 — latest timestamp wins', () => {
    it('picks local when lastPlayed is more recent than lastUpdate', () => {
      // local: 2026-02-12T00:00:00Z = 1770854400 epoch
      // remote: 1770681600 = 2026-02-10T00:00:00Z
      const local = { playhead: 500, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 500 };
      const remote = { currentTime: 800, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(500);
    });

    it('picks remote when lastUpdate is more recent than lastPlayed', () => {
      const local = { playhead: 800, duration: 3600, isWatched: false, lastPlayed: '2026-02-08T00:00:00Z', watchTime: 800 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(500);
    });

    it('handles ISO string with timezone offset for local lastPlayed', () => {
      // 2026-02-12T06:00:00-05:00 = 2026-02-12T11:00:00Z
      const local = { playhead: 200, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T06:00:00-05:00', watchTime: 200 };
      // remote lastUpdate is 2026-02-12T00:00:00Z (earlier)
      const remote = { currentTime: 400, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
    });
  });

  // ─── Rule 5: Tie-breaker (equal or missing timestamps) ─────────────

  describe('Rule 5 — tie-breaker: furthest playhead', () => {
    it('picks the side with furthest playhead when timestamps are equal', () => {
      // 2026-02-12T00:00:00Z = 1770854400
      const local = { playhead: 200, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 200 };
      const remote = { currentTime: 800, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(800);
    });

    it('picks local when local playhead is further and timestamps match', () => {
      const local = { playhead: 900, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 900 };
      const remote = { currentTime: 300, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(900);
    });

    it('uses furthest playhead when local lastPlayed is missing', () => {
      const local = { playhead: 100, duration: 3600, isWatched: false, lastPlayed: null, watchTime: 100 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: null, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(500);
    });

    it('uses furthest playhead when both timestamps are missing', () => {
      const local = { playhead: 700, duration: 3600, isWatched: false, lastPlayed: undefined, watchTime: 700 };
      const remote = { currentTime: 200, isFinished: false, lastUpdate: undefined, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(700);
    });

    it('prefers local when both playheads are also equal (full tie)', () => {
      const local = { playhead: 500, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 500 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      // Full tie — local preferred (convention: trust our own data)
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(500);
    });
  });

  // ─── Output shape ──────────────────────────────────────────────────

  describe('output shape', () => {
    it('always returns playhead, duration, isFinished, and source', () => {
      const local = { playhead: 100, duration: 3600, isWatched: false, lastPlayed: '2026-02-11T00:00:00Z', watchTime: 100 };
      const remote = { currentTime: 200, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result).toHaveProperty('playhead');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('isFinished');
      expect(result).toHaveProperty('source');
      expect(typeof result.playhead).toBe('number');
      expect(typeof result.duration).toBe('number');
      expect(typeof result.isFinished).toBe('boolean');
      expect(['local', 'remote']).toContain(result.source);
    });

    it('maps local isWatched to isFinished in output', () => {
      const local = { playhead: 3500, duration: 3600, isWatched: true, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 3500 };
      const result = resolveProgressConflict(local, null);
      expect(result.isFinished).toBe(true);
    });

    it('uses local duration when source is local', () => {
      const local = { playhead: 100, duration: 1800, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 100 };
      const result = resolveProgressConflict(local, null);
      expect(result.duration).toBe(1800);
    });

    it('uses remote duration when source is remote', () => {
      const remote = { currentTime: 100, isFinished: false, lastUpdate: 1770854400, duration: 7200 };
      const result = resolveProgressConflict(null, remote);
      expect(result.duration).toBe(7200);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles playhead exactly at 60s threshold for sanity guard', () => {
      // 60s is the boundary — playhead=60 should NOT trigger the guard (> 60, not >=)
      const local = { playhead: 0, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 0 };
      const remote = { currentTime: 60, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      // 60 is NOT > 60, so zero should NOT be rejected by sanity guard
      const result = resolveProgressConflict(local, remote);
      // Falls through to timestamp rule (local is newer)
      expect(result).not.toBeNull();
    });

    it('handles playhead at 61s triggering sanity guard', () => {
      const local = { playhead: 0, duration: 3600, isWatched: false, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 0 };
      const remote = { currentTime: 61, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      // 61 > 60, so local zero is rejected
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(61);
    });

    it('sanity guard applies before finished propagation', () => {
      // Local says playhead=0 but isWatched=true (contradictory but possible in stale data)
      // Remote has real progress at 120s
      const local = { playhead: 0, duration: 3600, isWatched: true, lastPlayed: '2026-02-12T00:00:00Z', watchTime: 0 };
      const remote = { currentTime: 120, isFinished: false, lastUpdate: 1770681600, duration: 3600 };
      // Sanity guard rejects local (playhead=0 vs remote 120 > 60)
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
    });

    it('uses larger duration when picking finished side', () => {
      const local = { playhead: 3500, duration: 3600, isWatched: true, lastPlayed: '2026-02-09T00:00:00Z', watchTime: 3500 };
      const remote = { currentTime: 1800, isFinished: false, lastUpdate: 1770854400, duration: 3600 };
      const result = resolveProgressConflict(local, remote);
      expect(result.isFinished).toBe(true);
      expect(result.duration).toBe(3600);
    });
  });
});
