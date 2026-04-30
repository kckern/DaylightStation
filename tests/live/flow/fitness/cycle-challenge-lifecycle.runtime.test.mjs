/**
 * Cycle Challenge Lifecycle — Runtime Test
 *
 * Exit criterion for cycling-challenge simulator audit
 * (docs/_wip/audits/2026-04-30-cycling-challenge-simulator-unusable-audit.md).
 *
 * Walks the full lifecycle:
 *   1. App boots, fitness config loads, equipment catalog includes cycle_ace.
 *   2. Sim controller exposes cycle_ace with eligible riders.
 *   3. HR sliders activate two participants in the active zone.
 *   4. Trigger cycle challenge -> success.
 *   5. Drive RPM through init -> ramp -> maintain.
 *   6. Drop RPM below loRpm -> locked.
 *   7. Recover -> unlock back to maintain.
 *   8. Walk all phases through to status: success.
 *   9. window.__fitnessGovernance is clean afterwards.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import {
  setRpm,
  triggerCycleChallenge,
  readCycleState,
  waitForCycleState,
  getEquipment,
  listCycleSelections
} from '#testlib/FitnessSimHelper.mjs';

const CYCLE_EQUIPMENT_ID = 'cycle_ace';
// Selection id is generated from policy structure — discovered at runtime.

test.describe('Cycle challenge full lifecycle', () => {
  // 5 minutes: setup (~30s) + warmup-to-unlocked (~120s)
  // + phases (3-4 × 20-40s = 60-160s) + buffer.
  test.setTimeout(300000);

  test('boots, opens cycling video, triggers, walks state machine, completes successfully', async ({ page }) => {
    // ---- 1. Boot the fitness app ----
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    // Wait for fitness config to load and equipment catalog to be applied to the session.
    // The catalog is populated asynchronously after the config API returns.
    await page.waitForFunction(
      () => {
        const ctl = window.__fitnessSimController;
        if (!ctl) return false;
        const eq = ctl.getEquipment?.();
        return Array.isArray(eq) && eq.length > 0;
      },
      null,
      { timeout: 15000 }
    );

    // ---- 2. Catalog populated, cycle_ace present ----
    const equipment = await getEquipment(page);
    const cycleAce = equipment.find(e => e.equipmentId === CYCLE_EQUIPMENT_ID);
    expect(cycleAce, 'cycle_ace should appear in simulator equipment list').toBeTruthy();
    expect(cycleAce.cadenceDeviceId).toBe('49904');
    expect(cycleAce.eligibleUsers.length).toBeGreaterThan(0);

    // ---- 3. Cycle selection visible in policy set ----
    const selections = await listCycleSelections(page);
    const cycleSel = selections.find(s => s.equipment === CYCLE_EQUIPMENT_ID);
    expect(cycleSel, 'at least one cycle selection should target cycle_ace').toBeTruthy();
    const selectionId = cycleSel.id;
    const riderId = cycleAce.eligibleUsers[0];

    // ---- 4. Discover a cycling episode via the API and navigate to it ----
    // Discovery path:
    //   /api/v1/fitness → nav_items[icon=cycle] → collection_ids
    //   → /api/v1/list/plex/:collectionId → shows in cycling collection
    //   → cross-reference with /api/v1/fitness/governed-content (governed shows only)
    //   → /api/v1/fitness/show/:showId/playable → first episode (numeric ID)
    //
    // NOTE: /api/v1/content/collection/:id was the originally planned discovery
    // endpoint but does not exist in this backend — it has no registered route and
    // will hang indefinitely waiting for a Plex response. The correct path is
    // /api/v1/list/plex/:id (served by the list router) followed by
    // /api/v1/fitness/show/:id/playable to flatten to playable episodes.
    //
    // The cross-reference with governed-content is required because the cycling
    // collections contain both governed (KidsFun-labeled) and non-governed shows.
    // Only governed episodes engage the GovernanceEngine and set window.__fitnessGovernance.contentId.
    // Any governed cycling episode works for this test — the cycle selection lives in the
    // 'default' policy which applies to ALL governed content. We use a cycling-specific video
    // so the test exercises the same content-discovery path the user takes from the
    // Cycling nav item in the fitness app.
    //
    // NOTE: the ?nogovern query parameter is appended to the play URL below. The
    // governed cycling shows in these collections (e.g. Game Cycling) have the
    // 'sequential' Plex label, which causes FitnessApp to intercept /fitness/play/:id
    // and redirect to the show browse page instead of playing the episode directly.
    // ?nogovern bypasses that sequential redirect while leaving the GovernanceEngine
    // fully active — it only overrides the UI's videoLocked display state, not the
    // engine's phase evaluation or challenge firing logic. The cycle challenge test
    // therefore still exercises the full governance lifecycle.
    const cyclingEpisodeId = await page.evaluate(async () => {
      const cfg = await fetch('/api/v1/fitness').then(r => r.json());
      const navItems = cfg?.plex?.nav_items || cfg?.fitness?.plex?.nav_items || [];
      const cycleNav = navItems.find(n =>
        n?.icon === 'cycle' || /cycl/i.test(n?.name || '')
      );
      const collectionIds = cycleNav?.target?.collection_ids
        || (cycleNav?.target?.collection_id ? [cycleNav.target.collection_id] : []);
      if (!collectionIds.length) return null;

      // Fetch governed shows (KidsFun-labeled) to cross-reference.
      const governed = await fetch('/api/v1/fitness/governed-content')
        .then(r => r.json()).catch(() => []);
      const governedIds = new Set(
        (Array.isArray(governed) ? governed : governed?.items || [])
          .map(s => String(s?.id || '').replace(/^[a-z]+:/i, ''))
          .filter(Boolean)
      );

      // Walk cycling collections until we find a governed show with playable episodes.
      for (const collectionId of collectionIds) {
        const collectionItems = await fetch(`/api/v1/list/plex/${collectionId}`)
          .then(r => r.json()).catch(() => null);
        const shows = Array.isArray(collectionItems)
          ? collectionItems
          : (collectionItems?.items || []);

        for (const show of shows) {
          if (!show?.id) continue;
          const showNumericId = String(show.id).replace(/^[a-z]+:/i, '');
          // Skip non-governed shows — they won't engage the governance engine.
          if (!governedIds.has(showNumericId)) continue;

          const playable = await fetch(`/api/v1/fitness/show/${showNumericId}/playable`)
            .then(r => r.json()).catch(() => null);
          const episodes = Array.isArray(playable) ? playable : (playable?.items || []);
          const firstEp = episodes.find(e => e?.id);
          if (firstEp) {
            // Return the numeric ID only (strip "plex:" prefix).
            return String(firstEp.id).replace(/^[a-z]+:/i, '');
          }
        }
      }
      return null;
    });
    expect(cyclingEpisodeId, 'must discover at least one governed cycling episode via nav_items config').toBeTruthy();

    // Use ?nogovern to bypass the sequential-show redirect (see comment above).
    await page.goto(`${FRONTEND_URL}/fitness/play/${cyclingEpisodeId}?nogovern`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    // Wait for catalog to be available on the play page.
    await page.waitForFunction(
      () => {
        const ctl = window.__fitnessSimController;
        if (!ctl) return false;
        const eq = ctl.getEquipment?.();
        return Array.isArray(eq) && eq.length > 0;
      },
      null,
      { timeout: 15000 }
    );
    // Wait for the governance engine to register the media (contentId populated).
    // GovernanceEngine only evaluates cycle ticks when this.media is set.
    await page.waitForFunction(
      () => !!window.__fitnessGovernance?.contentId,
      null,
      { timeout: 30000 }
    );

    // ---- 5. Activate two participants via HR (simulate active users) ----
    // Use startAutoSession (not setHR) so the engine sees a sustained, evolving
    // HR pattern. setHR(130) alone keeps participants in active zone but doesn't
    // drive the warmup -> unlocked phase transition required for a cycle challenge
    // to fire. startAutoSession feeds continuous buffered readings that advance the
    // session through warmup and into the unlocked phase.
    // phaseOffset = 200s puts each simulated session into build phase where HR
    // is 110-145 bpm (above the 'active' zone threshold), satisfying the
    // base_requirement: [{active: 'all'}] governance policy check.
    await page.evaluate(() => {
      const ctl = window.__fitnessSimController;
      const devices = ctl.getDevices();
      // phaseOffset = 200s pushes into build phase where HR is 110-145 bpm (active zone)
      devices.slice(0, 2).forEach(d => ctl.startAutoSession(d.deviceId, { phaseOffset: 200 }));
    });
    // Wait for governance to reach 'unlocked' phase (requires session started + active participants).
    // Timeout: 15s. The session starts after 3 buffered HR readings (~6s at 2s interval).
    await page.waitForFunction(
      () => window.__fitnessGovernance?.phase === 'unlocked',
      null,
      { timeout: 15000 }
    );

    // ---- 6. Trigger cycle challenge ----
    const trigger = await triggerCycleChallenge(page, { selectionId, riderId });
    expect(trigger.success, `trigger should succeed; reason=${trigger.reason}`).toBe(true);

    // ---- 7. Verify init state on window globals ----
    let state = await readCycleState(page);
    expect(state, 'window.__fitnessGovernance should expose cycle state').toBeTruthy();
    expect(state.equipment).toBe(CYCLE_EQUIPMENT_ID);
    expect(state.riderId).toBe(riderId);
    expect(['init', 'ramp']).toContain(state.cycleState);

    // ---- 8. Drive RPM into ramp, then maintain ----
    // init -> reach min_rpm (30) to leave init
    await setRpm(page, CYCLE_EQUIPMENT_ID, 35);
    state = await waitForCycleState(page, ['ramp', 'maintain'], { timeoutMs: 15000 });
    expect(state.cycleState).toMatch(/ramp|maintain/);

    // ramp -> hit hi_rpm to enter maintain (hi_rpm_range: [50, 85])
    await setRpm(page, CYCLE_EQUIPMENT_ID, 90);
    state = await waitForCycleState(page, 'maintain', { timeoutMs: 15000 });
    expect(state.cycleState).toBe('maintain');
    expect(state.currentRpm).toBeGreaterThanOrEqual(85);

    // ---- 9. Drop RPM below loRpm -> locked ----
    await setRpm(page, CYCLE_EQUIPMENT_ID, 10); // well below loRpm
    state = await waitForCycleState(page, 'locked', { timeoutMs: 15000 });
    expect(state.cycleState).toBe('locked');

    // ---- 10. Recover -> unlock back to maintain ----
    await setRpm(page, CYCLE_EQUIPMENT_ID, 90);
    state = await waitForCycleState(page, ['ramp', 'maintain'], { timeoutMs: 15000 });
    expect(['ramp', 'maintain']).toContain(state.cycleState);

    // ---- 11. Walk phases through to success ----
    // Hold a high RPM and let phases tick. segment_count is [3,4],
    // segment_duration is [20,40] -- so worst case 4 phases × 40s = 160s.
    // We give 200s (generous margin) and REQUIRE the challenge to complete.
    const phaseDeadline = Date.now() + 200000;
    let lastIndex = -1;
    while (Date.now() < phaseDeadline) {
      await setRpm(page, CYCLE_EQUIPMENT_ID, 90);
      state = await readCycleState(page);
      if (!state) break; // challenge cleared (success = state nulled out)
      if (state.currentPhaseIndex !== lastIndex) {
        lastIndex = state.currentPhaseIndex;
        // eslint-disable-next-line no-console
        console.log(`[lifecycle] phase ${lastIndex + 1}/${state.totalPhases} state=${state.cycleState} rpm=${state.currentRpm}`);
      }
      await page.waitForTimeout(1000);
    }
    // Assert challenge DID complete (not just timed out in the loop).
    expect(state, 'cycle challenge must complete (state cleared) within 200s').toBeNull();

    // ---- 12. Assert final cleanup: cycle state cleared from globals ----
    const finalGov = await page.evaluate(() => ({
      activeChallengeType: window.__fitnessGovernance?.activeChallengeType,
      cycleState: window.__fitnessGovernance?.cycleState,
      currentRpm: window.__fitnessGovernance?.currentRpm
    }));
    expect(finalGov.activeChallengeType, 'cycle challenge should be cleared after lifecycle').toBeNull();
    expect(finalGov.cycleState).toBeNull();
  });

  test('trigger fails with informative reason when no riders are eligible', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    // Wait for catalog to load so triggerCycleChallenge can look up selections.
    await page.waitForFunction(
      () => {
        const ctl = window.__fitnessSimController;
        if (!ctl) return false;
        const eq = ctl.getEquipment?.();
        return Array.isArray(eq) && eq.length > 0;
      },
      null,
      { timeout: 15000 }
    );

    // selectionId is normalized as `${policyId}_${challengeIdx}_${selectionIdx}`
    // at engine init. Discover at runtime rather than hardcoding so a config
    // reorder doesn't silently break this test.
    // Then use a non-existent rider so the engine rejects with a specific reason
    // rather than the old catch-all 'failed_to_start'.
    const selections = await listCycleSelections(page);
    const cycleSel = selections.find(s => s.equipment === 'cycle_ace');
    // Use the discovered selection id (or a nonexistent one if no cycle selection found).
    const selectionId = cycleSel?.id || 'nonexistent_selection';

    const result = await triggerCycleChallenge(page, {
      selectionId,
      riderId: '__nonexistent__'
    });
    expect(result.success).toBe(false);
    expect(result.reason).not.toBe('failed_to_start');
    expect(['rider_not_eligible', 'no_eligible_riders', 'selection_not_found']).toContain(result.reason);
  });
});
