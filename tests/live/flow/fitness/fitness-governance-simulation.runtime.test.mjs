/**
 * Fitness Governance Simulation Tests
 *
 * Exit criteria test suite - all 11 tests must pass.
 * Tests the FitnessSimulationController governance features.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let sim;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  // FAIL FAST: Verify fitness API is accessible before running tests
  console.log('Verifying fitness API health...');
  try {
    const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`Fitness API returned ${response.status}: ${response.statusText}`);
    }
    const config = await response.json();
    const users = config?.fitness?.users?.primary || config?.users?.primary || [];
    console.log(`Fitness API healthy: ${users.length} primary users with HR devices`);
  } catch (err) {
    throw new Error(`FAIL FAST: Fitness API not responding. Cannot run governance tests.\nError: ${err.message}\nURL: ${API_URL}/api/v1/fitness`);
  }

  sharedContext = await browser.newContext();
  sharedPage = await sharedContext.newPage();

  // Navigate to fitness app
  await sharedPage.goto(`${BASE_URL}/fitness`);
  await sharedPage.waitForTimeout(3000);

  sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  console.log('Governance simulation test suite initialized');
});

test.afterAll(async () => {
  // Cleanup
  if (sim) {
    await sim.disableGovernance().catch(() => {});
    await sim.stopAll().catch(() => {});
  }
  await sharedContext?.close();
});

test.afterEach(async () => {
  // Reset state between tests
  await sim.disableGovernance().catch(() => {});
  await sim.stopAll().catch(() => {});
  await sim.resetStats().catch(() => {});
  await sharedPage.waitForTimeout(500);
});

// ═══════════════════════════════════════════════════════════════
// TEST 1: Challenge Win - All Participants Reach Target
// ═══════════════════════════════════════════════════════════════
test('challenge win - all participants reach target', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  expect(devices.length).toBeGreaterThanOrEqual(2);
  const [device1, device2] = devices;

  // Before challenge
  const stateBefore = await sim.getGovernanceState();
  expect(stateBefore.activeChallenge).toBeNull();

  // Trigger challenge
  await sim.triggerChallenge({ targetZone: 'hot', duration: 30 });

  let activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.targetZone).toBe('hot');
  expect(activeChal.participantProgress[device1.deviceId]).toBe(false);

  // Move devices to target
  await sim.setZone(device1.deviceId, 'hot');
  await sharedPage.waitForTimeout(100);

  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);

  await sim.setZone(device2.deviceId, 'hot');
  await sharedPage.waitForTimeout(100);

  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device2.deviceId]).toBe(true);

  // Complete challenge
  await sim.completeChallenge(true);

  const stateAfter = await sim.getGovernanceState();
  expect(stateAfter.activeChallenge).toBeNull();
  expect(stateAfter.stats.challengesWon).toBe(1);
  expect(stateAfter.stats.challengesFailed).toBe(0);
});

// ═══════════════════════════════════════════════════════════════
// TEST 2: Challenge Fail - Timeout Expires
// ═══════════════════════════════════════════════════════════════
test('challenge fail - timeout expires', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  const [device1, device2] = devices;

  // Trigger short challenge with hard target
  await sim.triggerChallenge({ targetZone: 'fire', duration: 2 });

  // Move to warm only (not target)
  await sim.setZone(device1.deviceId, 'warm');
  // Leave device2 in active

  let activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(false);
  expect(activeChal.participantProgress[device2.deviceId]).toBe(false);

  // Wait for timeout
  await sharedPage.waitForTimeout(3000);

  const stateAfter = await sim.getGovernanceState();
  expect(stateAfter.activeChallenge).toBeNull();
  expect(stateAfter.stats.challengesWon).toBe(0);
  expect(stateAfter.stats.challengesFailed).toBe(1);
});

// ═══════════════════════════════════════════════════════════════
// TEST 3: Multi-Hurdle Sequential Challenges
// ═══════════════════════════════════════════════════════════════
test('multi-hurdle sequential challenges', async () => {
  await sim.enableGovernance({ challenges: { interval: 1 } });
  await sim.activateAll('cool');

  const devices = await sim.getDevices();

  // Hurdle 1: cool → active
  await sim.triggerChallenge({ targetZone: 'active' });
  for (const d of devices) await sim.setZone(d.deviceId, 'active');
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);

  // Hurdle 2: active → warm
  await sim.triggerChallenge({ targetZone: 'warm' });
  for (const d of devices) await sim.setZone(d.deviceId, 'warm');
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(2);

  // Hurdle 3: warm → hot
  await sim.triggerChallenge({ targetZone: 'hot' });
  for (const d of devices) await sim.setZone(d.deviceId, 'hot');
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(3);

  // Hurdle 4: fail (don't move to fire)
  await sim.triggerChallenge({ targetZone: 'fire', duration: 1 });
  await sharedPage.waitForTimeout(1500);

  const finalState = await sim.getGovernanceState();
  expect(finalState.stats.challengesWon).toBe(3);
  expect(finalState.stats.challengesFailed).toBe(1);

  // Devices should be at hot (last successful zone)
  const finalDevices = await sim.getDevices();
  expect(finalDevices[0].currentZone).toBe('hot');
});

// ═══════════════════════════════════════════════════════════════
// TEST 4: Partial Completion - Mixed Results
// ═══════════════════════════════════════════════════════════════
test('partial completion - mixed results', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  expect(devices.length).toBeGreaterThanOrEqual(3);
  const [device1, device2, device3] = devices;

  await sim.triggerChallenge({ targetZone: 'hot', duration: 10 });

  // Move 2 of 3 to target
  await sim.setZone(device1.deviceId, 'hot');
  await sim.setZone(device2.deviceId, 'hot');
  // Leave device3 in active

  await sharedPage.waitForTimeout(100);

  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
  expect(activeChal.participantProgress[device2.deviceId]).toBe(true);
  expect(activeChal.participantProgress[device3.deviceId]).toBe(false);

  const reachedTarget = Object.values(activeChal.participantProgress).filter(Boolean).length;
  expect(reachedTarget).toBe(2);

  const totalParticipants = Object.keys(activeChal.participantProgress).length;
  expect(totalParticipants).toBeGreaterThanOrEqual(3);

  await sim.completeChallenge(false); // Cleanup
});

// ═══════════════════════════════════════════════════════════════
// TEST 5: Participant Dropout Mid-Challenge
// ═══════════════════════════════════════════════════════════════
test('participant dropout mid-challenge', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  const initialActiveCount = (await sim.getActiveDevices()).length;
  const [device1, device2] = devices;

  await sim.triggerChallenge({ targetZone: 'hot', duration: 15 });

  // Device 1 reaches target
  await sim.setZone(device1.deviceId, 'hot');

  // Device 2 drops out
  await sim.stopDevice(device2.deviceId);

  await sharedPage.waitForTimeout(100);

  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);

  // Verify dropout - one fewer active device than initial
  const activeDevices = await sim.getActiveDevices();
  expect(activeDevices.length).toBe(initialActiveCount - 1);
  expect(activeDevices.find(d => d.deviceId === device2.deviceId)).toBeUndefined();

  // Challenge can still complete
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).activeChallenge).toBeNull();
});

// ═══════════════════════════════════════════════════════════════
// TEST 6: Zone Overshoot - Fire When Target Is Hot
// ═══════════════════════════════════════════════════════════════
test('zone overshoot - fire counts for hot target', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  const device = devices[0];

  await sim.triggerChallenge({ targetZone: 'hot', duration: 10 });

  // Overshoot to fire
  await sim.setZone(device.deviceId, 'fire');
  await sharedPage.waitForTimeout(100);

  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(true);

  // Verify actually in fire
  const updatedDevices = await sim.getDevices();
  expect(updatedDevices[0].currentZone).toBe('fire');
  expect(updatedDevices[0].currentHR).toBeGreaterThanOrEqual(160);

  await sim.completeChallenge(true);
});

// ═══════════════════════════════════════════════════════════════
// TEST 7: Zone Oscillation Around Boundary (Sticky Progress)
// ═══════════════════════════════════════════════════════════════
test('zone oscillation - once reached stays reached', async () => {
  await sim.enableGovernance();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Start at boundary (warm zone, just below hot)
  await sim.setHR(device.deviceId, 138);
  await sharedPage.waitForTimeout(100);

  await sim.triggerChallenge({ targetZone: 'hot', duration: 15 });

  // At 139 - still warm
  await sim.setHR(device.deviceId, 139);
  await sharedPage.waitForTimeout(100);
  let state = await sim.getDevices();
  expect(state[0].currentZone).toBe('warm');
  let activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(false);

  // At 141 - now hot
  await sim.setHR(device.deviceId, 141);
  await sharedPage.waitForTimeout(100);
  state = await sim.getDevices();
  expect(state[0].currentZone).toBe('hot');
  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(true);

  // Back to 138 - warm but still counts as reached (sticky)
  await sim.setHR(device.deviceId, 138);
  await sharedPage.waitForTimeout(100);
  state = await sim.getDevices();
  expect(state[0].currentZone).toBe('warm');
  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(true); // Still true!

  await sim.completeChallenge(true);
});

// ═══════════════════════════════════════════════════════════════
// TEST 8: Challenge During Phase Transitions
// ═══════════════════════════════════════════════════════════════
test('challenge during phase transitions', async () => {
  await sim.enableGovernance({
    phases: { warmup: 2, main: 30, cooldown: 2 }
  });
  await sim.activateAll('active');

  // Initial phase should be warmup
  const initialState = await sim.getGovernanceState();
  expect(initialState.phase).toBe('warmup');

  // Wait for transition to main
  await sharedPage.waitForTimeout(2500);

  const stateAfterWait = await sim.getGovernanceState();
  expect(stateAfterWait.phase).toBe('main');

  // Trigger challenge during main
  await sim.triggerChallenge({ targetZone: 'hot' });
  const stateWithChallenge = await sim.getGovernanceState();
  expect(stateWithChallenge.activeChallenge).not.toBeNull();
  expect(stateWithChallenge.phase).toBe('main');

  await sim.completeChallenge(true);
});

// ═══════════════════════════════════════════════════════════════
// TEST 9: Governance Override On/Off
// ═══════════════════════════════════════════════════════════════
test('governance override on/off', async () => {
  await sim.activateAll('active');

  // Initially no governance
  const initialState = await sim.getGovernanceState();
  expect(initialState.phase).toBeUndefined();

  // Enable
  await sim.enableGovernance();
  const enabledState = await sim.getGovernanceState();
  expect(enabledState.phase).toBe('warmup');

  // Trigger and complete a challenge
  await sim.triggerChallenge({ targetZone: 'active' });
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);

  // Disable
  await sim.disableGovernance();
  const disabledState = await sim.getGovernanceState();
  expect(disabledState.phase).toBeUndefined();

  // Trigger should fail when disabled
  const failedTrigger = await sim.triggerChallenge({ targetZone: 'hot' });
  expect(failedTrigger.ok).toBe(false);
  expect(failedTrigger.error).toContain('overnance');
});

// ═══════════════════════════════════════════════════════════════
// TEST 10: Rapid Challenge Succession
// ═══════════════════════════════════════════════════════════════
test('rapid challenge succession', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  // Challenge 1 - win
  await sim.triggerChallenge({ targetZone: 'active' });
  await sim.completeChallenge(true);
  const stateAfter1 = await sim.getGovernanceState();
  expect(stateAfter1.activeChallenge).toBeNull();

  // Challenge 2 - win
  await sim.triggerChallenge({ targetZone: 'active' });
  await sim.completeChallenge(true);
  const stateAfter2 = await sim.getGovernanceState();
  expect(stateAfter2.activeChallenge).toBeNull();

  // Challenge 3 - fail
  await sim.triggerChallenge({ targetZone: 'fire' });
  await sim.completeChallenge(false);
  const stateAfter3 = await sim.getGovernanceState();
  expect(stateAfter3.activeChallenge).toBeNull();

  // Verify stats
  expect(stateAfter3.stats.challengesWon).toBe(2);
  expect(stateAfter3.stats.challengesFailed).toBe(1);

  const total = stateAfter3.stats.challengesWon + stateAfter3.stats.challengesFailed;
  expect(total).toBe(3);
});

// ═══════════════════════════════════════════════════════════════
// TEST 11: Already In Target Zone When Challenge Starts
// ═══════════════════════════════════════════════════════════════
test('already in target zone when challenge starts', async () => {
  await sim.enableGovernance();

  const devices = await sim.getDevices();
  const [device1, device2] = devices;

  // Pre-position in hot
  await sim.setZone(device1.deviceId, 'hot');
  await sim.setZone(device2.deviceId, 'hot');
  await sharedPage.waitForTimeout(100);

  // Trigger challenge for zone they're already in
  await sim.triggerChallenge({ targetZone: 'hot' });

  // Should immediately show as reached
  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
  expect(activeChal.participantProgress[device2.deviceId]).toBe(true);

  // Can complete immediately
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);
});
