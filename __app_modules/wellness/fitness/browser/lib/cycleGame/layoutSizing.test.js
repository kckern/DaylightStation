import { describe, it, expect } from 'vitest';
import {
  columnTemplateFor, fitScale, gaugeRowSize, raceLayoutMode, CHROME_BELOW_GAUGE_PX,
  ODOMETER_CHROME_PX, BOOST_ROW_PX, SPEEDO_STACK_GAP_PX,
  SPEEDO_MIN_GAUGE_SIDEBAR, SPEEDO_MAX_GAUGE_SIDEBAR, SPEEDO_MIN_GAUGE_WIDE, SPEEDO_MAX_GAUGE_WIDE
} from "./layoutSizing.js";

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
    // height path: 230-118 (odometer + boost row, the honest chrome budget) = 112; width path large → min = 112
    expect(gaugeRowSize({ zoneW: 1200, zoneH: 230, count: 2, gap: 28 })).toBe(112);
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

  it('wide mode (≥4 riders, up to 6): gauge + chrome never exceeds the band (floor: minmax(350px, …))', () => {
    for (const zoneH of [350, 400, 500]) {
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

// The boost meter sits under every gauge (above the odometer), so the chrome
// below the dial is the odometer pill, the boost row and the gap between them.
describe('CHROME_BELOW_GAUGE_PX budget', () => {
  it('covers the odometer pill, the boost row and the gap between them', () => {
    expect(BOOST_ROW_PX).toBe(40); // CycleSpeedometer.scss .cycle-speedometer__boost height
    expect(CHROME_BELOW_GAUGE_PX).toBe(ODOMETER_CHROME_PX + BOOST_ROW_PX + SPEEDO_STACK_GAP_PX);
  });
  it('solo band (floor minmax(260px, …), one gauge in a 2fr column): gauge + chrome fits', () => {
    for (const zoneH of [260, 300, 400, 500]) {
      for (const zoneW of [200, 300, 540]) {
        const gauge = gaugeRowSize({
          zoneW, zoneH, count: 1, gap: 28, min: SPEEDO_MIN_GAUGE_SIDEBAR, max: SPEEDO_MAX_GAUGE_SIDEBAR
        });
        expect(gauge + CHROME_BELOW_GAUGE_PX).toBeLessThanOrEqual(zoneH);
      }
    }
  });
});

describe('raceLayoutMode', () => {
  it.each([
    [{ liveCount: 1, fieldSize: 1 }, 'solo'], [{ liveCount: 1, fieldSize: 2 }, 'solo'],
    [{ liveCount: 1, fieldSize: 3 }, 'sidebar'], [{ liveCount: 2, fieldSize: 2 }, 'sidebar'],
    [{ liveCount: 2, fieldSize: 4 }, 'wide'], [{ liveCount: 0, fieldSize: 2 }, 'sidebar']
  ])('raceLayoutMode(%o) → %s', (input, mode) => expect(raceLayoutMode(input)).toBe(mode));

  it('missing input is zero riders: sidebar', () => {
    expect(raceLayoutMode()).toBe('sidebar');
    expect(raceLayoutMode({})).toBe('sidebar');
  });
  it('negative or NaN counts are treated as 0', () => {
    expect(raceLayoutMode({ liveCount: -1, fieldSize: -5 })).toBe('sidebar');
    expect(raceLayoutMode({ liveCount: NaN, fieldSize: NaN })).toBe('sidebar');
    expect(raceLayoutMode({ liveCount: NaN, fieldSize: 4 })).toBe('wide');
    expect(raceLayoutMode({ liveCount: 1, fieldSize: NaN })).toBe('solo');
    expect(raceLayoutMode({ liveCount: 1, fieldSize: -2 })).toBe('solo');
    expect(raceLayoutMode({ liveCount: undefined, fieldSize: undefined })).toBe('sidebar');
  });
});

// Five and six riders: the speedo band spans the full width in wide mode, so the
// gauges stay readable from the bike (they were ~175 px when the band shared the
// main column with the road). Zone boxes are what RaceLayoutManager measures for
// the band at the two garage sizes: width minus the zone's 8 px side padding,
// height = max(350, 38% of the layout) minus the 6 + 10 px zone padding.
describe('wide mode gauges with five and six riders', () => {
  const BOXES = {
    '1810x1040': { zoneW: 1810 - 16, zoneH: Math.max(350, Math.round((1040 - 8) * 0.38)) - 16 },
    '1920x1080': { zoneW: 1920 - 16, zoneH: Math.max(350, Math.round((1080 - 8) * 0.38)) - 16 }
  };
  for (const [name, box] of Object.entries(BOXES)) {
    for (const count of [5, 6]) {
      it(`${count} riders at ${name} get at least 220 px`, () => {
        const gauge = gaugeRowSize({ ...box, count, gap: 28, min: SPEEDO_MIN_GAUGE_WIDE, max: SPEEDO_MAX_GAUGE_WIDE });
        expect(gauge).toBeGreaterThanOrEqual(220);
        expect(gauge + CHROME_BELOW_GAUGE_PX).toBeLessThanOrEqual(box.zoneH + 16);
      });
    }
  }
  it('the wide floor is itself at least 220 px', () => {
    expect(SPEEDO_MIN_GAUGE_WIDE).toBeGreaterThanOrEqual(220);
  });
});
