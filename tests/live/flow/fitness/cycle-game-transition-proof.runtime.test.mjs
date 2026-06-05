/**
 * Cycle Game Race — PROOF that movement is CSS-transition-animated, not snapping.
 *
 * Greps prove text-in-a-file. This proves the LIVE DOM animates. The cleanest
 * always-moving signal is the piston track's panning grid: its background-position
 * is driven by the leader's ABSOLUTE distance (--cg-pan), which climbs every tick
 * whenever anyone pedals — no dependence on relative standings or on the director
 * swapping the camera panel in. It carries `transition: background-position 0.9s`.
 *
 * Each 1 Hz race tick bumps --cg-pan, so the target background-position jumps. If a
 * transition is attached, the RENDERED (getComputedStyle) value slides to the new
 * target over 0.9 s, so the great majority of ~60fps frames catch it mid-motion in
 * long smooth runs. If it snapped (the pre-fix remount behavior), the value would
 * jump in a single frame and hold — moving-frame ratio ≈ 0, longest smooth run ≈ 1.
 *
 * We ALSO assert the live piston head (`left 0.9s`) and bar (`width 0.9s`) carry
 * their transitions, proving the declarations are applied to the real nodes.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { launchCycleGame } from '#testlib/FitnessSimHelper.mjs';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}

// How much of the motion happens mid-transition (smooth) vs in single-frame snaps?
function analyze(series) {
  const v = series.filter((x) => x !== null && !Number.isNaN(x));
  if (v.length < 5) return null;
  let moving = 0, run = 0, maxRun = 0;
  const distinct = new Set();
  for (let i = 1; i < v.length; i++) {
    distinct.add(Math.round(v[i] * 10) / 10);
    if (Math.abs(v[i] - v[i - 1]) > 0.3) { moving++; run++; if (run > maxRun) maxRun = run; }
    else run = 0;
  }
  return {
    frames: v.length,
    movingRatio: +(moving / (v.length - 1)).toFixed(3),
    maxSmoothRun: maxRun,          // consecutive in-motion frames; a snap can't exceed ~1
    distinctValues: distinct.size, // a snap visits a handful of values; a transition, many
    totalTravel: +(Math.abs(v[v.length - 1] - v[0])).toFixed(1)
  };
}

test.describe('Cycle Game — transition animation proof', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  test.setTimeout(180000);

  test('the panning grid interpolates over its 0.9s transition (no snapping)', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(
      () => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 }
    );
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    const bikeIds = assigns.map((a) => a.equipmentId);
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });
    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 120 }));
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('race-pistons')).toBeVisible({ timeout: 15000 });

    const readPan = () => page.evaluate(() => {
      const p = document.querySelector('.cg-pistons');
      return p ? parseFloat(getComputedStyle(p).getPropertyValue('--cg-pan')) : null;
    });
    const setRpms = (rpm) => Promise.all(bikeIds.map((id) =>
      page.evaluate(({ id, rpm }) => window.__fitnessSimController.setRpm(id, rpm), { id, rpm })));

    // Let the gun pass with bikes at 0, then clear any false-start lockout by stopping
    // pedalling (the meter unlocks only when cadence drops to 0). THEN warm up until
    // distance actually advances — otherwise a locked meter would read as "no motion".
    await page.waitForTimeout(1600);
    await setRpms(0);
    await page.waitForTimeout(2200);
    let base = await readPan();
    for (let w = 0; w < 12 && (await readPan()) <= base + 1; w++) {
      await setRpms(100);
      await page.waitForTimeout(900);
    }
    expect((await readPan()) - base, 'distance advanced after clearing false-start (meter unlocked)').toBeGreaterThan(1);

    // Drive at 1 Hz (the proven flash pattern) and, after EACH tick, run a short
    // in-page rAF burst that records the rendered grid position while this tick's
    // distance bump slides over its 0.9 s transition. Sequential, so the Node-side
    // setRpm always lands (no CDP contention with a long-running evaluate).
    const out = { computed: {}, trackBgX: [], panVar: [] };
    for (let tick = 0; tick < 12; tick++) {
      for (const id of bikeIds) {
        await page.evaluate(({ id, rpm }) => window.__fitnessSimController.setRpm(id, rpm),
          { id, rpm: id === bikeIds[0] ? 92 : 104 });
      }
      const burst = await page.evaluate(() => new Promise((resolve) => {
        const parseBgX = (bg) => {
          const m = ((bg || '').split(',')[0].trim()).match(/(-?\d+(\.\d+)?)px/);
          return m ? parseFloat(m[1]) : null;
        };
        const xs = [], pans = [];
        let comp = null;
        const t0 = performance.now();
        function frame() {
          const track = document.querySelector('.cg-pistons__track');
          const head = document.querySelector('.cg-pistons__head');
          const bar = document.querySelector('.cg-pistons__bar');
          const pistons = document.querySelector('.cg-pistons');
          if (track && !comp) {
            const ct = getComputedStyle(track), ch = head && getComputedStyle(head), cb = bar && getComputedStyle(bar);
            comp = {
              track: { property: ct.transitionProperty, duration: ct.transitionDuration },
              head: ch && { property: ch.transitionProperty, duration: ch.transitionDuration },
              bar: cb && { property: cb.transitionProperty, duration: cb.transitionDuration }
            };
          }
          xs.push(track ? parseBgX(getComputedStyle(track).backgroundPosition) : null);
          pans.push(pistons ? parseFloat(getComputedStyle(pistons).getPropertyValue('--cg-pan')) : null);
          if (performance.now() - t0 < 880) requestAnimationFrame(frame);
          else resolve({ xs, pans, comp });
        }
        requestAnimationFrame(frame);
      }));
      if (burst.comp && !out.computed.track) out.computed = burst.comp;
      out.trackBgX.push(...burst.xs);
      out.panVar.push(...burst.pans);
    }

    const grid = analyze(out.trackBgX);
    const panStart = out.panVar.find((x) => x != null);
    const panEnd = [...out.panVar].reverse().find((x) => x != null);

    // eslint-disable-next-line no-console
    console.log('TRANSITION_PROOF', JSON.stringify({
      computed: out.computed,
      panVarMetres: { start: panStart, end: panEnd, advanced: +(panEnd - panStart).toFixed(0) },
      trackGrid: grid,
      note: 'movingRatio≈0.8+ and maxSmoothRun≫1 ⇒ interpolated; a snap gives ratio≈0 and run≈1'
    }, null, 2));

    // ── Proof assertions ──────────────────────────────────────────────────────
    // 1. The transitions are declared on the LIVE nodes (not merely present in a .scss).
    expect(out.computed.track?.duration, 'piston track grid has 0.9s transition on the live node').toBe('0.9s');
    expect(out.computed.track?.property, 'piston track grid transitions background-position').toContain('background-position');
    expect(out.computed.head?.duration, 'piston head has 0.9s transition on the live node').toBe('0.9s');
    expect(out.computed.head?.property, 'piston head transitions left').toContain('left');
    expect(out.computed.bar?.duration, 'piston bar has 0.9s transition on the live node').toBe('0.9s');
    expect(out.computed.bar?.property, 'piston bar transitions width').toContain('width');

    // 2. The grid actually PANS: the leader's distance advanced and the rendered
    //    background-position travelled a meaningful number of pixels.
    expect(panEnd - panStart, 'leader distance (--cg-pan) advanced during sampling').toBeGreaterThan(5);
    expect(grid, 'captured grid background-position motion').not.toBeNull();
    expect(grid.totalTravel, 'rendered grid background-position panned (px)').toBeGreaterThan(20);

    // 3. The pan is INTERPOLATED, not snapped: most frames are mid-motion and the
    //    longest smooth run is far longer than a single-frame jump.
    expect(grid.movingRatio, 'grid animates across most frames (not a per-tick snap)').toBeGreaterThan(0.5);
    expect(grid.maxSmoothRun, 'grid slides over many consecutive frames').toBeGreaterThan(10);
    expect(grid.distinctValues, 'grid visits many intermediate positions').toBeGreaterThan(20);
  });
});
