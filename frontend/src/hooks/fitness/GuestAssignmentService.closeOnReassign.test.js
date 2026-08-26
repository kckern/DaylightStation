// Fitness identity reconciliation — Task 5 (close-on-reassign).
//
// Regression guard for the "parent-two" bug: a superseded entity was left
// `status: active, endTime: null` after its device moved to a new occupant,
// so the session-end segment builder measured it as spanning the whole
// session instead of its real (brief) duration.
//
// thresholdMs is pinned to 0 so the reassignment always takes the "honored"
// (GUEST_REPLACED / status: 'superseded') branch deterministically — any
// non-negative elapsed time is >= a 0ms threshold, regardless of how fast
// the test executes.
//
// @see /opt/Code/DaylightStation/docs/superpowers/specs/2026-07-16-fitness-identity-reconciliation-design.md

import { describe, it, expect } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';
import { GuestAssignmentService } from './GuestAssignmentService.js';

const DEVICE_ID = '10001';

// Mirrors the FitnessSession.assignmentDurability wiring: the ledger is
// injected into UserManager by the React layer, not constructed inside
// FitnessSession.
const makeService = () => {
  const session = new FitnessSession();
  const ledger = new DeviceAssignmentLedger();
  session.userManager.setAssignmentLedger(ledger);
  const service = new GuestAssignmentService({ session, ledger, thresholdMs: 0 });
  return { session, ledger, service };
};

describe('GuestAssignmentService — close-on-reassign', () => {
  it('closes the first occupant entity (endTime + non-active status) when device 10001 is reassigned', () => {
    const { session, service } = makeService();

    const first = service.assignGuest(DEVICE_ID, { name: 'learner1', profileId: 'learner1' });
    expect(first.ok).toBe(true);
    const learnerOneEntityId = first.data.entityId;
    expect(learnerOneEntityId).toBeTruthy();

    // Sanity: freshly created entity starts active/open.
    const learnerOneEntityBefore = session.entityRegistry.get(learnerOneEntityId);
    expect(learnerOneEntityBefore.status).toBe('active');
    expect(learnerOneEntityBefore.endTime).toBeNull();

    const second = service.assignGuest(DEVICE_ID, { name: 'Grannie', profileId: 'grannie' });
    expect(second.ok).toBe(true);
    const grannieEntityId = second.data.entityId;
    expect(grannieEntityId).toBeTruthy();
    expect(grannieEntityId).not.toBe(learnerOneEntityId);

    // The superseded (learner1) entity must now be closed with a finite endTime
    // and a non-active status — not left dangling as the parent-two bug did.
    const learnerOneEntityAfter = session.entityRegistry.get(learnerOneEntityId);
    expect(learnerOneEntityAfter.status).not.toBe('active');
    expect(learnerOneEntityAfter.status).toBe('superseded');
    expect(Number.isFinite(learnerOneEntityAfter.endTime)).toBe(true);

    // The new occupant (grannie) has its own live entity.
    const grannieEntity = session.entityRegistry.get(grannieEntityId);
    expect(grannieEntity).toBeTruthy();
    expect(grannieEntity.status).toBe('active');
    expect(grannieEntity.endTime).toBeNull();
  });

  it('closes the superseded entity as "transferred" when the segment is absorbed (< thresholdMs)', () => {
    const session = new FitnessSession();
    const ledger = new DeviceAssignmentLedger();
    session.userManager.setAssignmentLedger(ledger);
    // Default constructor threshold (60s) — an immediate reassignment falls
    // well under it, so this exercises the isSegmentAbsorbed branch instead.
    const service = new GuestAssignmentService({ session, ledger });

    const first = service.assignGuest(DEVICE_ID, { name: 'learner1', profileId: 'learner1' });
    const learnerOneEntityId = first.data.entityId;

    const second = service.assignGuest(DEVICE_ID, { name: 'parent-two', profileId: 'parent-two' });
    expect(second.ok).toBe(true);
    const parentTwoEntityId = second.data.entityId;
    expect(parentTwoEntityId).not.toBe(learnerOneEntityId);

    const learnerOneEntityAfter = session.entityRegistry.get(learnerOneEntityId);
    expect(learnerOneEntityAfter.status).toBe('transferred');
    expect(Number.isFinite(learnerOneEntityAfter.endTime)).toBe(true);
  });
});
