import { describe, it, expect } from 'vitest';
import {
  columnTemplateFor, fitScale, gaugeRowSize, CHROME_BELOW_GAUGE_PX,
  SPEEDO_MIN_GAUGE_SIDEBAR, SPEEDO_MAX_GAUGE_SIDEBAR, SPEEDO_MIN_GAUGE_WIDE, SPEEDO_MAX_GAUGE_WIDE
} from './layoutSizing.js';

describe('columnTemplateFor', () => {
  it('weights a focus panel wider than standard ones', () => {
    expect(columnTemplateFor(['focus', 'standard'])).toBe('2fr 1fr');
  });
  it('gives equal columns to all-standard zones', () => {
    expect(columnTemplateFor(['standard', 'standard', 'standard'])).toBe('1fr 1fr 1fr');
  });
  it('falls back to a single full column when empty', () => {
    expect(columnTemplateFor([])).toBe('1fr');
  });
  it('treats unknown hints as standard weight', () => {
    expect(columnTemplateFor(['mystery', 'focus'])).toBe('1fr 2fr');
  });
});

describe('fitScale', () => {
  it('returns 1 when content already fits', () => {
    expect(fitScale({ width: 100, height: 80 }, { width: 200, height: 200 })).toBe(1);
  });
  it('returns the limiting ratio (<1) when content overflows', () => {
    expect(fitScale({ width: 400, height: 100 }, { width: 200, height: 200 })).toBe(0.5);
  });
  it('returns 1 for any non-positive dimension (nothing to scale)', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 200, height: 200 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe('gaugeRowSize', () => {
  it('fits N gauges across the zone width (minus gaps), capped by height', () => {
    // width path: (900 - 28*2)/3 ≈ 281 → clamped to 280; height 400-50=350 → min(280,350)=280
    expect(gaugeRowSize({ zoneW: 900, zoneH: 400, count: 3, gap: 28 })).toBe(280);
  });
  it('is limited by height when the band is short', () => {
    // height path: 180-68 (honest chrome budget, audit UX §3.3) = 112; width path large → min = 112
    expect(gaugeRowSize({ zoneW: 1200, zoneH: 180, count: 2, gap: 28 })).toBe(112);
  });
  it('clamps to the floor for a tiny zone', () => {
    expect(gaugeRowSize({ zoneW: 50, zoneH: 50, count: 6, gap: 28 })).toBe(96);
  });
  it('defaults to the floor for an unmeasured (zero) box', () => {
    expect(gaugeRowSize({ zoneW: 0, zoneH: 0, count: 1 })).toBe(96);
  });
});

// audit UX §3.3 — the old `zoneH - 50` budget under-counted the real ~56-66px of
// chrome below the dial (odometer pill + gap), so a rider band could compute a
// gauge whose reserved footprint (gauge + chrome) EXCEEDED the grid row that
// RaceLayoutManager.scss actually reserves for it — the band then bled into the
// chart zone above (masked by `overflow: visible`, since fixed to `hidden`).
// This asserts the fix holds for the two live layout modes across their whole
// realistic zone-height + rider-count space, using the exact min/max gauge
// constants CycleRaceScreen.jsx feeds into SpeedoRow.
describe('gaugeRowSize — band-height invariant (audit UX §3.3)', () => {
  const ZONE_WIDTH = 1400; // generous — keeps the height path binding, not width
  const ZONE_HEIGHTS = [200, 260, 300, 400, 500];

  it('sidebar mode (≤3 riders): gauge + chrome never exceeds the band (floor: minmax(260px, …))', () => {
    for (const zoneH of ZONE_HEIGHTS.filter((h) => h >= 260)) {
      for (let count = 1; count <= 3; count++) {
        const gauge = gaugeRowSize({
          zoneW: ZONE_WIDTH, zoneH, count, gap: 28,
          min: SPEEDO_MIN_GAUGE_SIDEBAR, max: SPEEDO_MAX_GAUGE_SIDEBAR
        });
        expect(gauge + CHROME_BELOW_GAUGE_PX).toBeLessThanOrEqual(zoneH);
      }
    }
  });

  it('wide mode (≥4 riders, up to 6): gauge + chrome never exceeds the band (floor: minmax(200px, …))', () => {
    for (const zoneH of ZONE_HEIGHTS) {
      for (let count = 4; count <= 6; count++) {
        const gauge = gaugeRowSize({
          zoneW: ZONE_WIDTH, zoneH, count, gap: 28,
          min: SPEEDO_MIN_GAUGE_WIDE, max: SPEEDO_MAX_GAUGE_WIDE
        });
        expect(gauge + CHROME_BELOW_GAUGE_PX).toBeLessThanOrEqual(zoneH);
      }
    }
  });
});
