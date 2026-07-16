// Fitness identity reconciliation — Task 5 (close-on-reassign).
//
// Regression guard for the "elizabeth" bug: a superseded entity was left
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

const DEVICE_ID = '29413';

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
  it('closes the first occupant entity (endTime + non-active status) when device 29413 is reassigned', () => {
    const { session, service } = makeService();

    const first = service.assignGuest(DEVICE_ID, { name: 'Soren', profileId: 'soren' });
    expect(first.ok).toBe(true);
    const sorenEntityId = first.data.entityId;
    expect(sorenEntityId).toBeTruthy();

    // Sanity: freshly created entity starts active/open.
    const sorenEntityBefore = session.entityRegistry.get(sorenEntityId);
    expect(sorenEntityBefore.status).toBe('active');
    expect(sorenEntityBefore.endTime).toBeNull();

    const second = service.assignGuest(DEVICE_ID, { name: 'Grannie', profileId: 'grannie' });
    expect(second.ok).toBe(true);
    const grannieEntityId = second.data.entityId;
    expect(grannieEntityId).toBeTruthy();
    expect(grannieEntityId).not.toBe(sorenEntityId);

    // The superseded (soren) entity must now be closed with a finite endTime
    // and a non-active status — not left dangling as the elizabeth bug did.
    const sorenEntityAfter = session.entityRegistry.get(sorenEntityId);
    expect(sorenEntityAfter.status).not.toBe('active');
    expect(sorenEntityAfter.status).toBe('superseded');
    expect(Number.isFinite(sorenEntityAfter.endTime)).toBe(true);

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

    const first = service.assignGuest(DEVICE_ID, { name: 'Soren', profileId: 'soren' });
    const sorenEntityId = first.data.entityId;

    const second = service.assignGuest(DEVICE_ID, { name: 'Elizabeth', profileId: 'elizabeth' });
    expect(second.ok).toBe(true);
    const elizabethEntityId = second.data.entityId;
    expect(elizabethEntityId).not.toBe(sorenEntityId);

    const sorenEntityAfter = session.entityRegistry.get(sorenEntityId);
    expect(sorenEntityAfter.status).toBe('transferred');
    expect(Number.isFinite(sorenEntityAfter.endTime)).toBe(true);
  });
});
