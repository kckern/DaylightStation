import { describe, it, expect, vi } from 'vitest';
import { BAR_PITCH_PX, barCount, binsFromSamples, drawBand, rmsOfBytes, shapeLevel } from './voiceBand.js';

describe('voice band arithmetic', () => {
  it('reads silence as zero and a full-scale square wave as one', () => {
    expect(rmsOfBytes(new Uint8Array(64).fill(128))).toBe(0);
    const square = new Uint8Array(64).map((_, i) => (i % 2 ? 255 : 1));
    expect(rmsOfBytes(square)).toBeCloseTo(0.992, 2);
    expect(rmsOfBytes(null)).toBe(0);
  });

  it('lifts a speaking level to most of the band and clips a shout', () => {
    expect(shapeLevel(0.1)).toBeCloseTo(0.4);
    expect(shapeLevel(0.5)).toBe(1);
  });

  it('fits a take to the bars and never fakes a loud picture out of noise', () => {
    // A quiet but real voice: lifted, shape kept.
    const voice = Float32Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.1 : 0.2) * Math.sin(i));
    const bins = binsFromSamples(voice, 4);
    expect(bins.length).toBe(4);
    expect(bins[3]).toBeGreaterThan(bins[0]);
    expect(Math.max(...bins)).toBeLessThanOrEqual(1);
    // Room noise at -60 dB gets at most the live gain, so it stays a hairline.
    const noise = Float32Array.from({ length: 1000 }, (_, i) => 0.001 * Math.sin(i));
    expect(Math.max(...binsFromSamples(noise, 4))).toBeLessThan(0.01);
    // Digital silence is exactly flat.
    expect(Array.from(binsFromSamples(new Float32Array(100), 3))).toEqual([0, 0, 0]);
    expect(binsFromSamples(null, 3).length).toBe(3);
  });

  it('never divides by zero bars', () => {
    expect(barCount(0)).toBe(1);
    expect(barCount(BAR_PITCH_PX * 50)).toBe(50);
  });

  it('colours only the bars already heard behind the playhead', () => {
    const fills = [];
    const ctx = {
      clearRect: vi.fn(), fillRect: vi.fn(() => fills.push(ctx.fillStyle)), set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; },
    };
    const levels = Float32Array.from([0.5, 0.5, 0.5, 0.5]);
    drawBand(ctx, { width: 4 * BAR_PITCH_PX, height: 40, levels, playhead: 0.5, voice: 'V', rest: 'R', baseline: 'B' });
    // baseline, then four bars: two heard, two waiting.
    expect(fills).toEqual(['B', 'V', 'V', 'R', 'R']);
  });
});
