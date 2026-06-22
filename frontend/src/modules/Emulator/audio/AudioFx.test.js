import { describe, it, expect, vi } from 'vitest';
import { createAudioFx } from './AudioFx.js';

/**
 * Fake Web Audio node — records connect/disconnect and exposes AudioParam-shaped
 * fields as plain `{ value }` objects so tests can assert on `.value`.
 */
function fakeBiquad() {
  return {
    type: 'peaking',
    frequency: { value: 350 },
    Q: { value: 1 },
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function fakeGain(value = 1) {
  return {
    gain: { value },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function fakeConvolver() {
  return {
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function fakeCompressor() {
  return {
    threshold: { value: -24 },
    ratio: { value: 12 },
    attack: { value: 0.003 },
    release: { value: 0.25 },
    knee: { value: 30 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/**
 * Build a fake AudioContext. By default includes createBuffer; pass
 * { withBuffer: false } to omit it (to test the reverb-skip guard).
 */
function fakeCtx({ withBuffer = true } = {}) {
  const ctx = {
    sampleRate: 44100,
    destination: { id: 'destination' },
    createGain: vi.fn(() => fakeGain(1)),
    createBiquadFilter: vi.fn(() => fakeBiquad()),
    createConvolver: vi.fn(() => fakeConvolver()),
    createDynamicsCompressor: vi.fn(() => fakeCompressor()),
  };
  if (withBuffer) {
    ctx.createBuffer = vi.fn((channels, length) => ({
      length,
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
    }));
  }
  return ctx;
}

describe('AudioFx', () => {
  describe('attach() / patching source gains', () => {
    it('taps each source gain: disconnect + connect(input)', () => {
      const ctx = fakeCtx();
      const g1 = fakeGain();
      const g2 = fakeGain();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [g1, g2] });

      const count = fx.attach();

      expect(count).toBe(2);
      const input = fx._chain.input;
      for (const g of [g1, g2]) {
        expect(g.disconnect).toHaveBeenCalled();
        expect(g.connect).toHaveBeenCalledWith(input);
      }
    });

    it('does not re-patch an already-patched gain (WeakSet idempotent)', () => {
      const ctx = fakeCtx();
      const g1 = fakeGain();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [g1] });

      expect(fx.attach()).toBe(1);
      g1.connect.mockClear();
      g1.disconnect.mockClear();

      expect(fx.attach()).toBe(0);
      expect(g1.connect).not.toHaveBeenCalled();
      expect(g1.disconnect).not.toHaveBeenCalled();
    });

    it('repatch() patches a newly-added gain only', () => {
      const ctx = fakeCtx();
      const g1 = fakeGain();
      const g2 = fakeGain();
      let gains = [g1];
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => gains });

      expect(fx.attach()).toBe(1);
      g1.connect.mockClear();

      gains = [g1, g2];
      expect(fx.repatch()).toBe(1);
      expect(g1.connect).not.toHaveBeenCalled();
      expect(g2.connect).toHaveBeenCalledWith(fx._chain.input);
    });
  });

  describe('chain build', () => {
    it('input connects through the EQ biquads and output reaches destination', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      const { input, eqLow, eqMid, eqHigh, output } = fx._chain;
      expect(input.connect).toHaveBeenCalledWith(eqLow);
      expect(eqLow.connect).toHaveBeenCalledWith(eqMid);
      expect(eqMid.connect).toHaveBeenCalledWith(eqHigh);
      expect(output.connect).toHaveBeenCalledWith(ctx.destination);
    });

    it('sets biquad types correctly (lowshelf / peaking / highshelf)', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      expect(fx._chain.eqLow.type).toBe('lowshelf');
      expect(fx._chain.eqMid.type).toBe('peaking');
      expect(fx._chain.eqHigh.type).toBe('highshelf');
      expect(fx._chain.lowpass.type).toBe('lowpass');
      expect(fx._chain.highpass.type).toBe('highpass');
    });

    it('wires reverb in parallel: dry + wet→convolver → reverbMerge', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      const { eqHigh, dryGain, wetGain, convolver, reverbMerge } = fx._chain;
      // EQ tail fans out to both dry and wet
      expect(eqHigh.connect).toHaveBeenCalledWith(dryGain);
      expect(eqHigh.connect).toHaveBeenCalledWith(wetGain);
      expect(wetGain.connect).toHaveBeenCalledWith(convolver);
      expect(dryGain.connect).toHaveBeenCalledWith(reverbMerge);
      expect(convolver.connect).toHaveBeenCalledWith(reverbMerge);
      // Synthetic impulse response was generated + assigned
      expect(ctx.createBuffer).toHaveBeenCalled();
      expect(convolver.buffer).not.toBeNull();
    });
  });

  describe('controls', () => {
    it('setEq sets the three biquad gain values', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      fx.setEq({ low: 6, mid: -3, high: 2 });
      expect(fx._chain.eqLow.gain.value).toBe(6);
      expect(fx._chain.eqMid.gain.value).toBe(-3);
      expect(fx._chain.eqHigh.gain.value).toBe(2);
    });

    it('setEq clamps dB to -24..24', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      fx.setEq({ low: 100, high: -100 });
      expect(fx._chain.eqLow.gain.value).toBe(24);
      expect(fx._chain.eqHigh.gain.value).toBe(-24);
    });

    it('setReverb(0.4) → wet 0.4, dry 0.6 (clamped 0..1)', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      fx.setReverb(0.4);
      expect(fx._chain.wetGain.gain.value).toBeCloseTo(0.4);
      expect(fx._chain.dryGain.gain.value).toBeCloseTo(0.6);

      fx.setReverb(5);
      expect(fx._chain.wetGain.gain.value).toBe(1);
      expect(fx._chain.dryGain.gain.value).toBe(0);
    });

    it('setFilter({lowpass:800}) sets lowpass freq; highpass stays wide-open', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();
      const hpBefore = fx._chain.highpass.frequency.value;

      fx.setFilter({ lowpass: 800 });
      expect(fx._chain.lowpass.frequency.value).toBe(800);
      expect(fx._chain.highpass.frequency.value).toBe(hpBefore);
    });

    it('setCompressor sets provided params only', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();
      const attackBefore = fx._chain.compressor.attack.value;

      fx.setCompressor({ threshold: -30, ratio: 8 });
      expect(fx._chain.compressor.threshold.value).toBe(-30);
      expect(fx._chain.compressor.ratio.value).toBe(8);
      expect(fx._chain.compressor.attack.value).toBe(attackBefore);
    });

    it('apply applies eq/reverb/filter/compressor in one call', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      fx.apply({ eq: { low: 3 }, reverb: 0.5, lowpass: 1200, compressor: { ratio: 6 } });
      expect(fx._chain.eqLow.gain.value).toBe(3);
      expect(fx._chain.wetGain.gain.value).toBeCloseTo(0.5);
      expect(fx._chain.lowpass.frequency.value).toBe(1200);
      expect(fx._chain.compressor.ratio.value).toBe(6);
    });

    it('reset returns to flat / bypass values', () => {
      const ctx = fakeCtx();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [] });
      fx.attach();

      fx.setEq({ low: 6, mid: 6, high: 6 });
      fx.setReverb(0.8);
      fx.setFilter({ lowpass: 500, highpass: 500 });

      fx.reset();
      expect(fx._chain.eqLow.gain.value).toBe(0);
      expect(fx._chain.eqMid.gain.value).toBe(0);
      expect(fx._chain.eqHigh.gain.value).toBe(0);
      expect(fx._chain.wetGain.gain.value).toBe(0);
      expect(fx._chain.dryGain.gain.value).toBe(1);
      expect(fx._chain.lowpass.frequency.value).toBeGreaterThanOrEqual(20000);
      expect(fx._chain.highpass.frequency.value).toBeLessThanOrEqual(20);
    });
  });

  describe('reverb guard', () => {
    it('skips reverb gracefully when createBuffer is unavailable', () => {
      const ctx = fakeCtx({ withBuffer: false });
      const g1 = fakeGain();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [g1] });

      expect(() => fx.attach()).not.toThrow();
      // Convolver had no buffer assigned (skipped).
      expect(fx._chain.convolver.buffer).toBeNull();
      // Other FX still work.
      fx.setEq({ low: 5 });
      expect(fx._chain.eqLow.gain.value).toBe(5);
      // Patching still occurred.
      expect(g1.connect).toHaveBeenCalledWith(fx._chain.input);
    });
  });

  describe('detach()', () => {
    it('reconnects source gains to destination and disconnects the chain', () => {
      const ctx = fakeCtx();
      const g1 = fakeGain();
      const fx = createAudioFx({ audioContext: ctx, getSourceGains: () => [g1] });
      fx.attach();
      g1.disconnect.mockClear();
      g1.connect.mockClear();

      fx.detach();
      expect(g1.disconnect).toHaveBeenCalled();
      expect(g1.connect).toHaveBeenCalledWith(ctx.destination);
      expect(fx._chain.output.disconnect).toHaveBeenCalled();
    });
  });
});
