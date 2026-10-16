/**
 * `cadence_floor` must survive the pulse path.
 *
 * Timer pulses and zone-change debounces call `evaluate()` with no arguments,
 * so they carry no equipment cadence. The end-of-evaluate capture used to
 * store that absence as `{}`, and the next requirement evaluation then read
 * "no cadence source" and disarmed the latch — throwing away the rider's
 * evidence seconds after it was earned. In prod (2026-10-09) the tricycle
 * gate armed for its rider and was disarmed 6s later with `no_cadence_source`;
 * it never tripped once in the log store's retention window.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from "./GovernanceEngine.js";

const policies = {
  default: {
    requirements: [{
      type: 'cadence_floor',
      id: 'tricycle_idle',
      equipment: 'tricycle',
      arm_seconds: 30,
      arm_min_rpm: 30,
      trip_after_seconds: 10,
    }],
  },
};

const RIDER = 'rider_a';

const snapshot = (rpm) => ({
  activeParticipants: [RIDER],
  equipmentCadenceMap: { tricycle: { rpm, connected: rpm > 0 } },
  equipmentRiderMap: { tricycle: RIDER },
});

describe('cadence_floor across pulse-path evaluations', () => {
  let engine;
  let requirements;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    engine = new GovernanceEngine();
    requirements = engine._normalizePolicies(policies)[0].requirements;
  });
  afterEach(() => vi.useRealTimers());

  const floorSummary = () => engine
    ._evaluateRequirementSet(requirements, [RIDER], {}, {}, {}, 1)
    .summaries.find((s) => s.type === 'cadence_floor');

  /** One second: a snapshot tick with live cadence, then a pulse with none. */
  const second = (rpm) => {
    vi.advanceTimersByTime(500);
    engine._captureLatestInputs(snapshot(rpm));
    floorSummary();
    vi.advanceTimersByTime(500);
    engine._captureLatestInputs({ activeParticipants: [RIDER] }); // no-session fallback: no map in hand
    return floorSummary();
  };

  it('a capture without a cadence map keeps the last one', () => {
    engine._captureLatestInputs(snapshot(55));
    engine._captureLatestInputs({ activeParticipants: [RIDER] });
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({ tricycle: { rpm: 55, connected: true } });
  });

  it('arms after 30s of riding and stays armed through pulses', () => {
    let summary = null;
    for (let i = 0; i < 32; i += 1) summary = second(55);
    expect(summary).not.toBeNull();
    expect(summary.satisfied).toBe(true);
    expect(engine._cadenceFloorState.get('tricycle_idle').armed).toBe(true);
  });

  it('trips when the rider stops, despite interleaved pulses', () => {
    for (let i = 0; i < 32; i += 1) second(55);
    let summary = null;
    for (let i = 0; i < 12; i += 1) summary = second(0);
    expect(summary.satisfied).toBe(false);
    expect(summary.missingUsers).toEqual([RIDER]);
  });

  it('a no-arg evaluate() reads live cadence from the session', () => {
    const live = { tricycle: { rpm: 42, connected: true } };
    engine.session = {
      getActiveParticipantState: () => ({ participants: [RIDER], zoneMap: {}, totalCount: 1, hrInactiveUsers: [] }),
      getEquipmentCadenceMap: () => live,
    };
    engine._captureLatestInputs(snapshot(55));
    engine.evaluate(); // the timer-pulse / zone-change path
    expect(engine._latestInputs.equipmentCadenceMap).toEqual(live);
  });
});
