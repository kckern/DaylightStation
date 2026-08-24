import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawScenePlanToCanvas } from './CanvasPlanRenderer.js';

describe('presentation Canvas executor', () => {
  const OriginalImage = globalThis.Image;
  afterEach(() => { globalThis.Image = OriginalImage; });

  it('executes plan order at exact pixel scale with smoothing disabled', async () => {
    globalThis.Image = class FakeImage { async decode() {} };
    const context = {
      imageSmoothingEnabled: true, fillStyle: '', globalAlpha: 1,
      fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const catalog = { assets: { hero: {
      image_url: '/hero.png', pixel_density: 1, geometry: { layout: 'grid', cell: [16, 16] }, defaults: { anchor: 'bottom-center' }, world: {}, frames: { idle: { cell: [0, 0] } },
    } } };
    const plan = { logical_size: [40, 30], pixel_scale: 2, background: '#123456', hash: 'stable', commands: [
      { type: 'fill', at: [0, 0], size: [16, 16], color: '#0095e9', opacity: 1 },
      { type: 'shadow', at: [10, 12], size: [8, 3], color: '#000000', opacity: 0.2 },
      { type: 'sprite', asset: 'hero', frame: 'idle', source_cell_offset: [0, 0], at: [10, 12], opacity: 1, rotation: 0, flip_x: false, clip_polygon: [[0, 0], [16, 0], [8, 8]] },
    ] };
    const result = await drawScenePlanToCanvas(canvas, catalog, plan);
    expect(result).toEqual({ width: 80, height: 60, plan_hash: 'stable', draws: 3 });
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 80, 60);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 32, 32);
    expect(context.ellipse).toHaveBeenCalledWith(20, 24, 8, 3, 0, 0, Math.PI * 2);
    expect(context.moveTo).toHaveBeenCalledWith(20, 24);
    expect(context.lineTo).toHaveBeenCalledWith(52, 24);
    expect(context.lineTo).toHaveBeenCalledWith(36, 40);
    expect(context.clip).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 16, 16, -16, -32, 32, 32);
  });

  it('composes browser frames offscreen before one visible-canvas blit', async () => {
    globalThis.Image = class FakeImage { async decode() {} };
    const context = () => ({
      imageSmoothingEnabled: true, fillStyle: '', globalAlpha: 1,
      clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
    });
    const visible = context(); const offscreen = context(); const buffer = { width: 0, height: 0, getContext: () => offscreen };
    const canvas = { width: 0, height: 0, getContext: () => visible, ownerDocument: { createElement: () => buffer } };
    const catalog = { assets: {} };
    const plan = { logical_size: [16, 16], pixel_scale: 2, background: '#123456', hash: 'atomic', commands: [{ type: 'fill', at: [0, 0], size: [16, 16], color: '#0095e9', opacity: 1 }] };
    await drawScenePlanToCanvas(canvas, catalog, plan);
    expect(offscreen.fillRect).toHaveBeenCalledWith(0, 0, 32, 32);
    expect(visible.fillRect).not.toHaveBeenCalled();
    expect(visible.drawImage).toHaveBeenCalledOnce();
    expect(visible.drawImage).toHaveBeenCalledWith(buffer, 0, 0);
  });
});
