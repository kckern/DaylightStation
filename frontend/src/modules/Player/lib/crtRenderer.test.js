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
