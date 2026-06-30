// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { verdict } from './verdict.mjs';

// Helper: build a clip metrics record.
const clip = (label, group, metrics) => ({ label, group, metrics });

function buildClips({ reverbEffective, typeEffective, chorusEffective, instOk }) {
  const off = -60;
  const on = reverbEffective ? -45 : -59; // +15 dB tail when effective, ~flat when not
  return [
    clip('00-control', 'control', { tailDb: off, decayMs: 200, centroid: 500, spread: 100 }),
    clip('01-reverb-hall-l000', 'reverb-depth', { tailDb: off, decayMs: 200, centroid: 500, spread: 100 }),
    clip('02-reverb-hall-l127', 'reverb-depth', { tailDb: on, decayMs: 900, centroid: 500, spread: 100 }),
    clip('03-reverb-type-room', 'reverb-type', { tailDb: -50, decayMs: typeEffective ? 300 : 500, centroid: 500, spread: 100 }),
    clip('04-reverb-type-plate', 'reverb-type', { tailDb: -50, decayMs: typeEffective ? 700 : 510, centroid: 500, spread: 100 }),
    clip('05-chorus-l000', 'chorus-depth', { tailDb: -50, decayMs: 300, centroid: 500, spread: 100 }),
    clip('06-chorus-l127', 'chorus-depth', { tailDb: chorusEffective ? -44 : -50, decayMs: 300, centroid: 500, spread: chorusEffective ? 160 : 100 }),
    clip('07-instrument-ac-grand', 'instrument', { tailDb: -50, decayMs: 300, centroid: 500, spread: 100 }),
    clip('08-instrument-strings', 'instrument', { tailDb: -50, decayMs: 300, centroid: instOk ? 1800 : 520, spread: 100 }),
    clip('09-instrument-ac-grand', 'instrument', { tailDb: -50, decayMs: 300, centroid: 500, spread: 100 }),
  ];
}

describe('verdict', () => {
  it('flags reverb depth effective when tail energy rises', () => {
    const v = verdict(buildClips({ reverbEffective: true, typeEffective: true, chorusEffective: true, instOk: true }));
    expect(v.reverbDepth.effective).toBe(true);
    expect(v.reverbType.effective).toBe(true);
    expect(v.chorus.effective).toBe(true);
    expect(v.instrument.detectable).toBe(true);
    expect(v.recommendations.some((r) => /KEEP reverb depth/.test(r))).toBe(true);
  });
  it('flags reverb ignored when the tail is flat', () => {
    const v = verdict(buildClips({ reverbEffective: false, typeEffective: false, chorusEffective: false, instOk: true }));
    expect(v.reverbDepth.effective).toBe(false);
    expect(v.reverbType.effective).toBe(false);
    expect(v.chorus.effective).toBe(false);
    expect(v.recommendations.some((r) => /REMOVE\/REVIEW reverb depth/.test(r))).toBe(true);
  });
  it('warns when the instrument control shows no timbre change (rig suspect)', () => {
    const v = verdict(buildClips({ reverbEffective: false, typeEffective: false, chorusEffective: false, instOk: false }));
    expect(v.instrument.detectable).toBe(false);
    expect(v.recommendations.some((r) => /WARNING: instrument control/.test(r))).toBe(true);
  });
});
