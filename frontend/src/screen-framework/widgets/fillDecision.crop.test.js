import { describe, it, expect } from 'vitest';
import { fillDecision } from './artModes.js';

const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const base = { mode: 'single', ratios: [1.3], frame: FRAME, cropV: 0.13, cropH: 0.25 };

describe('fillDecision crop gate', () => {
  it('enabled:false forces the matted gallery, regardless of budget', () => {
    const d = fillDecision({ ...base, crop: { enabled: false } });
    expect(d.view).toBe('gallery');
    expect(d.qualified).toBe(false);
  });
  it('a band forces framed-cover even when ratio would not qualify', () => {
    const d = fillDecision({ ...base, ratios: [1.0], crop: { top: 10, bottom: 10 } });
    expect(d.view).toBe('framed-cover');
    expect(d.qualified).toBe(true);
  });
  it('no crop → unchanged auto behavior', () => {
    const d = fillDecision({ ...base, ratios: [1.0] });
    expect(d.view).toBe('gallery'); // 1.0 is squarer than the opening; stays matted
  });
  it('a horizontal (left/right) band forces framed-cover on the left-right axis', () => {
    const d = fillDecision({ ...base, ratios: [3.5], crop: { left: 15, right: 15 } });
    expect(d.view).toBe('framed-cover');
    expect(d.qualified).toBe(true);
    expect(d.axis).toBe('left-right');
  });
});
