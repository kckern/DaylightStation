import { describe, it, expect, beforeAll } from '@jest/globals';

/**
 * computeCycleDimStyle(challenge) — unit tests.
 *
 * Task 20: Frontend wiring for the progressive video-degradation "dim factor".
 * The backend (GovernanceEngine) emits `challenge.dimFactor` in [0..1] during
 * cycle challenge maintain state. FitnessPlayer must translate that factor
 * into a `--cycle-dim` CSS custom property on the player root, plus a
 * `cycle-dim` class that enables the SCSS filter chain.
 *
 * computeCycleDimStyle is a pure mapping from the `challenge` snapshot field
 * (or null) to { style, className }. Extracted from the JSX so it can be
 * unit-tested without a DOM/RTL harness (Jest here is `testEnvironment: 'node'`).
 *
 * Contract:
 *   - cycle challenge + maintain state + numeric dimFactor → style var set, class present
 *   - no challenge → style var 0, no class
 *   - non-cycle challenge (e.g. hr-based) → style var 0, no class
 *   - cycle challenge but non-maintain state (init/ramp/locked) → var set from factor
 *     BUT no `cycle-dim` class (filter only applied when actively dimming)
 *   - invalid/non-numeric dimFactor → treated as 0
 *   - clamps out-of-range dimFactor to [0, 1]
 */

let computeCycleDimStyle;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/cycleDimStyle.js');
  computeCycleDimStyle = mod.computeCycleDimStyle;
});

describe('computeCycleDimStyle', () => {
  it('sets --cycle-dim to dimFactor and adds cycle-dim class when cycle+maintain', () => {
    const challenge = { type: 'cycle', cycleState: 'maintain', dimFactor: 0.5 };
    const { style, className } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('0.5');
    expect(className).toBe('cycle-dim');
  });

  it('returns --cycle-dim=0 and no class when challenge is null', () => {
    const { style, className } = computeCycleDimStyle(null);
    expect(style['--cycle-dim']).toBe('0');
    expect(className).toBe('');
  });

  it('returns --cycle-dim=0 and no class when challenge is undefined', () => {
    const { style, className } = computeCycleDimStyle(undefined);
    expect(style['--cycle-dim']).toBe('0');
    expect(className).toBe('');
  });

  it('returns --cycle-dim=0 and no class for non-cycle challenge', () => {
    const challenge = { type: 'hr', status: 'active', dimFactor: 0.7 };
    const { style, className } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('0');
    expect(className).toBe('');
  });

  it('does NOT apply cycle-dim class when cycleState !== maintain (init)', () => {
    const challenge = { type: 'cycle', cycleState: 'init', dimFactor: 0.3 };
    const { style, className } = computeCycleDimStyle(challenge);
    // var still reflects the backend value, but class gated on maintain
    expect(style['--cycle-dim']).toBe('0.3');
    expect(className).toBe('');
  });

  it('does NOT apply cycle-dim class when cycleState === ramp', () => {
    const challenge = { type: 'cycle', cycleState: 'ramp', dimFactor: 0.2 };
    const { className } = computeCycleDimStyle(challenge);
    expect(className).toBe('');
  });

  it('does NOT apply cycle-dim class when cycleState === locked', () => {
    const challenge = { type: 'cycle', cycleState: 'locked', dimFactor: 0.9 };
    const { className } = computeCycleDimStyle(challenge);
    expect(className).toBe('');
  });

  it('treats missing dimFactor as 0', () => {
    const challenge = { type: 'cycle', cycleState: 'maintain' };
    const { style, className } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('0');
    // With factor=0 the class is pointless; still apply per contract? Let the
    // renderer decide — we DO add the class when maintain, so filter var is live.
    expect(className).toBe('cycle-dim');
  });

  it('treats non-numeric dimFactor as 0', () => {
    const challenge = { type: 'cycle', cycleState: 'maintain', dimFactor: 'half' };
    const { style } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('0');
  });

  it('clamps dimFactor > 1 to 1', () => {
    const challenge = { type: 'cycle', cycleState: 'maintain', dimFactor: 1.7 };
    const { style } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('1');
  });

  it('clamps dimFactor < 0 to 0', () => {
    const challenge = { type: 'cycle', cycleState: 'maintain', dimFactor: -0.4 };
    const { style } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('0');
  });

  it('passes through fractional values without rounding', () => {
    const challenge = { type: 'cycle', cycleState: 'maintain', dimFactor: 0.37 };
    const { style } = computeCycleDimStyle(challenge);
    expect(style['--cycle-dim']).toBe('0.37');
  });
});
