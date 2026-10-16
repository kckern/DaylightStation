import { describe, it, expect } from 'vitest';
import { LayoutManager } from './LayoutManager.js';

const margin = { top: 40, right: 90, bottom: 38, left: 30 };
const make = (r) => new LayoutManager({
  bounds: { width: 845, height: 309, margin },
  avatarRadius: r,
  options: { enableConnectors: true, minSpacing: 4, collisionAxis: 'vertical' },
});
const avatar = (id, x, y) => ({ type: 'avatar', id, x, y, value: 1 });

describe('LayoutManager vertical stacking (session detail)', () => {
  it('separates crowded line ends by a full diameter, inside the plot, with connectors', () => {
    const r = 18;
    // five riders finishing at the same time with close values (9 Oct shape)
    const input = [avatar('a', 740, 80), avatar('b', 742, 90), avatar('c', 744, 150), avatar('d', 739, 160), avatar('e', 741, 230)];
    const { elements, connectors } = make(r).layout(input);
    const placed = elements.filter((e) => e.type === 'avatar').map((e) => ({ id: e.id, x: e.x + (e.offsetX || 0), y: e.y + (e.offsetY || 0), moved: Math.abs(e.offsetY || 0) > 5 }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const d = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
        expect(d).toBeGreaterThanOrEqual(2 * r);
      }
      expect(placed[i].y).toBeGreaterThanOrEqual(margin.top + r - 0.01);
      expect(placed[i].y).toBeLessThanOrEqual(309 - margin.bottom - r + 0.01);
    }
    const movedIds = placed.filter((p) => p.moved).map((p) => `connector-${p.id}`).sort();
    expect(connectors.map((c) => c.id).sort()).toEqual(movedIds);
  });

  it('keeps the order of true heights and leaves a lone avatar where it is', () => {
    const { elements } = make(20).layout([avatar('top', 700, 100), avatar('low', 702, 104), avatar('solo', 300, 200)]);
    const y = Object.fromEntries(elements.map((e) => [e.id, e.y + (e.offsetY || 0)]));
    expect(y.top).toBeLessThan(y.low);
    expect(y.solo).toBe(200);
  });
});
