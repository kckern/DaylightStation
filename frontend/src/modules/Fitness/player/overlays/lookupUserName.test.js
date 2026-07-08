import { describe, it, expect } from 'vitest';
import { lookupUserName } from './lookupUserName.js';

const users = [
  { id: 'user_3', name: 'User_3 Kern', groupLabel: 'User_3' },
  { id: 'user_1', name: 'User_1', groupLabel: 'Dad' },
  { id: 'user_4', name: 'User_4 Kern' }, // no nickname
];

describe('lookupUserName', () => {
  it('uses the given name by default (solo / preferGroupLabels false)', () => {
    expect(lookupUserName(users, 'user_1')).toBe('User_1');
    expect(lookupUserName(users, 'user_3')).toBe('User_3 Kern');
  });

  it('uses the household nickname only when preferGroupLabels is true', () => {
    expect(lookupUserName(users, 'user_1', { preferGroupLabels: true })).toBe('Dad');
    expect(lookupUserName(users, 'user_3', { preferGroupLabels: true })).toBe('User_3');
  });

  it('falls back to the given name when there is no nickname, even with preferGroupLabels', () => {
    expect(lookupUserName(users, 'user_4', { preferGroupLabels: true })).toBe('User_4 Kern');
  });

  it('matches case-insensitively', () => {
    expect(lookupUserName(users, 'USER_1')).toBe('User_1');
    expect(lookupUserName(users, 'USER_1', { preferGroupLabels: true })).toBe('Dad');
  });

  it('falls back to the raw userId when no user matches', () => {
    expect(lookupUserName(users, 'guest1')).toBe('guest1');
  });

  it('falls back to the raw userId when the list is missing or empty', () => {
    expect(lookupUserName(null, 'user_3')).toBe('user_3');
    expect(lookupUserName([], 'user_3')).toBe('user_3');
    expect(lookupUserName(undefined, 'user_3')).toBe('user_3');
  });

  it('falls back to the raw userId when the matched user has no name or nickname', () => {
    expect(lookupUserName([{ id: 'user_3' }], 'user_3')).toBe('user_3');
    expect(lookupUserName([{ id: 'user_3' }], 'user_3', { preferGroupLabels: true })).toBe('user_3');
  });
});
