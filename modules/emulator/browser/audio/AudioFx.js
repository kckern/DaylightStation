/**
 * AudioFx — a Web Audio effects bus for the Emulator Console.
 *
 * Processes the EmulatorJS audio output through a config-/state-driven FX chain:
 *
 *   source.gain(s) ──▶ input ──▶ EQ(low→mid→high) ──┬─▶ dryGain ───────────┐
 *                                                    └─▶ wetGain ─▶ convolver┴─▶ reverbMerge
 *                                                                              │
 *   reverbMerge ──▶ lowpass ──▶ highpass ──▶ compressor ──▶ output ──▶ destination
 *
 * Volume stays UPSTREAM of FX: EmulatorJS's own `setVolume` walks the source
 * gains, so we tap AFTER each `source.gain`. The injected `getSourceGains()`
 * returns the live array of GainNodes to patch (in the app this reads
 * `Module.AL.currentCtx.sources` → `.gain`).
 *
 * All audio I/O is injected so this is fully unit-testable with a fake
 * AudioContext (jsdom has no real AudioContext).
 *
 * @param {object} deps
 * @param {AudioContext} deps.audioContext  The live (or fake) AudioContext.
 * @param {() => GainNode[]} deps.getSourceGains  Returns current source gains to tap.
 * @param {object} [deps.logger]  Optional logger child; defaults to the module logger.
 */

import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'emulator-audiofx' });
  return _logger;
}

// FX parameter bounds / defaults.
const EQ_DB_MIN = -24;
const EQ_DB_MAX = 24;
const LOWPASS_OPEN = 20000;
const HIGHPASS_OPEN = 20;
const EQ_LOW_FREQ = 250;
const EQ_MID_FREQ = 1000;
const EQ_HIGH_FREQ = 4000;
const REVERB_DURATION_S = 2.0; // synthetic impulse-response length
const COMPRESSOR_DEFAULTS = Object.freeze({
  threshold: -24,
  ratio: 12,
  attack: 0.003,
  release: 0.25,
});

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function clamp01(v) {
  return clamp(v, 0, 1);
}

/** Set an AudioParam-shaped field's value, tolerating a missing param. */
function setParam(param, value) {
  if (param && typeof param === 'object' && 'value' in param) {
    param.value = value;
  }
}

export function createAudioFx({ audioContext, getSourceGains, logger: injectedLogger } = {}) {
  const ctx = audioContext;
  const log = injectedLogger || logger();
  const getGains = typeof getSourceGains === 'function' ? getSourceGains : () => [];

  let chain = null;
  const patched = new WeakSet();

  /**
   * Generate a synthetic impulse response: exponentially-decaying random noise.
   * Returns null (and logs) if createBuffer is unavailable.
   */
  function buildImpulseResponse() {
    if (typeof ctx.createBuffer !== 'function') {
      log.warn('audiofx.reverb-skipped', { reason: 'no-createBuffer' });
      return null;
    }
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * REVERB_DURATION_S));
    const buffer = ctx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        const decay = Math.pow(1 - i / data.length, 2.5);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    return buffer;
  }

  /** Build the FX graph once. Idempotent. */
  function buildChain() {
    if (chain) return chain;

    const input = ctx.createGain();

    // --- EQ: low shelf → peaking mid → high shelf ---
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    setParam(eqLow.frequency, EQ_LOW_FREQ);
    setParam(eqLow.gain, 0);

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    setParam(eqMid.frequency, EQ_MID_FREQ);
    setParam(eqMid.Q, 1);
    setParam(eqMid.gain, 0);

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    setParam(eqHigh.frequency, EQ_HIGH_FREQ);
    setParam(eqHigh.gain, 0);

    input.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);

    // --- Reverb: parallel dry/wet after EQ, recombined at reverbMerge ---
    const dryGain = ctx.createGain();
    setParam(dryGain.gain, 1); // bypass by default
    const wetGain = ctx.createGain();
    setParam(wetGain.gain, 0);
    const convolver = ctx.createConvolver();
    const reverbMerge = ctx.createGain();

    const ir = buildImpulseResponse();
    if (ir) convolver.buffer = ir;

    eqHigh.connect(dryGain);
    eqHigh.connect(wetGain);
    wetGain.connect(convolver);
    dryGain.connect(reverbMerge);
    convolver.connect(reverbMerge);

    // --- Filter: lowpass then highpass (wide open by default) ---
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    setParam(lowpass.frequency, LOWPASS_OPEN);

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    setParam(highpass.frequency, HIGHPASS_OPEN);

    reverbMerge.connect(lowpass);
    lowpass.connect(highpass);

    // --- Compressor ---
    const compressor = ctx.createDynamicsCompressor();
    setParam(compressor.threshold, COMPRESSOR_DEFAULTS.threshold);
    setParam(compressor.ratio, COMPRESSOR_DEFAULTS.ratio);
    setParam(compressor.attack, COMPRESSOR_DEFAULTS.attack);
    setParam(compressor.release, COMPRESSOR_DEFAULTS.release);

    highpass.connect(compressor);

    // --- Output → destination ---
    const output = ctx.createGain();
    compressor.connect(output);
    output.connect(ctx.destination);

    chain = {
      input,
      eqLow,
      eqMid,
      eqHigh,
      dryGain,
      wetGain,
      convolver,
      reverbMerge,
      lowpass,
      highpass,
      compressor,
      output,
      reverbAvailable: !!ir,
    };
    log.info('audiofx.chain-built', { reverb: !!ir, sampleRate: ctx.sampleRate });
    return chain;
  }

  /** Patch any source gains not already routed into our input. Returns count. */
  function patchGains() {
    const built = buildChain();
    const gains = getGains() || [];
    let count = 0;
    for (const gain of gains) {
      if (!gain || patched.has(gain)) continue;
      try {
        if (typeof gain.disconnect === 'function') gain.disconnect();
        gain.connect(built.input);
        patched.add(gain);
        count += 1;
      } catch (err) {
        log.warn('audiofx.patch-failed', { error: err && err.message });
      }
    }
    if (count > 0) log.debug('audiofx.patched', { count });
    return count;
  }

  function attach() {
    return patchGains();
  }

  function repatch() {
    return patchGains();
  }

  function setEq({ low, mid, high } = {}) {
    const c = buildChain();
    if (low !== undefined && low !== null) setParam(c.eqLow.gain, clamp(low, EQ_DB_MIN, EQ_DB_MAX));
    if (mid !== undefined && mid !== null) setParam(c.eqMid.gain, clamp(mid, EQ_DB_MIN, EQ_DB_MAX));
    if (high !== undefined && high !== null) setParam(c.eqHigh.gain, clamp(high, EQ_DB_MIN, EQ_DB_MAX));
  }

  function setReverb(amount) {
    const c = buildChain();
    const wet = clamp01(amount);
    setParam(c.wetGain.gain, wet);
    setParam(c.dryGain.gain, 1 - wet);
  }

  function setFilter({ lowpass, highpass } = {}) {
    const c = buildChain();
    if (lowpass !== undefined && lowpass !== null) setParam(c.lowpass.frequency, lowpass);
    if (highpass !== undefined && highpass !== null) setParam(c.highpass.frequency, highpass);
  }

  function setCompressor({ threshold, ratio, attack, release } = {}) {
    const c = buildChain();
    if (threshold !== undefined && threshold !== null) setParam(c.compressor.threshold, threshold);
    if (ratio !== undefined && ratio !== null) setParam(c.compressor.ratio, ratio);
    if (attack !== undefined && attack !== null) setParam(c.compressor.attack, attack);
    if (release !== undefined && release !== null) setParam(c.compressor.release, release);
  }

  function apply(config = {}) {
    buildChain();
    if (config.eq) setEq(config.eq);
    if (config.reverb !== undefined && config.reverb !== null) setReverb(config.reverb);
    if (config.lowpass !== undefined || config.highpass !== undefined) {
      setFilter({ lowpass: config.lowpass, highpass: config.highpass });
    }
    if (config.compressor) setCompressor(config.compressor);
    log.debug('audiofx.applied', { config });
  }

  function reset() {
    const c = buildChain();
    setParam(c.eqLow.gain, 0);
    setParam(c.eqMid.gain, 0);
    setParam(c.eqHigh.gain, 0);
    setParam(c.wetGain.gain, 0);
    setParam(c.dryGain.gain, 1);
    setParam(c.lowpass.frequency, LOWPASS_OPEN);
    setParam(c.highpass.frequency, HIGHPASS_OPEN);
    setParam(c.compressor.threshold, COMPRESSOR_DEFAULTS.threshold);
    setParam(c.compressor.ratio, COMPRESSOR_DEFAULTS.ratio);
    setParam(c.compressor.attack, COMPRESSOR_DEFAULTS.attack);
    setParam(c.compressor.release, COMPRESSOR_DEFAULTS.release);
    log.info('audiofx.reset', {});
  }

  /** Best-effort teardown: route source gains straight to destination, drop our chain. */
  function detach() {
    const gains = getGains() || [];
    for (const gain of gains) {
      if (!gain) continue;
      try {
        if (typeof gain.disconnect === 'function') gain.disconnect();
        gain.connect(ctx.destination);
        patched.delete(gain);
      } catch (err) {
        log.warn('audiofx.detach-gain-failed', { error: err && err.message });
      }
    }
    if (chain && typeof chain.output.disconnect === 'function') {
      try {
        chain.output.disconnect();
      } catch (err) {
        log.warn('audiofx.detach-output-failed', { error: err && err.message });
      }
    }
    log.info('audiofx.detached', {});
  }

  return {
    attach,
    repatch,
    setEq,
    setReverb,
    setFilter,
    setCompressor,
    apply,
    reset,
    detach,
    // Exposed for testing / introspection.
    get _chain() {
      return buildChain();
    },
  };
}

export default createAudioFx;
