import { describe, it, expect } from 'vitest';
import { certify, signOff, LEVELS, nudgeCovers } from './certification.mjs';

const edl = (cues, extra = {}) => ({ cues, ...extra });
const mute = (id, precision) => ({ id, type: 'mute', precision });
const skip = (id, precision) => ({ id, type: 'skip', precision });

describe('certify', () => {
  it('is machine-certified when every mute is precise, whatever the skips are', () => {
    const c = certify(edl([mute('a', 'ms'), mute('b', 'ms'), skip('c', 'second-approx'), skip('d', 'frame')]), { at: '2026-11-06' });
    expect(c.level).toBe('machine');
    expect(c.bar).toBe('every-mute-covered');
    expect(c.counts).toEqual({ mute: { precise: 2, safeWindow: 0, approx: 0 }, visual: { precise: 1, approx: 1 } });
    expect(c.machine).toEqual({ at: '2026-11-06' });
  });
  it('counts a tag listed under several categories once', () => {
    const c = certify(edl([mute('a', 'second-approx'), mute('a', 'second-approx'), mute('b', 'ms')]), { at: '2026-11-06' });
    expect(c.counts.mute).toEqual({ precise: 1, safeWindow: 0, approx: 1 });
    expect(c.blocking).toEqual(['a']);
  });
  it('is not certified while any mute is approximate, and lists them', () => {
    const c = certify(edl([mute('a', 'ms'), mute('b', 'second-approx')]), { at: '2026-11-06' });
    expect(c.level).toBe('none');
    expect(c.blocking).toEqual(['b']);
  });
  it('keeps a parent sign-off while the bar still holds, and drops it when it does not', () => {
    const signed = { certification: { level: 'parent', parent: { by: 'KC', at: '2026-11-07' } } };
    expect(certify(edl([mute('a', 'ms')], signed), { at: '2026-11-08' }).level).toBe('parent');
    expect(certify(edl([mute('a', 'second-approx')], signed), { at: '2026-11-08' }).level).toBe('none');
  });
});

describe('certify with safe windows', () => {
  it('counts safe-window mutes as covered', () => {
    const c = certify(edl([mute('a', 'ms'), mute('b', 'safe-window')]), { at: '2026-11-06' });
    expect(c.level).toBe('machine');
    expect(c.counts.mute).toEqual({ precise: 1, safeWindow: 1, approx: 0 });
  });
});

describe('signOff', () => {
  it('raises a machine-certified EDL to parent', () => {
    const e = edl([mute('a', 'ms')]);
    e.certification = certify(e, { at: '2026-11-06' });
    expect(signOff(e, { by: 'KC', at: '2026-11-07' }).level).toBe('parent');
  });
  it('refuses an EDL that is not machine-certified', () => {
    const e = edl([mute('a', 'second-approx')]);
    e.certification = certify(e, { at: '2026-11-06' });
    expect(() => signOff(e, { by: 'KC', at: '2026-11-07' })).toThrow(/machine/);
  });
});

describe('LEVELS', () => {
  it('orders the levels', () => {
    expect(LEVELS.indexOf('parent')).toBeGreaterThan(LEVELS.indexOf('machine'));
    expect(LEVELS.indexOf('machine')).toBeGreaterThan(LEVELS.indexOf('none'));
  });
});

describe('certify with hand nudges', () => {
  const word = { id: 'va1', type: 'mute', in: 100.2, out: 100.6, precision: 'ms' };
  const signed = { certification: { level: 'parent', parent: { by: 'KC', at: '2026-11-07' } } };
  it('a nudged ms mute that still contains the word stays covered', () => {
    const c = certify(edl([word]), { at: 'x', cueOverrides: { va1: { startMs: 100100, endMs: 100700 } } });
    expect(c.level).toBe('machine');
  });
  it('a nudged ms mute that no longer contains the word blocks and drops a parent sign-off', () => {
    const c = certify(edl([word], signed), { at: 'x', cueOverrides: { va1: { startMs: 100300, endMs: 100700 } } });
    expect(c.level).toBe('none');
    expect(c.blocking).toEqual(['va1']);
    expect(c.parent).toBeUndefined();
  });
  it('a nudged safe-window or approximate mute counts as pinned', () => {
    const c = certify(edl([{ ...word, precision: 'safe-window' }, { id: 'b', type: 'mute', in: 5, out: 6, precision: 'second-approx' }]),
      { at: 'x', cueOverrides: { va1: { startMs: 1, endMs: 900 }, b: { startMs: 5000, endMs: 6000 } } });
    expect(c.level).toBe('machine');
    expect(c.counts.mute.safeWindow).toBe(2);
  });
  it('cues without nudges are unchanged', () => {
    expect(certify(edl([word]), { at: 'x', cueOverrides: { other: { effect: 'off' } } }).counts.mute.precise).toBe(1);
  });
});

describe('nudgeCovers', () => {
  it('needs both edges, and on a precise cue must contain the word', () => {
    const w = { in: 1, out: 2, precision: 'ms' };
    expect(nudgeCovers(w, { startMs: 900, endMs: 2100 })).toBe(true);
    expect(nudgeCovers(w, { startMs: 1100, endMs: 2100 })).toBe(false);
    expect(nudgeCovers(w, { effect: 'off' })).toBe(false);
    expect(nudgeCovers({ in: 1, out: 2, precision: 'safe-window' }, { startMs: 0, endMs: 10 })).toBe(true);
  });
});
