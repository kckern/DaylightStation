/**
 * Guest assignments must survive a session re-init. The ledger is in-memory;
 * a re-config that rebuilds users (the cycle-game lobby path) drops it. Capture
 * the ledger on assign; restore it after re-config.
 */
import { describe, it, expect } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';

// The assignment ledger is injected into the UserManager by the React layer
// (FitnessContext), not constructed inside FitnessSession. Mirror that wiring
// here so assignGuest actually writes the ledger — same pattern as the existing
// FitnessSession.genericGuestDeviceKeyed / UserManager.kidZoneOverrides tests.
const makeSession = () => {
  const session = new FitnessSession();
  session.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
  return session;
};

describe('FitnessSession — guest assignment durability', () => {
  it('captures the ledger snapshot immediately on assign (no tick required)', () => {
    const session = makeSession();
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });

    session.captureAssignmentSnapshot();

    expect(session._lastKnownGoodDeviceAssignments).toHaveLength(1);
    expect(session._lastKnownGoodDeviceAssignments[0].deviceId).toBe('10266');
  });

  it('restores a lost assignment back into the ledger', () => {
    const session = makeSession();
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    session.captureAssignmentSnapshot();

    // Simulate the re-init wipe.
    session.userManager.assignmentLedger.remove('10266');
    expect(session.userManager.assignmentLedger.get('10266')).toBeNull();

    const restored = session.restoreAssignmentSnapshot();

    expect(restored).toBe(true);
    expect(session.userManager.assignmentLedger.get('10266')?.occupantName).toBe('Grannie');
  });

  it('does not clobber an assignment that is still present', () => {
    const session = makeSession();
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    session.captureAssignmentSnapshot();
    // Replace with a newer occupant; restore must not overwrite it.
    session.userManager.assignGuest('10266', 'Milo', { profileId: 'milo', occupantType: 'guest' });

    session.restoreAssignmentSnapshot();

    expect(session.userManager.assignmentLedger.get('10266')?.occupantName).toBe('Milo');
  });

  it('survives a session start between assign and restore (assigned-before-broadcast)', () => {
    const session = makeSession();
    // Guest assigned while the strap is still silent.
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    session.captureAssignmentSnapshot();

    // Session starts AFTER the assignment (the audit's exact ordering).
    // force:true bypasses the kiosk/threshold guards so ensureStarted runs its body.
    session.ensureStarted({ reason: 'test', force: true });

    // The strap finally broadcasts under a different code path and the ledger
    // is rebuilt empty by a re-config; restore must still recover Grannie.
    session.userManager.assignmentLedger.remove('10266');
    const restored = session.restoreAssignmentSnapshot();

    expect(restored).toBe(true);
    expect(session.userManager.assignmentLedger.get('10266')?.occupantName).toBe('Grannie');

    // cleanup timers (reset() stops both the autosave and tick intervals)
    session.reset();
  });
});
