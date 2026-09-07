import { describe, it, expect } from 'vitest';
import { fullscreenVitalsLayout } from './fullscreenVitalsLayout.js';

describe('fullscreenVitalsLayout', () => {
  it('packs six people and two equipment tiles into a bounded two-column grid', () => {
    expect(fullscreenVitalsLayout({ width: 1280, height: 720, heartRates: 6, equipment: 2 })).toMatchObject({ columns: 2, rows: 4, width: 184, height: 376, scale: 1 });
  });
  it('shares an equipment row and maximizes scale on a shorter player', () => {
    expect(fullscreenVitalsLayout({ width: 960, height: 540, heartRates: 6, equipment: 2 })).toMatchObject({ columns: 3, rows: 3, scale: 1 });
  });
  it('prefers narrower arrangements when scale is equal', () => {
    expect(fullscreenVitalsLayout({ width: 1920, height: 1080, heartRates: 6, equipment: 0 }).columns).toBe(1);
  });
  it.each([[320,180,6,4],[480,320,12,8],[1280,720,24,8],[1920,1080,6,2]])('fits %ix%i without stretching tiles', (width,height,heartRates,equipment) => {
    const layout = fullscreenVitalsLayout({ width,height,heartRates,equipment });
    expect(layout.width*layout.scale).toBeLessThanOrEqual(Math.min(320,width*0.3)+1e-8);
    expect(layout.height*layout.scale).toBeLessThanOrEqual(height*0.55+1e-8);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThanOrEqual(1);
  });
  it('keeps empty or unmeasured overlays at zero size', () => {
    expect(fullscreenVitalsLayout({ width:0,height:0,heartRates:6,equipment:2 }).scale).toBe(0);
    expect(fullscreenVitalsLayout({ width:1280,height:720,heartRates:0,equipment:0 }).height).toBe(0);
  });
});
