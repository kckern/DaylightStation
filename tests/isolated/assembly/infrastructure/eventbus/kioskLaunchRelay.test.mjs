import { describe, it, expect } from 'vitest';
import {
  KIOSK_LAUNCH_RELAY_TOPICS,
  shouldRelayKioskLaunchTopic
} from '#backend/src/0_system/eventbus/kioskLaunchRelay.mjs';

describe('kioskLaunchRelay', () => {
  it('relays the admin → kiosk launch command', () => {
    expect(shouldRelayKioskLaunchTopic('kiosk.launch')).toBe(true);
  });

  it('relays the kiosk → admin result', () => {
    expect(shouldRelayKioskLaunchTopic('kiosk.launch.result')).toBe(true);
  });

  it('refuses any other topic', () => {
    // The bus must not become an open client↔client relay.
    for (const topic of ['midi', 'playback_state', 'kiosk', 'kiosk.', 'admin', 'bt.pair.request']) {
      expect(shouldRelayKioskLaunchTopic(topic)).toBe(false);
    }
  });

  it('refuses prefix and suffix near-misses', () => {
    expect(shouldRelayKioskLaunchTopic('kiosk.launch.evil')).toBe(false);
    expect(shouldRelayKioskLaunchTopic('xkiosk.launch')).toBe(false);
  });

  it('refuses non-string topics without throwing', () => {
    for (const topic of [undefined, null, 42, {}, [], Symbol('kiosk.launch')]) {
      expect(shouldRelayKioskLaunchTopic(topic)).toBe(false);
    }
  });

  it('exposes exactly the two relayed topics', () => {
    expect([...KIOSK_LAUNCH_RELAY_TOPICS].sort()).toEqual(['kiosk.launch', 'kiosk.launch.result']);
  });
});
