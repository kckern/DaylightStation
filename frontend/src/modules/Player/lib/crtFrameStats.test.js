import { describe, it, expect } from 'vitest';
import { createCrtFrameStats } from './crtFrameStats.js';

describe('createCrtFrameStats', () => {
  it('counts consecutive presentedFrames as zero skips', () => {
    const s = createCrtFrameStats();
    s.observe(10); s.observe(11); s.observe(12);
    expect(s.snapshot()).toEqual({ drawn: 3, skipped: 0 });
  });
  it('counts the gap between callbacks as skipped frames', () => {
    const s = createCrtFrameStats();
    s.observe(10); s.observe(14);
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 3 });
    expect(s.observe(15)).toBe(0);
  });
  it('returns the skip count for the latest observation so the caller can log it', () => {
    const s = createCrtFrameStats();
    s.observe(1);
    expect(s.observe(4)).toBe(2);
  });
  it('ignores a missing metadata value (rAF driver) and still counts the draw', () => {
    const s = createCrtFrameStats();
    s.observe(undefined); s.observe(undefined);
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 0 });
  });
  it('resets on a counter that went backwards (new media element)', () => {
    const s = createCrtFrameStats();
    s.observe(100); s.observe(3);
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 0 });
  });

  // --- added beyond the plan ---

  // A backwards counter must not just be swallowed: the NEXT gap has to be
  // measured against the new baseline, not the stale pre-reset one.
  it('measures gaps against the new baseline after a backwards reset', () => {
    const s = createCrtFrameStats();
    s.observe(100); s.observe(3);
    expect(s.observe(6)).toBe(2);
    expect(s.snapshot()).toEqual({ drawn: 3, skipped: 2 });
  });

  // The rAF fallback passes a DOMHighResTimeStamp as arg 0 and no metadata, so
  // observe() is called with undefined forever. It must not poison the counter
  // for a later rVFC-driven renderer, and must never emit a bogus skip.
  it('never emits a skip once the metadata goes missing mid-stream', () => {
    const s = createCrtFrameStats();
    s.observe(10);
    expect(s.observe(undefined)).toBe(0);
    expect(s.observe(11)).toBe(0);
    expect(s.snapshot()).toEqual({ drawn: 3, skipped: 0 });
  });

  // The finite guard must PRESERVE the baseline, not just avoid arithmetic on
  // undefined: a real reading after a dropout still has to be measured against
  // the last real one. (Without the guard, `last` is poisoned with undefined
  // and every subsequent comparison is a silent false — skips stop counting.)
  it('keeps the baseline across a missing reading so a later gap is still counted', () => {
    const s = createCrtFrameStats();
    s.observe(10);
    s.observe(undefined);
    expect(s.observe(14)).toBe(3);
    expect(s.snapshot()).toEqual({ drawn: 3, skipped: 3 });
  });

  // Non-finite garbage (null from `metadata?.presentedFrames ?? null`, NaN)
  // must be treated as "no reading", not as frame 0.
  it('treats null and NaN as no reading rather than frame zero', () => {
    const s = createCrtFrameStats();
    s.observe(50);
    expect(s.observe(null)).toBe(0);
    expect(s.observe(NaN)).toBe(0);
    expect(s.snapshot()).toEqual({ drawn: 3, skipped: 0 });
  });

  // The running total is what the teardown log reports; it must accumulate
  // across many gaps, not just hold the most recent one.
  it('accumulates skipped across multiple gaps', () => {
    const s = createCrtFrameStats();
    s.observe(0); s.observe(3); s.observe(4); s.observe(9);
    expect(s.snapshot()).toEqual({ drawn: 4, skipped: 2 + 0 + 4 });
  });

  // snapshot() is handed straight to the logger; it must be a copy, not a
  // live view that mutates under a queued log record. Asserting only that a
  // held snapshot keeps its values does NOT catch a shared mutable object —
  // both a fresh copy and a live view pass that. These two do catch it.
  it('snapshot returns a fresh object each call, not one shared live view', () => {
    const s = createCrtFrameStats();
    s.observe(0);
    expect(s.snapshot()).not.toBe(s.snapshot());
  });
  it('a held snapshot does not move when the stats do', () => {
    const s = createCrtFrameStats();
    s.observe(0);
    const first = s.snapshot();
    s.observe(5);
    expect(first).toEqual({ drawn: 1, skipped: 0 });
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 4 });
  });
  it('mutating a returned snapshot cannot corrupt the counters', () => {
    const s = createCrtFrameStats();
    s.observe(0);
    const grabbed = s.snapshot();
    grabbed.drawn = 999;
    grabbed.skipped = 999;
    expect(s.snapshot()).toEqual({ drawn: 1, skipped: 0 });
  });
});
