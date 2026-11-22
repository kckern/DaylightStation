import { describe, it, expect } from 'vitest';
import { NotificationPresentation } from './NotificationPresentation.mjs';

describe('NotificationPresentation', () => {
  it('maps the legacy companion-app block', () => {
    const p = NotificationPresentation.fromPushData({ tag: 'donow-1', alert_once: true, ttl: 0, importance: 'high', channel: 'DoNow approvals' });
    expect(p).toMatchObject({ tag: 'donow-1', alertOnce: true, ttlSeconds: 0, importance: 'high', channel: 'DoNow approvals' });
  });
  it('defaults', () => {
    expect(new NotificationPresentation()).toMatchObject({ tag: null, group: null, alertOnce: false, ttlSeconds: null, importance: 'default', channel: null, imageUrl: null, icon: null, deepLink: null });
  });
  it('rejects an absolute image url', () => {
    expect(() => new NotificationPresentation({ imageUrl: 'https://x/y.png' })).toThrow(/imageUrl/);
  });
  it('rejects an absolute deep link', () => {
    expect(() => new NotificationPresentation({ deepLink: 'https://x' })).toThrow(/deepLink/);
  });
  it('rejects an unknown importance', () => {
    expect(() => new NotificationPresentation({ importance: 'urgent' })).toThrow(/importance/);
  });
  it('rejects a malformed icon key', () => {
    expect(() => new NotificationPresentation({ icon: 'Bad Icon' })).toThrow(/icon/);
  });
  it('is frozen', () => {
    expect(Object.isFrozen(new NotificationPresentation({ tag: 't' }))).toBe(true);
  });
  it('fromPushData of nothing is the defaults', () => {
    expect(NotificationPresentation.fromPushData(null)).toEqual(new NotificationPresentation());
  });
  it('maps a relative legacy image and clickAction', () => {
    expect(NotificationPresentation.fromPushData({ image: '/api/v1/x.png', clickAction: '/school' })).toMatchObject({ imageUrl: '/api/v1/x.png', deepLink: '/school' });
  });
  it('drops an absolute legacy image rather than failing the push', () => {
    expect(NotificationPresentation.fromPushData({ image: 'https://x/y.png' }).imageUrl).toBeNull();
  });
});
