// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rms, tailEnergyDb, decayTimeMs, findPeak, windowDb } from './metrics.mjs';

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

describe('findPeak', () => {
  it('locates the note strike even when it starts late in the clip', () => {
    // Tone begins at 1500ms — like the real recordings (latency-shifted).
    const p = findPeak(decayingTone({ afterMs: 1500, tau: 0.4 }), SR);
    expect(p.peakAtMs).toBeGreaterThan(1450);
    expect(p.peakAtMs).toBeLessThan(1650);
    expect(p.peakDb).toBeGreaterThan(-15);
  });
  it('returns a deep-silence peak for an empty clip', () => {
    expect(findPeak(new Float32Array(SR), SR).peakDb).toBeLessThan(-100);
  });
});

describe('windowDb', () => {
  it('measures only the requested time window', () => {
    const s = decayingTone({ afterMs: 1000, tau: 0.3, durMs: 1000 });
    const beforeNote = windowDb(s, SR, 0, 900);     // silence before the note
    const onNote = windowDb(s, SR, 1000, 1200);     // the note itself
    expect(onNote).toBeGreaterThan(beforeNote + 20);
  });
});
