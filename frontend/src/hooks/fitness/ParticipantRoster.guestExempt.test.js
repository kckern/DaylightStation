/**
 * getActiveParticipantState must now INCLUDE guests (so they can earn challenge
 * credit downstream) and report them via guestIds (so the engine can keep them
 * out of the subject set). Mirrors the harness in ParticipantRoster.hrFloor.test.js.
 */
import { describe, it, expect } from 'vitest';
import { ParticipantRoster } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const build = () => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager });
  return { roster, deviceManager, userManager };
};

describe('getActiveParticipantState — guests included + flagged', () => {
  it('includes a guest in participants and lists its id in guestIds', () => {
    const { roster, deviceManager, userManager } = build();
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 150, lastSeen: Date.now() });
    userManager.assignGuest('29425', 'Guest', { profileId: 'guest_29425', occupantType: 'guest' });
    // Mirror production: a device reading flows into the now-owning guest user so
    // it is hr-active (hrInactive=false). Without this the entry defaults to
    // hrInactive=true and would be routed to hrInactiveUsers, never reaching
    // `participants` regardless of the guest-inclusion change under test.
    userManager.resolveUserForDevice('29425')
      ?.updateFromDevice({ type: 'heart_rate', deviceId: '29425', heartRate: 150 });

    const state = roster.getActiveParticipantState();
    expect(state.participants).toContain('guest_29425');
    expect(state.guestIds).toContain('guest_29425');
  });
});
