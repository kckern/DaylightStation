import { describe, it, expect } from 'vitest';
import { certify, signOff, LEVELS } from './certification.mjs';

const edl = (cues, extra = {}) => ({ cues, ...extra });
const mute = (id, precision) => ({ id, type: 'mute', precision });
const skip = (id, precision) => ({ id, type: 'skip', precision });

describe('certify', () => {
  it('is machine-certified when every mute is precise, whatever the skips are', () => {
    const c = certify(edl([mute('a', 'ms'), mute('b', 'ms'), skip('c', 'second-approx'), skip('d', 'frame')]), { at: '2026-11-06' });
    expect(c.level).toBe('machine');
    expect(c.bar).toBe('every-mute-precise');
    expect(c.counts).toEqual({ mute: { precise: 2, approx: 0 }, visual: { precise: 1, approx: 1 } });
    expect(c.machine).toEqual({ at: '2026-11-06' });
  });
  it('counts a tag listed under several categories once', () => {
    const c = certify(edl([mute('a', 'second-approx'), mute('a', 'second-approx'), mute('b', 'ms')]), { at: '2026-11-06' });
    expect(c.counts.mute).toEqual({ precise: 1, approx: 1 });
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
