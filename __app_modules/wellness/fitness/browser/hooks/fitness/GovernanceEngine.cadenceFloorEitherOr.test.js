/**
 * `cadence_floor` — "pedal OR get active", judged on a rolling window.
 *
 * Two failures from the 2026-10-21 evening session, replayed from the garage
 * controller's real tricycle packets (`__fixtures__/tricycle-2026-10-21.json`,
 * [secondsSince 19:29:30 local, gated cadence, cumulative revolution count]):
 *
 * 1. A stopped rider nudged the pedal ONE revolution every 10-30s. Each nudge
 *    read ~15-45 RPM for a couple of seconds, which cleared the trip and reset
 *    the 30s grace — 4.5 minutes stopped, six warnings, never a lock.
 * 2. The rider got off and did jumping jacks at 141-151 bpm (Active zone). The
 *    floor only watched RPM, so it locked him anyway.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import tricycle from './__fixtures__/tricycle-2026-10-21.json';

const logged = vi.hoisted(() => []);
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const noop = () => {};
  const record = (event, data) => logged.push({ event, data });
  const logger = { child: () => logger, debug: noop, info: record, warn: noop, error: noop, sampled: noop };
  return { default: () => logger, getLogger: () => logger };
});

import { GovernanceEngine } from "./GovernanceEngine.js";

const RIDER = 'rider_a';
const ZONE_RANKS = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };

const policies = (overrides = {}) => ({
  default: {
    requirements: [{
      type: 'cadence_floor',
      id: 'trike_floor',
      equipment: 'tricycle',
      arm_seconds: 30,
      arm_min_rpm: 30,
      trip_after_seconds: 10,
      ...overrides,
    }],
  },
});

const setup = (overrides) => {
  const engine = new GovernanceEngine();
  engine._captureLatestInputs({ activeParticipants: [RIDER], zoneRankMap: ZONE_RANKS });
  const requirement = engine._normalizePolicies(policies(overrides))[0].requirements[0];
  return { engine, requirement };
};

const run = (engine, requirement, { rpm, revolutions, zone = 'cool', at, connected = true }) =>
  engine._evaluateCadenceFloorRequirement(requirement, {
    equipmentCadenceMap: {
      tricycle: {
        rpm,
        connected,
        ...(Number.isFinite(revolutions) ? { revolutions, deviceId: 'cad-1' } : {}),
      },
    },
    equipmentRiderMap: { tricycle: RIDER },
    activeParticipants: [RIDER],
    userZoneMap: { [RIDER]: zone },
    timestamp: at,
  });

/** Pedal at 60 RPM (one revolution per second) from t0 for `ms`. */
const ride = (engine, requirement, t0, ms, rev0 = 1000, zone = 'cool') => {
  let last = null;
  let rev = rev0;
  for (let t = t0; t <= t0 + ms; t += 1000) {
    last = run(engine, requirement, { rpm: 60, revolutions: rev, at: t, zone });
    rev += 1;
  }
  return { last, rev };
};

/** Replay fixture packets with t in [from, to], each at its real second. */
const replay = (engine, requirement, from, to, zoneAt = () => 'cool') => {
  const results = [];
  for (const [t, cad, rev] of tricycle) {
    if (t < from || t > to) continue;
    results.push({ t, summary: run(engine, requirement, { rpm: cad, revolutions: rev, at: t * 1000, zone: zoneAt(t) }) });
  }
  return results;
};

const longestUnsatisfiedMs = (results) => {
  let longest = 0;
  let since = null;
  for (const { t, summary } of results) {
    if (summary && !summary.satisfied) {
      if (since == null) since = t;
      longest = Math.max(longest, (t - since) * 1000);
    } else {
      since = null;
    }
  }
  return longest;
};

describe('cadence_floor — rolling window and the Active-zone alternative', () => {
  let engine;
  let requirement;

  beforeEach(() => {
    logged.length = 0;
    ({ engine, requirement } = setup());
  });

  it('normalizes the window and the alternative zone, defaulting to Active', () => {
    expect(requirement).toMatchObject({ windowSeconds: 10, movingMinRpm: 30, orZone: 'active' });
    const off = setup({ or_zone: 'none', window_seconds: 8, moving_min_rpm: 20 }).requirement;
    expect(off).toMatchObject({ windowSeconds: 8, movingMinRpm: 20, orZone: null });
  });

  it('REPLAY: one-revolution nudges no longer keep a stopped rider unlocked', () => {
    // Fixture t=0..15 is real riding at 60-85 RPM; it arms only after 30s, so
    // lead in with 30s of riding that ends at the fixture's first count.
    ride(engine, requirement, -31_000, 30_000, tricycle[0][2] - 31);
    // 19:29:46-19:34:16: stopped, with single-revolution nudges throughout.
    const results = replay(engine, requirement, 0, 286);
    // A lock needs 30s of continuous warning; before the fix the longest was ~18s.
    expect(longestUnsatisfiedMs(results)).toBeGreaterThanOrEqual(30_000);
  });

  it('REPLAY: a rider in the Active zone at 0 RPM is never blamed', () => {
    ride(engine, requirement, 740_000, 30_000, tricycle.find(([t]) => t >= 770)[2] - 31);
    // 19:42:46-19:43:46: off the bike, HR 141-151 = Active.
    const results = replay(engine, requirement, 771, 860, (t) => (t >= 790 ? 'active' : 'cool'));
    expect(results.every(({ summary }) => summary?.satisfied)).toBe(true);
    expect(results.find(({ t }) => t >= 820).summary.status).toBe('active');
  });

  it('a single revolution does not clear a trip', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    let summary = null;
    for (let t = 32_000; t <= 46_000; t += 1000) summary = run(engine, requirement, { rpm: 0, revolutions: rev, at: t });
    expect(summary.satisfied).toBe(false);
    // One push: the sensor holds ~41 RPM for three packets on one revolution.
    for (let t = 47_000; t <= 49_000; t += 1000) {
      summary = run(engine, requirement, { rpm: 41, revolutions: rev + 1, at: t });
    }
    expect(summary.satisfied).toBe(false);
    expect(summary.status).toBe('idle');
  });

  it('steady pedaling clears a trip within a few seconds', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    for (let t = 32_000; t <= 46_000; t += 1000) run(engine, requirement, { rpm: 0, revolutions: rev, at: t });
    const { last } = ride(engine, requirement, 47_000, 6_000, rev + 1);
    expect(last.satisfied).toBe(true);
    expect(last.status).toBe('pedaling');
  });

  it('reaching the Active zone clears a trip at once', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    for (let t = 32_000; t <= 46_000; t += 1000) run(engine, requirement, { rpm: 0, revolutions: rev, at: t });
    const summary = run(engine, requirement, { rpm: 0, revolutions: rev, at: 47_000, zone: 'warm' });
    expect(summary).toMatchObject({ satisfied: true, status: 'active', missingUsers: [] });
  });

  it('leaving the Active zone off the bike starts a fresh idle timer, not an instant trip', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    for (let t = 32_000; t <= 90_000; t += 1000) run(engine, requirement, { rpm: 0, revolutions: rev, at: t, zone: 'active' });
    expect(run(engine, requirement, { rpm: 0, revolutions: rev, at: 95_000 }).satisfied).toBe(true);
    expect(run(engine, requirement, { rpm: 0, revolutions: rev, at: 101_000 }).satisfied).toBe(false);
  });

  it('a clean stop still trips about trip_after_seconds after the last revolution', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    let summary = null;
    for (let t = 32_000; t <= 40_000; t += 1000) summary = run(engine, requirement, { rpm: 0, revolutions: rev, at: t });
    expect(summary.satisfied).toBe(true);
    summary = run(engine, requirement, { rpm: 0, revolutions: rev, at: 42_000 });
    expect(summary.satisfied).toBe(false);
  });

  it('with the alternative switched off, the Active zone does not excuse a stop', () => {
    ({ engine, requirement } = setup({ or_zone: 'none' }));
    const { rev } = ride(engine, requirement, 0, 31_000);
    let summary = null;
    for (let t = 32_000; t <= 46_000; t += 1000) summary = run(engine, requirement, { rpm: 0, revolutions: rev, at: t, zone: 'hot' });
    expect(summary.satisfied).toBe(false);
  });

  it('counts revolutions across the 16-bit counter wrap', () => {
    const { rev } = ride(engine, requirement, 0, 31_000, 65_520);
    expect(rev).toBeGreaterThan(65_535);
    const summary = run(engine, requirement, { rpm: 60, revolutions: rev % 65_536, at: 32_000 });
    expect(summary.satisfied).toBe(true);
    expect(summary.currentRate).toBeGreaterThanOrEqual(54);
  });

  it('falls back to averaging RPM samples when the sensor sends no revolution count', () => {
    for (let t = 0; t <= 31_000; t += 1000) run(engine, requirement, { rpm: 55, at: t });
    let summary = null;
    for (let t = 32_000; t <= 46_000; t += 1000) summary = run(engine, requirement, { rpm: 0, connected: false, at: t });
    expect(summary.satisfied).toBe(false);
    summary = run(engine, requirement, { rpm: 48, at: 47_000 });
    expect(summary.satisfied).toBe(false);
    for (let t = 48_000; t <= 53_000; t += 1000) summary = run(engine, requirement, { rpm: 48, at: t });
    expect(summary.satisfied).toBe(true);
  });

  it('logs the trip and the clear, each once, with what cleared it', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    for (let t = 32_000; t <= 50_000; t += 1000) run(engine, requirement, { rpm: 0, revolutions: rev, at: t });
    run(engine, requirement, { rpm: 0, revolutions: rev, at: 51_000, zone: 'active' });
    run(engine, requirement, { rpm: 0, revolutions: rev, at: 52_000, zone: 'active' });
    const events = logged.map((e) => e.event).filter((e) => e.startsWith('governance.cadence_floor.'));
    expect(events.filter((e) => e.endsWith('.tripped'))).toHaveLength(1);
    expect(events.filter((e) => e.endsWith('.cleared'))).toHaveLength(1);
    expect(logged.find((e) => e.event.endsWith('.cleared')).data.reason).toBe('active');
  });

  it('a quiet second between packets does not read a riding child as stopped', () => {
    // The controller delivers ~25% of packets 2s apart; pulse evaluations in
    // between see a reading with no fresh packet.
    let rev = 1000;
    let summary = null;
    for (let t = 0; t <= 60_000; t += 1000) {
      summary = run(engine, requirement, { rpm: 60, revolutions: rev, at: t });
      rev += 1;
      summary = run(engine, requirement, { rpm: 0, connected: false, at: t + 500 });
      expect(summary?.status ?? 'unarmed').not.toBe('idle');
    }
    expect(summary.satisfied).toBe(true);
    expect(logged.filter((e) => e.event.endsWith('.idle_started'))).toHaveLength(0);
  });

  it('logs a stall-restarted clear as resumed, not as active', () => {
    const { rev } = ride(engine, requirement, 0, 31_000);
    for (let t = 32_000; t <= 46_000; t += 1000) run(engine, requirement, { rpm: 0, revolutions: rev, at: t });
    engine._evaluateCadenceFloorRequirement(requirement, {
      equipmentCadenceMap: { tricycle: { rpm: 0, connected: false, transportStalled: true } },
      equipmentRiderMap: { tricycle: RIDER }, activeParticipants: [RIDER], userZoneMap: { [RIDER]: 'cool' }, timestamp: 47_000,
    });
    run(engine, requirement, { rpm: 0, revolutions: rev, at: 48_000 });
    expect(logged.find((e) => e.event.endsWith('.cleared')).data.reason).toBe('resumed');
  });
});
