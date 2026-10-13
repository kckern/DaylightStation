import { describe, it, expect } from 'vitest';
import { composeKioskShutdownPush } from './shutdownPush.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

describe('composeKioskShutdownPush', () => {
  const push = composeKioskShutdownPush({
    lockedAt: '2026-08-28T00:43:29.185Z', lockedUntil: '2026-08-28T01:13:29.185Z', timezone: 'America/Los_Angeles',
  });
  it('says how long and until when, in local time', () => {
    expect(push.title).toBe('🔒 Kiosks locked — 30 min, until 6:13 PM');
    expect(push.message).toBe('Started from the shutdown tag');
    expect(findPushTextDefects(push.title)).toEqual([]);
    expect(findPushTextDefects(push.message)).toEqual([]);
  });
  it('replaces a second tap instead of ringing twice', () => {
    expect(push.data).toMatchObject({ tag: 'kiosk-shutdown', alert_once: true });
  });
  it('degrades without times', () => {
    const bare = composeKioskShutdownPush({});
    expect(bare.title).toBe('🔒 Kiosks locked');
    expect(findPushTextDefects(bare.title)).toEqual([]);
    expect(findPushTextDefects(bare.message)).toEqual([]);
  });
});
