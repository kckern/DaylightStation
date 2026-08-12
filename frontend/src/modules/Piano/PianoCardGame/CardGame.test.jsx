import { describe, expect, it } from 'vitest';
import { resolveCardGameUserId } from './CardGame.jsx';

describe('Card Game piano identity', () => {
  it('preserves the kiosk selected user when context stores an id string', () => {
    expect(resolveCardGameUserId('kid-1')).toBe('kid-1');
    expect(resolveCardGameUserId({ id: 'kid-2' })).toBe('kid-2');
    expect(resolveCardGameUserId({ user_id: 'kid-3' })).toBe('kid-3');
    expect(resolveCardGameUserId('kid-1', 'readiness-user')).toBe('readiness-user');
    expect(resolveCardGameUserId(null)).toBe('guest');
  });
});
