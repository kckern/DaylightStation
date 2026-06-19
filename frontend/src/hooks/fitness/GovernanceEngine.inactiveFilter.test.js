import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

/**
 * W3 — INACTIVE-device exclusion from governance evaluation.
 *
 * Decision §4 of the 2026-05-26 guest-mode-ux audit:
 *   "An INACTIVE card (no signal for 10s+) is **not** a current participant
 *   for governance evaluation."
 *
 * INACTIVE devices (signal silent ≥10s, gray card) MUST NOT count toward
 *  - base_requirement zone rules like `active: all`
 *  - min_participants / challenge thresholds
 *
 * This filtering already happens upstream in TWO places:
 *   - `ParticipantRoster.getActiveParticipantState()` (pulse path)
 *   - `FitnessSession._evaluateGovernance()` (snapshot path)
 *
 * These tests lock in the behavior with an explicit defensive guard *at the
 * engine boundary*, so a future upstream refactor cannot accidentally let
 * INACTIVE participants slip into governance evaluation. The engine consults
 * `session.roster` (when available) and drops any participant whose roster
 * entry reports `isActive === false` or has `inactiveSince` set, regardless
 * of what was passed in.
 */

const TEST_CONFIG = {
  // Governance triggers on a label (not type — see governedContent.js). The
  // media below carries this label so governance engages; these tests exercise
  // INACTIVE-participant filtering, not the governance trigger itself.
  governed_labels: ['governed'],
  policies: {
    default: {
      base_requirement: [{ active: 'all' }],
      challenges: []
    }
  },
  zoneConfig: [
    { id: 'cool',   name: 'Cool',   min: 0   },
    { id: 'active', name: 'Active', min: 100 }
  ]
};

/**
 * Build a minimal fake FitnessSession that exposes the surface the engine
 * actually reads:
 *   - `session.roster` getter (defensive INACTIVE-filter source)
 *   - `getActiveParticipantState()` (pulse-path fallback; unused here since
 *      we exercise the snapshot path by passing activeParticipants in)
 *   - `getParticipantProfile()` (used by feasibility checks)
 *
 * @param {Array<{id:string, name?:string, isActive:boolean, inactiveSince?:number|null, zoneId?:string}>} roster
 */
const makeSession = (roster) => ({
  get roster() { return roster; },
  getActiveParticipantState() {
    const participants = [];
    const zoneMap = {};
    for (const e of roster) {
      if (e.isActive === false) continue;
      if (e.inactiveSince) continue;
      participants.push(e.id);
      if (e.zoneId) zoneMap[e.id] = e.zoneId;
    }
    return { participants, zoneMap, totalCount: participants.length, hrInactiveUsers: [] };
  },
  getParticipantProfile() { return null; }
});

const ROSTER = [
  // Alice: live signal, currently in the "active" zone.
  { id: 'alice', name: 'Alice', isActive: true,  inactiveSince: null,                 zoneId: 'active' },
  // Bob: signal lost 15s ago (INACTIVE per audit §4). Last-known zone "cool".
  { id: 'bob',   name: 'Bob',   isActive: false, inactiveSince: Date.now() - 15000,   zoneId: 'cool' }
];

const ZONE_MAP_BOTH = { alice: 'active', bob: 'cool' };

describe('GovernanceEngine — INACTIVE device filtering at evaluation boundary (W3)', () => {
  let engine;
  let session;

  beforeEach(() => {
    session = makeSession(ROSTER);
    engine = new GovernanceEngine(session);
    engine.configure(TEST_CONFIG);
    engine.setMedia({ id: 'm1', type: 'test', labels: ['governed'] });
  });

  it('does NOT fail base requirement when an INACTIVE participant is present', () => {
    // The snapshot path: a buggy caller passes BOTH participants in, including
    // INACTIVE Bob (zone=cool). Without the engine-level guard, "active: all"
    // would fail because Bob is below the "active" zone.
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: ZONE_MAP_BOTH,
      totalCount: 2
    });

    expect(engine.phase).toBe('unlocked');
  });

  it('reaches unlocked with only the active participant when caller already filtered upstream', () => {
    // Sanity check: when upstream filtering works correctly, behavior is unchanged.
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked');
  });

  it('still LOCKS / falls back when the ACTIVE participant fails base requirement', () => {
    // Negative control: filter only affects INACTIVE devices. Alice in "cool"
    // with rule "active: all" must still fail (no INACTIVE-filtering side-effect).
    const rosterAliceCool = [
      { id: 'alice', name: 'Alice', isActive: true,  inactiveSince: null, zoneId: 'cool' },
      { id: 'bob',   name: 'Bob',   isActive: false, inactiveSince: Date.now() - 15000, zoneId: 'cool' }
    ];
    const session2 = makeSession(rosterAliceCool);
    const engine2 = new GovernanceEngine(session2);
    engine2.configure(TEST_CONFIG);
    engine2.setMedia({ id: 'm1', type: 'test', labels: ['governed'] });

    engine2.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'cool', bob: 'cool' },
      totalCount: 2
    });

    // Alice (the only non-INACTIVE participant) is in 'cool' — below required 'active'.
    // First-time failure → 'pending' (never satisfied before, so no grace-period warning).
    expect(engine2.phase).toBe('pending');
  });
});
