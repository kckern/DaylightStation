// frontend/src/modules/Player/lib/crtRenderer.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  createCrtRenderer,
  parseShaderParams,
  resolveParams,
  fitContain,
  CRT_GEOM_PRESET,
  DEFAULT_PRE_FILTER
} from './crtRenderer.js';
import CRT_GEOM_SRC from '../shaders/crt-geom.glsl?raw';

describe('parseShaderParams', () => {
  it('reads every #pragma parameter out of the vendored crt-geom source', () => {
    const params = parseShaderParams(CRT_GEOM_SRC);
    const names = params.map((p) => p.name);
    expect(names).toContain('CRTgamma');
    expect(names).toContain('DOTMASK');
    expect(names).toContain('scanline_weight');
    expect(names).toContain('CURVATURE');
    expect(params.length).toBe(18);
  });

  it('captures the declared default, min and max', () => {
    const dotmask = parseShaderParams(CRT_GEOM_SRC).find((p) => p.name === 'DOTMASK');
    expect(dotmask).toMatchObject({ def: 0.3, min: 0, max: 1 });
  });
});

describe('resolveParams', () => {
  it('layers the tuned preset over the shader defaults', () => {
    const resolved = resolveParams(CRT_GEOM_SRC, CRT_GEOM_PRESET);
    // overridden by the preset
    expect(resolved.CRTgamma).toBe(1.9);
    expect(resolved.INV).toBe(1);
    expect(resolved.R).toBe(1.8);
    expect(resolved.cornersize).toBe(0.041);
    // left at the shader's own default
    expect(resolved.DOTMASK).toBe(0.3);
    expect(resolved.scanline_weight).toBe(0.3);
    expect(resolved.SHARPER).toBe(1);
  });

  it('falls back to pure shader defaults with an empty preset', () => {
    expect(resolveParams(CRT_GEOM_SRC, {}).CRTgamma).toBe(2.4);
  });
});

describe('fitContain', () => {
  it('letterboxes a 4:3 source inside a 16:9 target', () => {
    // height fills, width is pillarboxed
    expect(fitContain(640, 480, 1920, 1080)).toEqual({ x: 240, y: 0, w: 1440, h: 1080 });
  });

  it('pillarboxes a wider-than-target source', () => {
    // 1000 * 360/640 = 562.5, rounded to 563, leaving 218.5 -> 219 of top offset
    expect(fitContain(640, 360, 1000, 1000)).toEqual({ x: 0, y: 219, w: 1000, h: 563 });
  });

  it('returns an empty rect rather than NaN when a dimension is missing', () => {
    expect(fitContain(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('createCrtRenderer', () => {
  const video = () => ({ videoWidth: 640, videoHeight: 480, readyState: 4 });

  it('reports unsupported instead of throwing when there is no canvas', () => {
    const r = createCrtRenderer({ canvas: null, video: video() });
    expect(r.supported).toBe(false);
    expect(r.reason).toBe('missing-canvas-or-video');
  });

  it('reports unsupported when the browser has no WebGL context', () => {
    // happy-dom has no WebGL, which is exactly the fallback case we care about
    const canvas = document.createElement('canvas');
    const r = createCrtRenderer({ canvas, video: video() });
    expect(r.supported).toBe(false);
    expect(['no-webgl-context', 'getcontext-threw']).toContain(r.reason);
  });

  it('gives back inert no-op controls when unsupported, so callers need no guards', () => {
    const r = createCrtRenderer({ canvas: null, video: null });
    expect(() => { r.start(); r.stop(); r.resize(); r.setParams({}); r.destroy(); }).not.toThrow();
  });

  it('logs the reason it bailed out', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    createCrtRenderer({ canvas: null, video: null, logger });
    expect(logger.warn).toHaveBeenCalledWith('crt.unsupported',
      expect.objectContaining({ reason: 'missing-canvas-or-video' }));
  });

  // stats() is part of the renderer's public shape, so the unsupported stub has
  // to answer it too or a caller reading frame counts crashes on the fallback path.
  it('the unsupported stub still answers stats() with zeroed counters', () => {
    const r = createCrtRenderer({ canvas: null, video: null });
    expect(r.stats()).toEqual({ drawn: 0, skipped: 0 });
  });

  it('surfaces getContext throwing rather than letting it escape', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => { throw new Error('boom'); };
    const r = createCrtRenderer({ canvas, video: video() });
    expect(r.supported).toBe(false);
    expect(r.reason).toBe('getcontext-threw');
  });
});

describe('defaults', () => {
  it('pre-filter blur is expressed in source pixels and defaults to a light touch', () => {
    expect(DEFAULT_PRE_FILTER.blurRadiusSourcePx).toBeGreaterThan(0);
    expect(DEFAULT_PRE_FILTER.blurRadiusSourcePx).toBeLessThanOrEqual(2);
    expect(DEFAULT_PRE_FILTER.blurMix).toBe(1);
  });

  it('the preset is frozen so a caller cannot mutate the shared look', () => {
    expect(Object.isFrozen(CRT_GEOM_PRESET)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// The frame pump, on the SUPPORTED path.
//
// happy-dom has no WebGL, so every test above takes the `unsupported` branch and
// pump() never runs. That left the skip instrument — and specifically the shape
// of its log payload — defended by nothing. A stand-in GL context is enough to
// reach supported: true, because the renderer only ever reads back two things
// (COMPILE_STATUS and LINK_STATUS) and otherwise just issues commands.
// ---------------------------------------------------------------------------

/** Minimal stand-in WebGL context: real answers where the renderer inspects a
 *  result, an enum for any SCREAMING_CASE constant, a recording no-op for the
 *  rest. */
function stubGl() {
  const base = {
    getShaderParameter: () => true,   // COMPILE_STATUS — else 'shader-build-failed'
    getProgramParameter: () => true,  // LINK_STATUS    — else 'shader-build-failed'
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getAttribLocation: () => 0,
    getUniformLocation: (_prog, name) => ({ name }),
    getExtension: () => null
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // gl.TEXTURE_2D, gl.RGBA, gl.COLOR_BUFFER_BIT, …
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) return 0x0DE1;
      return () => ({});
    }
  });
}

function stubCanvas() {
  const canvas = document.createElement('canvas');
  canvas.getContext = () => stubGl();
  canvas.getBoundingClientRect = () => ({ width: 1920, height: 1080, x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080 });
  return canvas;
}

/** A video that hands out rVFC callbacks we can fire by hand, one frame at a
 *  time, with whatever metadata the test wants. */
function stubVideo({ rvfc = true } = {}) {
  const pending = [];
  const v = {
    videoWidth: 720, videoHeight: 480, readyState: 4,
    cancelVideoFrameCallback: () => {},
    _pending: pending
  };
  if (rvfc) v.requestVideoFrameCallback = (cb) => { pending.push(cb); return pending.length; };
  return v;
}

function stubLogger({ sampled = true } = {}) {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  if (sampled) log.sampled = vi.fn();
  return log;
}

/** Fire the next queued rVFC callback with the given presentedFrames. */
function presentFrame(video, presentedFrames, mediaTime = presentedFrames / 24) {
  const cb = video._pending.shift();
  expect(cb, 'renderer did not schedule a frame callback').toBeTypeOf('function');
  cb(performance.now(), { presentedFrames, mediaTime, expectedDisplayTime: 0 });
}

describe('createCrtRenderer — frame pump', () => {
  it('reaches the supported path with a stand-in GL context', () => {
    const r = createCrtRenderer({ canvas: stubCanvas(), video: stubVideo(), logger: stubLogger() });
    expect(r.supported).toBe(true);
    expect(r.stats()).toEqual({ drawn: 0, skipped: 0 });
  });

  it('reports the rVFC driver and counts every painted frame', () => {
    const log = stubLogger();
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
    expect(log.info).toHaveBeenCalledWith('crt.renderer-created',
      expect.objectContaining({ driver: 'requestVideoFrameCallback' }));
    r.start();
    for (const pf of [10, 11, 12]) presentFrame(video, pf);
    expect(r.stats()).toEqual({ drawn: 3, skipped: 0 });
    expect(log.sampled).not.toHaveBeenCalled();
  });

  it('logs a gap in presentedFrames as skipped frames', () => {
    const log = stubLogger();
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
    r.start();
    presentFrame(video, 10);
    presentFrame(video, 14); // 11, 12, 13 were composited but never drawn
    expect(r.stats()).toEqual({ drawn: 2, skipped: 3 });
    expect(log.sampled).toHaveBeenCalledTimes(1);
    const [event, payload, opts] = log.sampled.mock.calls[0];
    expect(event).toBe('crt.frames-skipped');
    expect(payload.skipped).toBe(3);
    expect(opts).toEqual({ maxPerMinute: 6, aggregate: true });
  });

  // THE REGRESSION GUARD. `{ skipped: gap, ...frameStats.snapshot() }` looks
  // right and is wrong: the spread carries its own `skipped` and overwrites the
  // per-callback gap with the running total, so a steady trickle of single
  // misses logs as a monotonically climbing number that reads like escalating
  // judder. Two gaps of different size are what expose it.
  it('reports the per-callback gap, never the running total, as `skipped`', () => {
    const log = stubLogger();
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
    r.start();
    presentFrame(video, 0);
    presentFrame(video, 4);  // gap 3, total 3
    presentFrame(video, 9);  // gap 4, total 7
    expect(r.stats()).toEqual({ drawn: 3, skipped: 7 });
    expect(log.sampled).toHaveBeenCalledTimes(2);
    const first = log.sampled.mock.calls[0][1];
    const second = log.sampled.mock.calls[1][1];
    expect(first.skipped).toBe(3);
    expect(first.skippedTotal).toBe(3);
    expect(first.drawnTotal).toBe(2);
    // With the spread bug this reads 7 — the session total wearing the gap's name.
    expect(second.skipped).toBe(4);
    expect(second.skippedTotal).toBe(7);
    expect(second.drawnTotal).toBe(3);
  });

  it('passes the frame mediaTime through so a skip can be placed in the content', () => {
    const log = stubLogger();
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
    r.start();
    presentFrame(video, 10);
    presentFrame(video, 14, 123.5);
    expect(log.sampled.mock.calls[0][1].mediaTime).toBe(123.5);
  });

  // The rAF fallback calls pump(DOMHighResTimeStamp) with no second argument.
  it('draws but never reports a skip under the requestAnimationFrame fallback', () => {
    const log = stubLogger();
    const video = stubVideo({ rvfc: false }); // no requestVideoFrameCallback
    const frames = [];
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb) => { frames.push(cb); return frames.length; });
    try {
      const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
      expect(log.info).toHaveBeenCalledWith('crt.renderer-created',
        expect.objectContaining({ driver: 'requestAnimationFrame' }));
      r.start();
      for (let i = 0; i < 4; i++) frames.shift()(1234.5 + i * 16.7); // timestamp only
      expect(r.stats()).toEqual({ drawn: 4, skipped: 0 });
      expect(log.sampled).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  // crtRenderer's own default logger is a bare { debug, info, warn, error } with
  // no .sampled, which is why the emit is typeof-guarded.
  it('keeps drawing when the injected logger has no .sampled', () => {
    const log = stubLogger({ sampled: false });
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
    r.start();
    expect(() => { presentFrame(video, 1); presentFrame(video, 9); }).not.toThrow();
    expect(r.stats()).toEqual({ drawn: 2, skipped: 7 });
  });

  // drawFrame() bails out on readyState < 2 and keeps the pump re-arming, so a
  // pass that painted nothing must not be credited as a draw.
  it('does not count a pump pass that painted nothing', () => {
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: stubLogger() });
    r.start();
    presentFrame(video, 1);
    video.readyState = 1;           // buffering: drawFrame returns early
    presentFrame(video, 2);
    presentFrame(video, 3);
    expect(r.stats()).toEqual({ drawn: 1, skipped: 0 });
    video.readyState = 4;           // recovered
    presentFrame(video, 4);
    // 2 and 3 were composited while the canvas painted nothing — real skips.
    expect(r.stats()).toEqual({ drawn: 2, skipped: 2 });
  });

  it('stops pumping after stop() and reports the session totals once', () => {
    const log = stubLogger();
    const video = stubVideo();
    const r = createCrtRenderer({ canvas: stubCanvas(), video, logger: log });
    r.start();
    presentFrame(video, 1);
    presentFrame(video, 5);
    r.stop();
    expect(log.info).toHaveBeenCalledWith('crt.stopped',
      expect.objectContaining({ drawn: 2, skipped: 3, driver: 'requestVideoFrameCallback' }));
    const stoppedCalls = () => log.info.mock.calls.filter((c) => c[0] === 'crt.stopped').length;
    expect(stoppedCalls()).toBe(1);
    r.stop();      // idempotent
    r.destroy();   // also calls stop()
    expect(stoppedCalls()).toBe(1);
  });
});
