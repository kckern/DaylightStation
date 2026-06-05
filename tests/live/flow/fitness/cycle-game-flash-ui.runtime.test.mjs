/**
 * Cycle Game Race (Flash) — UI verification.
 * Drives the sim panel's "Cycle Game Race / Flash" preset path (autoAssignRiders(2)
 * → window.__cycleGameControl.startRace({winCondition:'time', value:60})) at kiosk
 * resolution, confirms the race completes, and captures screenshots across the
 * lifecycle for visual review (avatar aspect, content cutoff, wrapping, spacing).
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import fs from 'node:fs';

const SHOT_DIR = '/opt/Code/DaylightStation/tmp/cycle-flash-shots';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null,
    { timeout: 30000 }
  );
}

test.describe('Cycle Game Race (Flash) — UI verification', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 }); // kiosk target, 2x detail
  test.setTimeout(180000);

  test('Flash time race completes; capture race-screen + results screenshots', async ({ page }) => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    // Boot the fitness app + sim controller.
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(
      () => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0),
      null,
      { timeout: 15000 }
    );

    // Launch the cycle game module (full-page nav → controller re-exposed).
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    // Faithful to the sim panel's Flash preset: auto-assign 2 riders to 2 bikes.
    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    expect(assigns.length).toBeGreaterThanOrEqual(1);
    const bikeIds = assigns.map((a) => a.equipmentId);

    // Start the Flash race via the bridge (time race, 60 s cap). Bikes stay at 0
    // through staging+countdown (no cadence sent) → no false start.
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });
    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 }));

    // Race screen appears post-countdown (= racing).
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 30000 });

    let shotIdx = 0;
    const shots = [];
    const snap = async (label) => {
      const p = `${SHOT_DIR}/${String(shotIdx++).padStart(2, '0')}-${label}.png`;
      await page.screenshot({ path: p });
      shots.push(p);
    };

    await page.waitForTimeout(1500);
    await snap('race-early');

    // REMOUNT CHECK: tag the live DOM nodes; if the panels remount each tick they
    // are replaced and the tag/markers vanish (and the avatar <img> reloads).
    await page.evaluate(() => {
      const img = document.querySelector('.cycle-speedometer__avatar img');
      const head = document.querySelector('.cg-pistons__head');
      if (img) { img.dataset.persist = 'tagged'; window.__avatarSrc0 = img.getAttribute('src'); }
      if (head) head.dataset.persist = 'tagged';
    });

    let remount = null;
    // Drive the assigned bikes until results render; snapshot mid + late.
    for (let i = 0; i < 80; i++) {
      for (const id of bikeIds) await setRpm(page, id, id === bikeIds[0] ? 95 : 100);
      if (await page.getByTestId('race-results').isVisible().catch(() => false)) break;
      if (i === 12) await snap('race-mid');
      if (i === 18) {
        // ~17 ticks after tagging — still racing. Did the tagged nodes survive?
        remount = await page.evaluate(() => {
          const img = document.querySelector('.cycle-speedometer__avatar img');
          const head = document.querySelector('.cg-pistons__head');
          return {
            avatarPersisted: img?.dataset.persist === 'tagged',   // false ⇒ remounted
            avatarSrcStable: img ? img.getAttribute('src') === window.__avatarSrc0 : null,
            pistonHeadPersisted: head ? head.dataset.persist === 'tagged' : null
          };
        });
      }
      if (i === 30) await snap('race-late');
      await page.waitForTimeout(1000);
    }

    // (1) Race completes.
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(1200);
    await snap('results');

    // (2) Automatable UI checks: avatar aspect ratios + clipped content.
    const ui = await page.evaluate(() => {
      const out = { avatars: [], clipped: [] };
      const seen = new Set();
      document.querySelectorAll(
        '.cycle-speedometer__avatar img, .circular-user-avatar img, [class*="avatar"] img, [class*="avatar"] image'
      ).forEach((img) => {
        const r = img.getBoundingClientRect();
        if (r.width > 6 && r.height > 6) {
          out.avatars.push({
            w: Math.round(r.width), h: Math.round(r.height),
            ratio: +(r.width / r.height).toFixed(3),
            wrap: (img.parentElement?.className || '').toString().slice(0, 50)
          });
        }
      });
      // Elements that hide overflow but whose content exceeds the box (real cutoff).
      document.querySelectorAll('.cycle-race-screen [class*="cg-"], .cycle-race-screen [class*="cycle-race"]').forEach((el) => {
        const cs = getComputedStyle(el);
        const hidesX = cs.overflowX === 'hidden' || cs.overflow === 'hidden';
        const hidesY = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
        const clipX = hidesX && el.scrollWidth > el.clientWidth + 3;
        const clipY = hidesY && el.scrollHeight > el.clientHeight + 3;
        const key = (el.className || '').toString();
        if ((clipX || clipY) && !seen.has(key)) {
          seen.add(key);
          out.clipped.push({ cls: key.slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
        }
      });
      return out;
    });

    const badAvatars = ui.avatars.filter((a) => a.ratio < 0.92 || a.ratio > 1.08);
    // eslint-disable-next-line no-console
    console.log('FLASH_UI_REPORT', JSON.stringify({
      shots, avatarCount: ui.avatars.length, badAvatars, clipped: ui.clipped, remount
    }, null, 2));

    // Hard assert the panels do NOT remount per tick (the bug behind avatar
    // trashing + abrupt motion). The tagged nodes must survive ~17 ticks.
    expect(remount, 'remount check ran').not.toBeNull();
    expect(remount.avatarPersisted, 'speedometer avatar <img> not remounted').toBe(true);
    expect(remount.avatarSrcStable, 'avatar src stable (no reload)').toBe(true);
    // Pistons can be swapped out by the director mid-race; only assert when present.
    if (remount.pistonHeadPersisted !== null) {
      expect(remount.pistonHeadPersisted, 'piston head not remounted').toBe(true);
    }
    expect(assigns.length, 'at least one bike auto-assigned').toBeGreaterThanOrEqual(1);
  });
});
