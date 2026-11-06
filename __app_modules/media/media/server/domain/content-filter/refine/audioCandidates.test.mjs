import { describe, expect, it } from 'vitest';
import { boundaryCandidates, energyEnvelope, evenMarkers } from './audioCandidates.mjs';

const SR = 16000;
/** Silence with tone bursts at [start, end] seconds (relative to the clip). */
function clipWith(bursts, dur = 1.5, t0 = 100) {
  const samples = new Float32Array(Math.round(dur * SR));
  let seed = 7;
  for (let i = 0; i < samples.length; i++) { seed = (seed * 16807) % 2147483647; samples[i] = ((seed / 2147483647) - 0.5) * 0.002; }
  for (const [s, e] of bursts) {
    for (let i = Math.round(s * SR); i < Math.round(e * SR); i++) samples[i] += 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  return { samples, sampleRate: SR, t0 };
}

describe('energyEnvelope', () => {
  it('is loud inside a burst and quiet outside', () => {
    const { hop, db } = energyEnvelope(clipWith([[0.5, 0.8]]).samples, SR);
    expect(db[Math.round(0.65 / hop)]).toBeGreaterThan(db[Math.round(0.2 / hop)] + 30);
  });
});

describe('boundaryCandidates', () => {
  const clip = clipWith([[0.5, 0.8], [1.0, 1.2]]);

  it('finds onsets within 15 ms of each burst start', () => {
    const on = boundaryCandidates(clip, { kind: 'onset' });
    expect(on.some((c) => Math.abs(c.t - 100.5) < 0.015)).toBe(true);
    expect(on.some((c) => Math.abs(c.t - 101.0) < 0.015)).toBe(true);
  });

  it('finds offsets within 15 ms of each burst end', () => {
    const off = boundaryCandidates(clip, { kind: 'offset' });
    expect(off.some((c) => Math.abs(c.t - 100.8) < 0.015)).toBe(true);
    expect(off.some((c) => Math.abs(c.t - 101.2) < 0.015)).toBe(true);
  });

  it('restricts to a neighbourhood and spaces candidates', () => {
    const on = boundaryCandidates(clip, { kind: 'onset', near: 101.0, within: 0.1 });
    expect(on.length).toBeGreaterThan(0);
    expect(on.every((c) => Math.abs(c.t - 101.0) <= 0.1)).toBe(true);
    for (let i = 1; i < on.length; i++) expect(on[i].t - on[i - 1].t).toBeGreaterThanOrEqual(0.04);
  });

  it('returns nothing for silence', () => {
    expect(boundaryCandidates(clipWith([]), { kind: 'onset' })).toEqual([]);
  });
});

describe('evenMarkers', () => {
  it('spans the range inclusively', () => {
    expect(evenMarkers(1, 2, 3).map((m) => m.t)).toEqual([1, 1.5, 2]);
  });
});
