import { describe, it, expect } from 'vitest';
import { assessEligibility } from './playEligibility.mjs';

const sat10 = new Date('2026-09-12T10:00:00');   // Saturday
const tue16 = new Date('2026-09-15T16:00:00');   // Tuesday

describe('assessEligibility — permissive by default', () => {
  it('allows play when nothing has been configured', () => {
    expect(assessEligibility({ at: tue16 })).toEqual({ allowed: true, reasons: [] });
  });

  it('does not lock anyone out over a malformed window', () => {
    const policy = { windows: [{ days: ['tue'], from: 'nonsense', to: '18:00' }] };
    expect(assessEligibility({ at: tue16, policy }).allowed).toBe(true);
  });
});

describe('assessEligibility — schedule', () => {
  const weekend = { windows: [{ days: ['sat', 'sun'], from: '09:00', to: '18:00' }] };

  it('allows play inside the window', () => {
    expect(assessEligibility({ at: sat10, policy: weekend }).allowed).toBe(true);
  });

  it('refuses outside it, and says why', () => {
    const r = assessEligibility({ at: tue16, policy: weekend });
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain('outside_play_window');
  });

  it('handles a window that crosses midnight', () => {
    const late = { windows: [{ from: '20:00', to: '02:00' }] };
    expect(assessEligibility({ at: new Date('2026-09-12T23:00:00'), policy: late }).allowed).toBe(true);
    expect(assessEligibility({ at: new Date('2026-09-12T12:00:00'), policy: late }).allowed).toBe(false);
  });
});

describe('assessEligibility — prerequisites', () => {
  const policy = { requires: ['school-day-complete'] };

  it('refuses until the prerequisite is asserted', () => {
    const r = assessEligibility({ at: tue16, policy });
    expect(r.reasons).toContain('requires:school-day-complete');
  });

  it('allows once it is', () => {
    expect(assessEligibility({ at: tue16, policy, satisfied: ['school-day-complete'] }).allowed).toBe(true);
  });

  it('accumulates every unmet reason rather than stopping at the first', () => {
    const both = { windows: [{ days: ['sat'] , from: '09:00', to: '18:00' }], requires: ['chores'] };
    expect(assessEligibility({ at: tue16, policy: both }).reasons).toHaveLength(2);
  });
});

describe('assessEligibility — per-title policy', () => {
  const policy = {
    titles: {
      'retroarch:snes/kart': { min_players: 2 },
      'retroarch:gb/pokemon': { requires: ['reading-done'] },
    },
  };

  it('refuses a group title with too few controllers', () => {
    const r = assessEligibility({ at: tue16, policy, contentId: 'retroarch:snes/kart', controllers: 1 });
    expect(r.reasons).toContain('needs_2_controllers');
  });

  it('allows it once enough controllers are present', () => {
    expect(assessEligibility({ at: tue16, policy, contentId: 'retroarch:snes/kart', controllers: 2 }).allowed).toBe(true);
  });

  it('does not refuse on controllers it could not count', () => {
    // Unknown is not zero — the same rule the rest of the meter follows.
    expect(assessEligibility({ at: tue16, policy, contentId: 'retroarch:snes/kart', controllers: null }).allowed).toBe(true);
  });

  it('applies a title-specific prerequisite', () => {
    const r = assessEligibility({ at: tue16, policy, contentId: 'retroarch:gb/pokemon' });
    expect(r.reasons).toContain('requires:reading-done');
  });

  it('lets a title override the household window entirely', () => {
    const p = { windows: [{ days: ['sat'] }], titles: { 'x:1': { windows: [{ days: ['tue'] }] } } };
    expect(assessEligibility({ at: tue16, policy: p, contentId: 'x:1' }).allowed).toBe(true);
  });
});

describe('assessEligibility — an unobservable device', () => {
  it('refuses NEW play when the meter has lost sight of the device', () => {
    const r = assessEligibility({ at: tue16, deviceBlocked: true });
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain('device_unobservable');
  });
});
