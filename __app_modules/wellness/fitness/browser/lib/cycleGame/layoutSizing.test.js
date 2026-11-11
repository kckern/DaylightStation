import { describe, it, expect } from 'vitest';
import {
  columnTemplateFor, fitScale, gaugeRowSize, raceLayoutMode, CHROME_BELOW_GAUGE_PX,
  ODOMETER_CHROME_PX, BOOST_ROW_PX, SPEEDO_STACK_GAP_PX,
  SPEEDO_MIN_GAUGE_SIDEBAR, SPEEDO_MAX_GAUGE_SIDEBAR, SPEEDO_MIN_GAUGE_WIDE, SPEEDO_MAX_GAUGE_WIDE,
  wideGaugeSize, SPEEDO_ZONE_PAD_X, SPEEDO_ZONE_PAD_Y
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

  it('wide mode (≥4 riders, up to 6): gauge + chrome never exceeds the band', () => {
    for (const zoneH of [268, 350, 400, 500]) {
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

// Wide mode sizes each gauge from the band WIDTH / rider count (wideGaugeSize,
// mirrored in RaceLayoutManager.scss with container units) and the band's height
// follows. 2026-11-10: a fixed 220 px floor put six gauges past both edges of the
// garage kiosk, whose content box is 1301x745 CSS px (1381x777 at DPR 1.39).
describe('wide mode gauges fit across the band', () => {
  const SIZES = { kiosk: { w: 1301, h: 745 }, '1920x1080': { w: 1920, h: 1080 } };
  for (const [name, { w, h }] of Object.entries(SIZES)) {
    for (const count of [4, 5, 6]) {
      it(`${count} riders at ${name}: every gauge fits across, the band leaves the top row most of the height`, () => {
        const gauge = wideGaugeSize({ width: w, count, gap: 28 });
        expect(count * gauge + 28 * (count - 1) + SPEEDO_ZONE_PAD_X).toBeLessThanOrEqual(w);
        const band = Math.min(gauge + CHROME_BELOW_GAUGE_PX + SPEEDO_ZONE_PAD_Y, h * 0.46);
        // What SpeedoRow then measures yields the same gauge (no height clamp below it).
        expect(gaugeRowSize({ zoneW: w - SPEEDO_ZONE_PAD_X, zoneH: band - SPEEDO_ZONE_PAD_Y, count, gap: 28,
          min: SPEEDO_MIN_GAUGE_WIDE, max: SPEEDO_MAX_GAUGE_WIDE })).toBeLessThanOrEqual(gauge);
        expect(h - band).toBeGreaterThanOrEqual(h * 0.54);
      });
    }
  }
  it('six riders on the kiosk get ~190 px gauges, above the 150 px floor', () => {
    expect(wideGaugeSize({ width: 1301, count: 6 })).toBe(190);
    expect(SPEEDO_MIN_GAUGE_WIDE).toBe(150);
  });
  it('the wide-mode CSS mirrors wideGaugeSize', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, '../../widgets/CycleGame/RaceLayoutManager.scss'), 'utf8');
    expect(css).toMatch(/clamp\(150px, calc\(\(100cqw - 16px - 28px \* \(var\(--cg-speedo-n, 4\) - 1\)\) \/ var\(--cg-speedo-n, 4\)\), 280px\)/);
    expect(css).toMatch(/calc\(var\(--cg-wide-gauge\) \+ 118px \+ 16px\)/);
    expect(css).toMatch(/\.race-layout-host \{\s*container-type: inline-size;/);
  });
});
