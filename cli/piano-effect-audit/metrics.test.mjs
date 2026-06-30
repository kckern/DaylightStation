// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rms, tailEnergyDb, decayTimeMs } from './metrics.mjs';

const SR = 48000;

// Synthetic: silence until `afterMs`, then an exponentially-decaying tone.
function decayingTone({ sr = SR, afterMs = 100, freq = 440, tau = 0.3, durMs = 2000 }) {
  const total = Math.floor(((afterMs + durMs) / 1000) * sr);
  const start = Math.floor((afterMs / 1000) * sr);
  const s = new Float32Array(total);
  for (let i = start; i < total; i++) {
    const t = (i - start) / sr;
    s[i] = Math.exp(-t / tau) * Math.sin(2 * Math.PI * freq * t);
  }
  return s;
}

describe('rms', () => {
  it('is ~0.707 for a unit sine, 0 for silence', () => {
    const s = new Float32Array(SR);
    for (let i = 0; i < SR; i++) s[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
    expect(rms(s)).toBeGreaterThan(0.69);
    expect(rms(s)).toBeLessThan(0.72);
    expect(rms(new Float32Array(SR))).toBe(0);
  });
});

describe('tailEnergyDb', () => {
  it('is much higher with a long tail than with a short one', () => {
    const longTail = tailEnergyDb(decayingTone({ tau: 0.6 }), SR, 100);
    const shortTail = tailEnergyDb(decayingTone({ tau: 0.05 }), SR, 100);
    expect(longTail).toBeGreaterThan(shortTail + 6);
  });
  it('is near the silence floor for an empty tail', () => {
    expect(tailEnergyDb(new Float32Array(SR), SR, 100)).toBeLessThan(-100);
  });
});

describe('decayTimeMs', () => {
  it('is longer for a slower decay (bigger tau)', () => {
    const slow = decayTimeMs(decayingTone({ tau: 0.6 }), SR, 100, 20);
    const fast = decayTimeMs(decayingTone({ tau: 0.1 }), SR, 100, 20);
    expect(slow).toBeGreaterThan(fast);
  });
  it('approximates tau*ln(10) for a 20 dB drop', () => {
    const tau = 0.3;
    const dt = decayTimeMs(decayingTone({ tau }), SR, 100, 20);
    const expected = tau * Math.log(10) * 1000; // ms
    expect(Math.abs(dt - expected)).toBeLessThan(80);
  });
});
