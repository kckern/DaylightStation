import { describe, it, expect } from 'vitest';
import { CALIBRATION, calibrationClickTimes, matchPresses, summarizeCalibration } from './clickCalibrationMath.js';

const ANCHOR = 1_000_000;
const clicks = calibrationClickTimes(ANCHOR);
// Deterministic jitter pattern, mean 0, |x| ≤ 20.
const JITTER = [-20, -10, 0, 10, 20, 5, -5, 15, -15, 0];

describe('calibrationClickTimes', () => {
  it('is CALIBRATION.clicks clicks one period apart', () => {
    expect(clicks).toHaveLength(CALIBRATION.clicks);
    expect(clicks[1] - clicks[0]).toBe(60000 / CALIBRATION.bpm);
    expect(clicks[0]).toBe(ANCHOR);
  });
});

describe('matchPresses', () => {
  it('matches each press to its nearest click and keeps the closer of two claims', () => {
    const m = matchPresses([0, 1000, 2000], [310, 1290, 1400, 5000]);
    expect(m).toEqual([
      { click: 0, press: 310, offsetMs: 310 },
      { click: 1000, press: 1290, offsetMs: 290 },
    ]);
  });

  it('drops presses beyond half a period from every click', () => {
    expect(matchPresses([0, 1000], [-600, 1600])).toEqual([]);
  });
});

describe('summarizeCalibration', () => {
  it('median offset becomes the lead; spread is the IQR; tight + enough → can save', () => {
    const presses = clicks.map((c, i) => c + 300 + JITTER[i % JITTER.length]);
    const r = summarizeCalibration(clicks, presses);
    expect(r).toMatchObject({ matched: 24, presses: 24, medianMs: 300, leadMs: 300, spreadKind: 'iqr', canSave: true, reason: null });
    expect(r.spreadMs).toBeLessThanOrEqual(CALIBRATION.maxSpreadMs);
  });

  it('a stray tap does not move the median much and does not block save', () => {
    const presses = clicks.map((c, i) => c + 250 + JITTER[i % JITTER.length]);
    presses[5] = clicks[5] - 400; // one wild early tap
    const r = summarizeCalibration(clicks, presses);
    expect(Math.abs(r.medianMs - 250)).toBeLessThanOrEqual(5);
    expect(r.canSave).toBe(true);
  });

  it('refuses to save with fewer than 16 matched presses', () => {
    const presses = clicks.slice(0, 15).map((c) => c + 300);
    const r = summarizeCalibration(clicks, presses);
    expect(r).toMatchObject({ matched: 15, canSave: false, reason: 'too-few', leadMs: 300 });
  });

  it('exactly 16 matched is enough', () => {
    const presses = clicks.slice(0, 16).map((c) => c + 300);
    expect(summarizeCalibration(clicks, presses).canSave).toBe(true);
  });

  it('refuses to save when the IQR is over 60 ms', () => {
    // Alternate −60 / +60 around 300: IQR = 120.
    const presses = clicks.map((c, i) => c + 300 + (i % 2 ? 60 : -60));
    const r = summarizeCalibration(clicks, presses);
    expect(r.spreadMs).toBe(120);
    expect(r).toMatchObject({ canSave: false, reason: 'too-uneven' });
  });

  it('spread of exactly 60 ms still saves', () => {
    const presses = clicks.map((c, i) => c + 300 + (i % 2 ? 30 : -30));
    const r = summarizeCalibration(clicks, presses);
    expect(r.spreadMs).toBe(60);
    expect(r.canSave).toBe(true);
  });

  it('no presses → nulls, cannot save', () => {
    expect(summarizeCalibration(clicks, [])).toMatchObject({ matched: 0, medianMs: null, spreadMs: null, leadMs: null, canSave: false, reason: 'too-few' });
  });
});
