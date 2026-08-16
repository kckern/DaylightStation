import { describe, it, expect, vi } from 'vitest';
import {
  createSessionSupervisor, classify, isSafe, STATE_OK, STATE_NO_PAD, STATE_HEALING, STATE_FAULT,
} from './sessionSupervisor.js';

/** A healthy observation; override one field per test. */
function obs(overrides = {}) {
  return {
    contractOk: true,
    padCount: 1,
    browserPings: 4,
    emulatorConsumes: 9,
    audioState: 'running',
    paused: false,
    frameAdvanced: true,
    ...overrides,
  };
}

describe('classify', () => {
  it('returns null for a healthy session', () => {
    expect(classify(obs())).toBeNull();
  });

  it('detects the 2026-08-15 signature: pings with zero consumes', () => {
    expect(classify(obs({ browserPings: 34, emulatorConsumes: 0 }))).toBe('input-gap');
  });

  it('does NOT flag consumes exceeding pings — that is normal', () => {
    // EJS emits multiple simulateInput calls per event (two per axis change), so
    // consumes routinely exceeds pings. A ratio check here would false-positive
    // on every healthy session.
    expect(classify(obs({ browserPings: 1, emulatorConsumes: 6 }))).toBeNull();
  });

  it('does not flag a gap when no pad is connected', () => {
    expect(classify(obs({ padCount: 0, browserPings: 0, emulatorConsumes: 0 }))).toBeNull();
  });

  it('does not flag a gap when nobody pressed anything', () => {
    expect(classify(obs({ browserPings: 0, emulatorConsumes: 0 }))).toBeNull();
  });

  it('detects a frozen core only while unpaused', () => {
    expect(classify(obs({ frameAdvanced: false }))).toBe('frozen');
    expect(classify(obs({ frameAdvanced: false, paused: true }))).toBeNull();
  });

  it('detects suspended audio and a broken contract', () => {
    expect(classify(obs({ audioState: 'suspended' }))).toBe('audio-suspended');
    expect(classify(obs({ contractOk: false }))).toBe('contract-broken');
  });

  it('prioritises a broken contract over everything else', () => {
    expect(classify(obs({ contractOk: false, frameAdvanced: false }))).toBe('contract-broken');
  });
});

describe('isSafe', () => {
  it('marks progress-preserving faults safe and restart-requiring ones risky', () => {
    expect(isSafe('input-gap')).toBe(true);
    expect(isSafe('audio-suspended')).toBe(true);
    expect(isSafe('frozen')).toBe(false);
    expect(isSafe('contract-broken')).toBe(false);
  });
});

describe('createSessionSupervisor', () => {
  it('debounces a gap — no action until it persists', () => {
    const heal = vi.fn(() => true);
    const sup = createSessionSupervisor({ healers: { 'input-gap': heal } });
    const bad = obs({ browserPings: 5, emulatorConsumes: 0 });
    expect(sup.observe(bad)).toBeNull();
    expect(sup.observe(bad)).toBeNull();
    expect(heal).not.toHaveBeenCalled();       // still debouncing
    expect(sup.observe(bad)).toMatchObject({ type: 'heal-attempted', kind: 'input-gap' });
    expect(heal).toHaveBeenCalledTimes(1);
  });

  it('heals a gap silently and reports recovery', () => {
    const sup = createSessionSupervisor({ healers: { 'input-gap': () => true } });
    const bad = obs({ browserPings: 5, emulatorConsumes: 0 });
    sup.observe(bad); sup.observe(bad);
    expect(sup.observe(bad).type).toBe('heal-attempted');
    expect(sup.getState().state).toBe(STATE_HEALING);
    expect(sup.observe(obs())).toEqual({ type: 'healed', kind: 'input-gap' });
    expect(sup.getState().state).toBe(STATE_OK);
  });

  it('bounds auto-heal and escalates when the budget is spent', () => {
    const heal = vi.fn(() => false);
    const sup = createSessionSupervisor({ healers: { 'input-gap': heal }, maxHeals: 2 });
    const bad = obs({ browserPings: 5, emulatorConsumes: 0 });
    const events = [];
    // Each heal resets the streak, so 3 windows are needed per attempt.
    for (let i = 0; i < 12; i += 1) {
      const e = sup.observe(bad);
      if (e) events.push(e);
    }
    expect(heal).toHaveBeenCalledTimes(2);                 // never exceeds the budget
    expect(events.at(-1)).toMatchObject({ type: 'unrecovered', kind: 'input-gap' });
    expect(sup.getState().state).toBe(STATE_FAULT);
  });

  it('never auto-acts on a risky fault', () => {
    const heal = vi.fn(() => true);
    const sup = createSessionSupervisor({ healers: { frozen: heal } });
    const stuck = obs({ frameAdvanced: false });
    sup.observe(stuck); sup.observe(stuck);
    expect(sup.observe(stuck)).toEqual({ type: 'fault', kind: 'frozen', tier: 'risky' });
    expect(heal).not.toHaveBeenCalled();
    expect(sup.getState().state).toBe(STATE_FAULT);
  });

  it('reports a broken contract immediately, without debouncing', () => {
    const sup = createSessionSupervisor();
    expect(sup.observe(obs({ contractOk: false })))
      .toEqual({ type: 'fault', kind: 'contract-broken', tier: 'risky' });
  });

  it('does not spam repeat events while a fault persists', () => {
    const sup = createSessionSupervisor();
    const stuck = obs({ frameAdvanced: false });
    sup.observe(stuck); sup.observe(stuck); sup.observe(stuck);
    expect(sup.observe(stuck)).toBeNull();
    expect(sup.observe(stuck)).toBeNull();
  });

  it('treats no controller as informational, not a fault', () => {
    const sup = createSessionSupervisor();
    const e = sup.observe(obs({ padCount: 0, browserPings: 0, emulatorConsumes: 0 }));
    expect(e).toEqual({ type: 'state', kind: null });
    expect(sup.getState().state).toBe(STATE_NO_PAD);
  });

  it('switching fault kind restarts the debounce', () => {
    const sup = createSessionSupervisor();
    sup.observe(obs({ browserPings: 5, emulatorConsumes: 0 }));
    sup.observe(obs({ browserPings: 5, emulatorConsumes: 0 }));
    // different fault appears — must not inherit the previous streak
    expect(sup.observe(obs({ frameAdvanced: false }))).toBeNull();
  });

  it('survives a healer that throws', () => {
    const sup = createSessionSupervisor({
      healers: { 'input-gap': () => { throw new Error('boom'); } },
    });
    const bad = obs({ browserPings: 5, emulatorConsumes: 0 });
    sup.observe(bad); sup.observe(bad);
    expect(sup.observe(bad)).toMatchObject({ type: 'heal-attempted', ok: false });
  });

  it('reset clears state and the heal budget', () => {
    const sup = createSessionSupervisor({ healers: { 'input-gap': () => false }, maxHeals: 1 });
    const bad = obs({ browserPings: 5, emulatorConsumes: 0 });
    sup.observe(bad); sup.observe(bad); sup.observe(bad);
    sup.reset();
    expect(sup.getState()).toEqual({ state: STATE_OK, fault: null, heals: {} });
  });
});
