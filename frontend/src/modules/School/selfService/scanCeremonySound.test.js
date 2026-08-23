import { afterEach, describe, expect, it, vi } from 'vitest';

const masterState = vi.hoisted(() => ({ value: 1 }));
vi.mock('../../../lib/volume/ScreenVolumeContext.js', () => ({
  getEffectiveMaster: () => masterState.value,
}));

import { playScanCeremonyTone, _resetForTests } from './scanCeremonySound.js';

function installAudioContext() {
  const start = vi.fn();
  const oscillator = {
    type: null,
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
    start,
    stop: vi.fn(),
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  };
  const oscillators = [];
  globalThis.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
    createOscillator() { oscillators.push(oscillator); return oscillator; }
    createGain() { return gain; }
  };
  return { start, oscillator, gain, oscillators };
}

afterEach(() => {
  delete globalThis.AudioContext;
  masterState.value = 1;
  _resetForTests();
});

describe('playScanCeremonyTone', () => {
  it('plays a rising two-note pattern for success', () => {
    const { start, oscillators } = installAudioContext();
    expect(playScanCeremonyTone('success')).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
    expect(oscillators).toHaveLength(2);
  });

  it('plays a single held tone for warn', () => {
    const { start } = installAudioContext();
    expect(playScanCeremonyTone('warn')).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('plays a two-note low buzz for error', () => {
    const { start, oscillator } = installAudioContext();
    expect(playScanCeremonyTone('error')).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
    expect(oscillator.type).toBe('square');
  });

  it('scales gain by the effective screen volume master', () => {
    const { gain } = installAudioContext();
    masterState.value = 0.5;
    playScanCeremonyTone('success');
    // peak (0.22) * master (0.5) = 0.11
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.11, 5), expect.any(Number),
    );
  });

  it('does not play when the software master is muted (0)', () => {
    const { start } = installAudioContext();
    masterState.value = 0;
    expect(playScanCeremonyTone('success')).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('returns false for an unknown tone', () => {
    installAudioContext();
    expect(playScanCeremonyTone('bogus')).toBe(false);
  });

  it('returns false and never throws when AudioContext is unavailable', () => {
    delete globalThis.AudioContext;
    expect(() => playScanCeremonyTone('success')).not.toThrow();
    expect(playScanCeremonyTone('success')).toBe(false);
  });

  it('swallows an oscillator error and never throws', () => {
    globalThis.AudioContext = class {
      constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
      createOscillator() { throw new Error('boom'); }
      createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn().mockReturnThis() }; }
    };
    expect(() => playScanCeremonyTone('success')).not.toThrow();
    expect(playScanCeremonyTone('success')).toBe(false);
  });
});
