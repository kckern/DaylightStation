import { describe, it, expect } from 'vitest';
import { drawScene } from './povCanvasScene.js';
import { BASE_CAMERA } from './povCamera.js';

// Mock 2D context: records stroke calls with the strokeStyle active at stroke time.
function mockCtx() {
  const calls = { clearRect: 0, stroke: 0, strokeStyles: [], lineWidths: [] };
  return {
    calls,
    _style: '',
    _w: 0,
    set strokeStyle(v) { this._style = v; },
    get strokeStyle() { return this._style; },
    set lineWidth(v) { this._w = v; },
    get lineWidth() { return this._w; },
    set lineCap(_) {},
    clearRect() { calls.clearRect++; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { calls.stroke++; calls.strokeStyles.push(this._style); calls.lineWidths.push(this._w); }
  };
}

const alphaOf = (rgba) => Number(rgba.match(/[\d.]+\)$/)[0].replace(')', ''));

describe('drawScene', () => {
  const railsX = [0, 25, 50, 75, 100];
  const lineSlots = [
    { slot: 0, m: 0, major: true, t: 0.1, y: 0.9, scale: 0.9, opacity: 0.8 },
    { slot: 5, m: 200, major: false, t: 0.9, y: 0.3, scale: 0.2, opacity: 0.1 },
    { slot: 9, m: 400, major: false, t: 1.0, y: 0.22, scale: 0.16, opacity: 0 }
  ];

  it('no-ops on a missing context or zero size', () => {
    expect(() => drawScene(null, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 10, h: 10 } })).not.toThrow();
    const ctx = mockCtx();
    drawScene(ctx, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 0, h: 0 } });
    expect(ctx.calls.clearRect).toBe(0);
  });

  it('clears, then dual-pass strokes every rail and every visible truss', () => {
    const ctx = mockCtx();
    drawScene(ctx, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 200, h: 100 } });
    expect(ctx.calls.clearRect).toBe(1);
    expect(ctx.calls.stroke).toBe((5 + 2) * 2);
  });

  it('fogs: the far/faint truss strokes are dimmer than the near/bright one', () => {
    const ctx = mockCtx();
    drawScene(ctx, { camera: BASE_CAMERA, lineSlots, railsX, dims: { w: 200, h: 100 } });
    const alphas = ctx.calls.strokeStyles.map(alphaOf);
    expect(Math.max(...alphas)).toBeGreaterThan(Math.min(...alphas));
  });
});
