import { describe, it, expect } from 'vitest';
import { NotificationAction } from './NotificationAction.mjs';

describe('NotificationAction', () => {
  it('accepts an approve button that needs an unlock, and is frozen', () => {
    const a = new NotificationAction({ id: 'DONOW_APPROVE_abc', label: 'Approve', requiresUnlock: true });
    expect(a).toMatchObject({ id: 'DONOW_APPROVE_abc', kind: 'button', label: 'Approve', requiresUnlock: true, destructive: false });
    expect(Object.isFrozen(a)).toBe(true);
  });
  it('rejects an unknown kind', () => {
    expect(() => new NotificationAction({ id: 'A', label: 'Go', kind: 'video' })).toThrow(/kind/);
  });
  it('rejects a label over 40 characters', () => {
    expect(() => new NotificationAction({ id: 'A', label: 'x'.repeat(41) })).toThrow(/label/);
  });
  it('rejects an absolute deep link', () => {
    expect(() => new NotificationAction({ id: 'A', label: 'Open', kind: 'open', deepLink: 'https://x' })).toThrow(/deepLink/);
  });
  it('rejects a deep link on a non-open action', () => {
    expect(() => new NotificationAction({ id: 'A', label: 'Go', deepLink: '/x' })).toThrow(/deepLink/);
  });
  it('rejects an id with spaces', () => {
    expect(() => new NotificationAction({ id: 'a b', label: 'Go' })).toThrow(/id/);
  });
  it('carries a reply placeholder on a reply action', () => {
    expect(new NotificationAction({ id: 'R', label: 'Reply', kind: 'reply', replyPlaceholder: 'Say why' }).replyPlaceholder).toBe('Say why');
  });
  it('from() returns the same instance or builds one', () => {
    const a = new NotificationAction({ id: 'A', label: 'Go' });
    expect(NotificationAction.from(a)).toBe(a);
    expect(NotificationAction.from({ id: 'B', label: 'Go' })).toBeInstanceOf(NotificationAction);
  });
});
