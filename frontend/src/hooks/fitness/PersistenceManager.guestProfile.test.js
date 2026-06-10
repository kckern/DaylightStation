/**
 * Audit N4 — persist the guest age-class profile (guest_profile: kid).
 *
 * A kid guest on a borrowed strap is assigned with ledger metadata
 * `{ ageClass: 'kid', zones: [...] }` (see FitnessSidebarMenu /
 * guestOptionsBuilder). At save time the participants block must record
 * which zone profile the guest rode under so historical sessions can be
 * interpreted (and coins audited) correctly:
 *
 *   - guest participant  → is_guest: true AND guest_profile: 'kid'
 *   - primary participant (no ageClass) → NO guest_profile key
 *
 * buildParticipantsForPersist is module-private, so this drives the same
 * public path the late-tag merge tests use: PersistenceManager.persistSession
 * with a mocked persistApi, asserting on the captured save payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../../lib/clientId.js', () => ({
  getClientId: () => 'test-client'
}));

const { PersistenceManager } = await import('./PersistenceManager.js');

describe('PersistenceManager — guest_profile persistence (audit N4)', () => {
  let pm;
  let capturedPayload;

  beforeEach(() => {
    capturedPayload = null;
    pm = new PersistenceManager({
      persistApi: vi.fn().mockImplementation(async (url, body) => {
        if (url === 'api/v1/fitness/save_session') {
          capturedPayload = body?.sessionData;
        }
        return { ok: true };
      }),
      onLog: () => {}
    });
    pm.setUsageThresholdMs(5 * 60 * 1000);
  });

  it('writes guest_profile from assignment metadata.ageClass for guests, and omits it for participants without ageClass', async () => {
    const t0 = 1_700_000_000_000;
    const sessionStart = t0;
    const sessionEnd = t0 + 10 * 60 * 1000; // 10 minutes, 120 ticks @ 5s
    const tickCount = 120;

    const sessionData = {
      sessionId: 'fs_20260609000000',
      startTime: sessionStart,
      endTime: sessionEnd,
      finalized: true,
      roster: [
        // Kid guest riding the borrowed strap 90006.
        { profileId: 'guest_48291', name: 'Guest', isGuest: true, hrDeviceId: '90006' },
        // Regular primary user on their own strap — must NOT get guest_profile.
        { profileId: 'alice', name: 'Alice', isPrimary: true, hrDeviceId: '50000' }
      ],
      deviceAssignments: [
        { occupantId: 'guest_48291', deviceId: '90006', occupantName: 'Guest', metadata: { ageClass: 'kid' } },
        { occupantId: 'alice', deviceId: '50000', occupantName: 'Alice', metadata: {} }
      ],
      entities: [],
      timeline: {
        timebase: { startTime: sessionStart, intervalMs: 5000, tickCount },
        series: {
          'user:guest_48291:heart_rate': Array(tickCount).fill(110),
          'user:alice:heart_rate': Array(tickCount).fill(135)
        },
        events: []
      }
    };

    const accepted = pm.persistSession(sessionData, { force: true });
    expect(accepted).toBe(true);

    // Drain microtasks so the persistApi Promise chain resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capturedPayload).toBeTruthy();
    const participants = capturedPayload.participants || {};

    const guest = participants['guest_48291'];
    expect(guest).toBeTruthy();
    expect(guest.is_guest).toBe(true);
    expect(guest.guest_profile).toBe('kid');

    const alice = participants['alice'];
    expect(alice).toBeTruthy();
    expect(alice.is_primary).toBe(true);
    expect(alice).not.toHaveProperty('guest_profile');
  });
});
