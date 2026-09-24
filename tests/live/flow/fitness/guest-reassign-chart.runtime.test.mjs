/**
 * Strap reassignment chain → the rendered chart stays sane.
 *
 * Drives the motivating 2026-09-23 shape through the real FitnessApp:
 * strap A's owner rides, strap A is corrected to a friend, then corrected back.
 * Asserts every per-person cumulative series (rings, beats) never decreases and
 * that strap A's stint ends up owned by the owner with the friend in its
 * relabel history. Screenshots after each step are for looking at, not only
 * asserting on.
 *
 * Isolation: the page's WebSocket is mocked (no real HR in, nothing out) and
 * every non-GET API request is aborted, so the run can point at a live backend
 * for config reads without writing a session or touching devices. HR packets
 * go straight into window.__fitnessSession.ingestData.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test('reassignment chain keeps every chart line monotonic', async ({ page }) => {
  test.setTimeout(240_000);
  await page.routeWebSocket(/.*/, () => { /* never connect */ });
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.method() !== 'GET' && /\/api\//.test(req.url())) return route.abort();
    return route.continue();
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${FRONTEND_URL}/fitness`);
  await page.waitForFunction(() => window.__fitnessSession && window.__fitnessAssignGuest, null, { timeout: 30_000 });

  const cfg = await page.evaluate(async () => (await fetch('/api/v1/fitness')).json());
  const users = cfg?.fitness?.users || cfg?.users;
  const owners = (users?.primary || []).filter((u) => Array.isArray(u.hr_device_ids) && u.hr_device_ids.length);
  const friend = (users?.friends || [])[0];
  if (owners.length < 2) throw new Error('FAIL FAST: need two primary users with HR straps');
  if (!friend) throw new Error('FAIL FAST: need a configured friend');
  const [ownerA, ownerB] = owners;
  const devA = String(ownerA.hr_device_ids[0]);
  const devB = String(ownerB.hr_device_ids[0]);

  // Feed both straps once per second, warm effort.
  await page.evaluate(([a, b]) => {
    window.__stintTestHr = setInterval(() => {
      for (const [dev, bpm] of [[a, 150], [b, 145]]) {
        window.__fitnessSession.ingestData({
          topic: 'fitness', type: 'ant', deviceId: dev, profile: 'HR',
          data: { ComputedHeartRate: bpm, timestamp: Date.now() },
        });
      }
    }, 1000);
  }, [devA, devB]);

  await page.waitForFunction(() => window.__fitnessSession?.sessionId, null, { timeout: 60_000 });
  // Show the live race chart (SPA navigation keeps the session).
  await page.waitForFunction(() => typeof window.__fitnessLaunchModule === 'function', null, { timeout: 15_000 });
  await page.evaluate(() => window.__fitnessLaunchModule('fitness_chart'));
  await page.waitForTimeout(40_000);
  await page.screenshot({ path: 'test-results/reassign-0-before.png' });

  const r1 = await page.evaluate(([d, f]) => window.__fitnessAssignGuest(d, { name: f.name, profileId: f.id }), [devA, friend]);
  expect(r1?.ok).toBe(true);
  await page.waitForTimeout(30_000);
  await page.screenshot({ path: 'test-results/reassign-1-corrected-to-friend.png' });

  const r2 = await page.evaluate(([d, o]) => window.__fitnessAssignGuest(d, { name: o.name, profileId: o.id }), [devA, ownerA]);
  expect(r2?.ok).toBe(true);
  await page.waitForTimeout(25_000);
  await page.screenshot({ path: 'test-results/reassign-2-back-to-owner.png' });

  const report = await page.evaluate(() => {
    clearInterval(window.__stintTestHr);
    const s = window.__fitnessSession.timeline.series;
    const bad = [];
    for (const [k, arr] of Object.entries(s)) {
      if (!/^user:.*:(rings_total|heart_beats)$/.test(k)) continue;
      let max = null;
      arr.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        if (max != null && v < max) bad.push({ k, i, v, max });
        else max = v;
      });
    }
    const stints = window.__fitnessSession.entityRegistry.getAll().map((e) => e.summary);
    const rings = Object.fromEntries([...window.__fitnessSession.treasureBox.perUser.entries()]
      .map(([id, acc]) => [id, acc.totalRings]));
    return { bad, stints, rings };
  });
  console.log(JSON.stringify(report, null, 1));
  expect(report.bad).toEqual([]);
  const stintA = report.stints.find((e) => e.deviceId === devA && e.status === 'active');
  expect(stintA.profileId).toBe(ownerA.id);
  expect(stintA.relabeledFrom).toEqual([ownerA.id, friend.id]);
  expect(report.rings[friend.id] || 0).toBe(0);
  expect(report.rings[ownerA.id]).toBeGreaterThan(0);
});
