import { describe, it, expect, beforeEach } from 'vitest';
import { UserManager } from './UserManager.js';

/**
 * W2 — Device-keyed generic Guest alias.
 *
 * Decision §2 of the 2026-05-26 guest-mode-ux audit:
 *   "Each generic 'Guest' tag must produce a per-device alias — two Guest tags
 *    on devices A and B yield distinct users `guest_A` and `guest_B`."
 *
 * Today's bug: FitnessSidebarMenu passes a shared `profileId: 'guest'` for the
 * generic Guest option. Because UserManager keys users by profileId, both
 * devices collapse onto a single User identity, causing series-key collisions
 * and a single shared participant in saved YAML.
 *
 * The fix is local to the menu: synthesize `guest_<deviceId>` when the option
 * is generic. UserManager already handles distinct profileIds correctly — these
 * tests lock in that contract so a future refactor cannot regress it.
 */

describe('UserManager — generic Guest device-keyed alias (W2)', () => {
  let manager;

  beforeEach(() => {
    manager = new UserManager();
    manager.configure(
      { primary: [], family: [], friends: [] },
      [
        { id: 'cool',   min: 0,   coins: 0 },
        { id: 'active', min: 100, coins: 1 }
      ]
    );
  });

  it('creates two distinct User objects when generic Guest is tagged on two devices', () => {
    // Simulate the post-W2 menu behavior: a deterministic device-keyed
    // profileId is synthesized for isGeneric tags before reaching UserManager.
    manager.assignGuest('90006', 'Guest', { profileId: 'guest_48291', occupantType: 'guest' });
    manager.assignGuest('48292', 'Guest', { profileId: 'guest_48292', occupantType: 'guest' });

    const userA = manager.resolveUserForDevice('90006');
    const userB = manager.resolveUserForDevice('48292');

    expect(userA).toBeTruthy();
    expect(userB).toBeTruthy();
    expect(userA.id).toBe('guest_48291');
    expect(userB.id).toBe('guest_48292');
    expect(userA).not.toBe(userB); // distinct object instances

    // Belt-and-suspenders: the manager's user map holds two entries, not one.
    const allUsers = manager.getAllUsers();
    const guestIds = allUsers.map(u => u.id).filter(id => id.startsWith('guest_'));
    expect(new Set(guestIds).size).toBe(2);
    expect(guestIds).toContain('guest_48291');
    expect(guestIds).toContain('guest_48292');
  });

  it('keeps the display name as "Guest" while the internal id is device-keyed', () => {
    manager.assignGuest('90006', 'Guest', { profileId: 'guest_48291', occupantType: 'guest' });
    const user = manager.resolveUserForDevice('90006');
    expect(user.name).toBe('Guest');
    expect(user.id).toMatch(/^guest_/);
  });

  it('regression: a single shared profileId="guest" collapses both devices onto one user (pre-W2 bug)', () => {
    // This documents the bug the menu fix prevents. If both devices were to
    // ever again pass the same profileId, UserManager would collapse them.
    // This test guards the rationale, not a behavior we want.
    manager.assignGuest('90006', 'Guest', { profileId: 'guest', occupantType: 'guest' });
    manager.assignGuest('48292', 'Guest', { profileId: 'guest', occupantType: 'guest' });

    const userA = manager.resolveUserForDevice('90006');
    const userB = manager.resolveUserForDevice('48292');
    expect(userA).toBe(userB); // SAME instance — confirms the bug scenario
    expect(userA.id).toBe('guest');
  });
});
