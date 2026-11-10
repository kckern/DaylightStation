import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { warningScrimStep, SCRIM_STEP_COUNT, SCRIM_FALLBACK_STEP } from './warningScrimStep.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('warningScrimStep', () => {
  it('is step 0 with most of the grace period left', () => {
    expect(warningScrimStep(30, 30)).toBe(0);
    expect(warningScrimStep(23, 30)).toBe(0);
  });

  it('steps at 75 / 50 / 25 / 10 percent remaining', () => {
    expect(warningScrimStep(22.5, 30)).toBe(1);
    expect(warningScrimStep(15, 30)).toBe(2);
    expect(warningScrimStep(7.5, 30)).toBe(3);
    expect(warningScrimStep(3, 30)).toBe(4);
    expect(warningScrimStep(0, 30)).toBe(4);
  });

  it('only ever takes a handful of values over a whole ramp (no per-notch rewrites)', () => {
    const seen = new Set();
    for (let r = 30; r >= 0; r -= 0.25) seen.add(warningScrimStep(r, 30));
    expect([...seen]).toEqual([0, 1, 2, 3, 4]);
    expect(SCRIM_STEP_COUNT).toBe(5);
  });

  it('clamps out-of-range remaining time', () => {
    expect(warningScrimStep(45, 30)).toBe(0);
    expect(warningScrimStep(-3, 30)).toBe(4);
  });

  it('falls back to a firm mid-late step when the countdown is unusable', () => {
    expect(warningScrimStep(null, 30)).toBe(SCRIM_FALLBACK_STEP);
    expect(warningScrimStep(10, 0)).toBe(SCRIM_FALLBACK_STEP);
    expect(warningScrimStep(10, NaN)).toBe(SCRIM_FALLBACK_STEP);
    expect(SCRIM_FALLBACK_STEP).toBeGreaterThanOrEqual(2);
  });
});

// Regression guard (bug 2026-10-23 #8): the warning darkening must never again
// be a full-screen backdrop-filter, and no filter may be transitioned.
describe('warning scrim styles', () => {
  const scss = readFileSync(path.join(here, 'GovernanceStateOverlay.scss'), 'utf8');
  const playerScss = readFileSync(path.join(here, '..', 'FitnessPlayer.scss'), 'utf8');
  const block = (src, selector) => {
    const start = src.indexOf(selector);
    if (start < 0) return '';
    const end = src.indexOf('// end warning scrim', start);
    return src.slice(start, end < 0 ? undefined : end);
  };

  it('the scrim block uses no backdrop-filter and transitions no filter', () => {
    const scrim = block(scss, '.governance-warning-scrim {');
    expect(scrim).not.toBe('');
    expect(scrim).not.toMatch(/backdrop-filter/);
    expect(scrim).not.toMatch(/transition[^;]*filter/);
    expect(scrim).not.toMatch(/blur\(/);
  });

  it('FitnessPlayer no longer styles a second warning scrim', () => {
    expect(playerScss).not.toMatch(/governance-warning-scrim/);
  });
});
