import { describe, expect, it } from 'vitest';
import {
  createAddressingProgress, recordAddress, addressingStats, evaluateAddressing, DEFAULT_PROMOTION,
} from './addressingProgress.js';

const feed = (attempts, rung = 3) => attempts.reduce(
  (progress, attempt) => recordAddress(progress, attempt), createAddressingProgress(rung),
);
const many = (count, attempt) => Array.from({ length: count }, () => attempt);

describe('addressingStats', () => {
  it('has no opinion before anything has been played', () => {
    expect(addressingStats(createAddressingProgress())).toMatchObject({ samples: 0, accuracy: null });
  });

  it('reports accuracy over the window', () => {
    const progress = feed([...many(8, { ok: true, ms: 1000 }), ...many(2, { ok: false })]);
    expect(addressingStats(progress).accuracy).toBeCloseTo(0.8);
  });

  it('uses the MEDIAN time, so one interruption does not decide a promotion', () => {
    const progress = feed([...many(9, { ok: true, ms: 1000 }), { ok: true, ms: 120000 }]);
    expect(addressingStats(progress).medianMs).toBe(1000);
  });

  it('keeps only the window, so old play stops counting', () => {
    const progress = feed(many(50, { ok: true, ms: 500 }));
    expect(progress.samples).toHaveLength(DEFAULT_PROMOTION.window);
  });
});

describe('evaluateAddressing', () => {
  it('holds until there are enough addresses to judge on', () => {
    expect(evaluateAddressing(feed(many(4, { ok: true, ms: 500 })))).toMatchObject({ verdict: 'hold' });
  });

  it('promotes a player who is both accurate and fluent', () => {
    const verdict = evaluateAddressing(feed(many(20, { ok: true, ms: 2000 })));
    expect(verdict).toMatchObject({ verdict: 'promote', rung: 4 });
  });

  it('does NOT promote a player who is accurate but still spelling it out', () => {
    // Never wrong, fifteen seconds a move: that is reading letter by letter, and
    // the next rung would bury them.
    const verdict = evaluateAddressing(feed(many(20, { ok: true, ms: 15000 })));
    expect(verdict.verdict).toBe('hold');
    expect(verdict.reason).toMatch(/slow/);
  });

  it('does NOT promote a fast player who is guessing', () => {
    const verdict = evaluateAddressing(feed([...many(10, { ok: true, ms: 400 }), ...many(10, { ok: false })]));
    expect(verdict.verdict).toBe('hold');
  });

  it('demotes a player the rung is blocking rather than teaching', () => {
    const verdict = evaluateAddressing(feed([...many(4, { ok: true, ms: 800 }), ...many(16, { ok: false })]));
    expect(verdict).toMatchObject({ verdict: 'demote', rung: 2 });
  });

  it('never demotes below the first rung or promotes past the last', () => {
    expect(evaluateAddressing(feed(many(20, { ok: false }), 1)).verdict).toBe('hold');
    expect(evaluateAddressing(feed(many(20, { ok: true, ms: 500 }), 13)).verdict).toBe('hold');
  });

  it('is independent of whether the player won — that is the whole point', () => {
    // The record carries no game result at all, so a losing streak cannot hold
    // back a reader and a winning streak cannot promote one.
    const progress = feed(many(20, { ok: true, ms: 1500 }));
    expect(Object.keys(progress.samples[0])).toEqual(['ok', 'ms', 'railRead']);
    expect(evaluateAddressing(progress).verdict).toBe('promote');
  });

  it('takes a household override for the thresholds', () => {
    const strict = { accuracy: 0.99, minSamples: 5 };
    expect(evaluateAddressing(feed(many(20, { ok: true, ms: 1500 })), strict).verdict).toBe('promote');
    expect(evaluateAddressing(feed([...many(18, { ok: true, ms: 1500 }), ...many(2, { ok: false })]), strict).verdict).toBe('hold');
  });
});
