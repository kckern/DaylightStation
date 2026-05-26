import { describe, it, expect, beforeEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { GuestAssignmentService } from './GuestAssignmentService.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';

/**
 * W2 — Integration: two simultaneous generic Guest tags on different devices
 * must produce two distinct participants end-to-end (ledger entries, session
 * entities, user identities).
 *
 * Drives the same code path the React context uses:
 *   FitnessSidebarMenu.handleAssignGuest → assignGuestToDevice (context)
 *     → GuestAssignmentService.assignGuest → userManager.assignGuest
 *
 * Pre-W2: the menu passed `profileId: 'guest'` for both Guest taps. The
 * GuestAssignmentService one-device-per-user check would *reject* the second
 * assignment (`user-already-assigned`) — so the second guest was silently
 * blocked rather than collapsed. Either way, the user-visible outcome was
 * broken: two simultaneous anonymous guests could not coexist.
 *
 * Post-W2: each device synthesizes `guest_<deviceId>`, so the two assignments
 * succeed independently and produce two distinct ledger entries, entities, and
 * User objects.
 */

describe('FitnessSession — two simultaneous generic Guest tags (W2 integration)', () => {
  let session;
  let ledger;
  let service;

  beforeEach(() => {
    session = new FitnessSession();
    // Wire a real ledger so userManager.assignmentLedger participates fully.
    ledger = new DeviceAssignmentLedger();
    session.userManager.setAssignmentLedger(ledger);
    service = new GuestAssignmentService({ session, ledger });

    // Configure with empty user lists and global zones — no preconfigured
    // primary/family users; the Guest aliases will be the only inhabitants.
    session.userManager.configure(
      { primary: [], family: [], friends: [] },
      [
        { id: 'cool',   min: 0,   coins: 0 },
        { id: 'active', min: 100, coins: 1 }
      ]
    );

    // Force-start the session so summary returns a populated object.
    const started = session.ensureStarted({ force: true, reason: 'test' });
    expect(started).toBe(true);
  });

  it('produces two distinct participants in session summary when two devices are Guest-tagged', () => {
    // Simulate the menu's post-W2 behavior: device-keyed profileId per tag.
    const result48291 = service.assignGuest('48291', {
      name: 'Guest',
      profileId: 'guest_48291',
      candidateId: 'guest',
      source: 'Guest'
    });
    const result48292 = service.assignGuest('48292', {
      name: 'Guest',
      profileId: 'guest_48292',
      candidateId: 'guest',
      source: 'Guest'
    });

    expect(result48291.ok).toBe(true);
    expect(result48292.ok).toBe(true);

    const summary = session.summary;
    expect(summary).toBeTruthy();

    // Two distinct ledger entries — one per device, with device-keyed occupantIds.
    const deviceAssignments = summary.deviceAssignments || [];
    const occupantIds = deviceAssignments.map(a => a.occupantId).sort();
    expect(occupantIds).toEqual(['guest_48291', 'guest_48292']);
    expect(new Set(occupantIds).size).toBe(occupantIds.length); // no duplicates

    // Both display names remain "Guest" — only the internal id is device-keyed.
    const names = deviceAssignments.map(a => a.occupantName);
    expect(names.every(n => n === 'Guest')).toBe(true);

    // Two distinct session entities — one per device assignment.
    const entityProfileIds = (summary.entities || []).map(e => e.profileId).sort();
    expect(entityProfileIds).toEqual(['guest_48291', 'guest_48292']);

    // Two distinct User objects under UserManager (the underlying identity store).
    const guestUsers = session.userManager.getAllUsers().filter(u => u.id.startsWith('guest_'));
    expect(guestUsers.map(u => u.id).sort()).toEqual(['guest_48291', 'guest_48292']);
    expect(guestUsers[0]).not.toBe(guestUsers[1]);
  });

  it('regression: shared profileId="guest" rejects the second assignment (pre-W2 bug shape)', () => {
    // Documents the pre-W2 failure mode: GuestAssignmentService's one-device-per-user
    // check blocks the second Guest tap when both share profileId='guest'.
    // The user-visible result was "the Guest button does nothing on the second device".
    const a = service.assignGuest('48291', { name: 'Guest', profileId: 'guest', candidateId: 'guest', source: 'Guest' });
    const b = service.assignGuest('48292', { name: 'Guest', profileId: 'guest', candidateId: 'guest', source: 'Guest' });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.code).toBe('user-already-assigned');
  });
});
