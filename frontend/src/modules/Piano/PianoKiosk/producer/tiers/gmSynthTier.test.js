import { describe, it, expect, vi } from 'vitest';
import { createGmSynthTier } from './gmSynthTier.js';

function makeSynth() {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    setChannelProgram: vi.fn(),
    setChannelGain: vi.fn(),
    allNotesOff: vi.fn(),
  };
}

describe('createGmSynthTier', () => {
  it('has id "gm-synth"', () => {
    expect(createGmSynthTier({ synth: makeSynth() }).id).toBe('gm-synth');
  });

  it('supports() is always true — the guaranteed tier', () => {
    const tier = createGmSynthTier({ synth: makeSynth() });
    for (let ch = 0; ch < 16; ch++) expect(tier.supports(ch)).toBe(true);
    expect(tier.supports()).toBe(true);
  });

  it('noteOn passes through unchanged', () => {
    const synth = makeSynth();
    createGmSynthTier({ synth }).noteOn(2, 64, 90);
    expect(synth.noteOn).toHaveBeenCalledWith(2, 64, 90);
  });

  it('noteOff passes through unchanged', () => {
    const synth = makeSynth();
    createGmSynthTier({ synth }).noteOff(2, 64);
    expect(synth.noteOff).toHaveBeenCalledWith(2, 64);
  });

  it('setProgram maps to synth.setChannelProgram', () => {
    const synth = makeSynth();
    createGmSynthTier({ synth }).setProgram(3, 33);
    expect(synth.setChannelProgram).toHaveBeenCalledWith(3, 33);
  });

  it('setGain maps to synth.setChannelGain', () => {
    const synth = makeSynth();
    createGmSynthTier({ synth }).setGain(3, 0.7);
    expect(synth.setChannelGain).toHaveBeenCalledWith(3, 0.7);
  });

  it('allNotesOff passes the channel through (and undefined for full panic)', () => {
    const synth = makeSynth();
    const tier = createGmSynthTier({ synth });
    tier.allNotesOff(9);
    expect(synth.allNotesOff).toHaveBeenCalledWith(9);
    tier.allNotesOff();
    expect(synth.allNotesOff).toHaveBeenLastCalledWith(undefined);
  });
});
