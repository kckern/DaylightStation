import { describe, it, expect } from 'vitest';
import { lookupUserName } from './lookupUserName.js';

const users = [
  { id: 'milo', name: 'Milo Kern', groupLabel: 'Milo' },
  { id: 'kckern', name: 'KC Kern', groupLabel: 'Dad' },
  { id: 'alan', name: 'Alan Kern' }, // no nickname
];

describe('lookupUserName', () => {
  it('prefers the household nickname (groupLabel) when set', () => {
    expect(lookupUserName(users, 'kckern')).toBe('Dad');
    expect(lookupUserName(users, 'milo')).toBe('Milo');
  });

  it('falls back to the given name when there is no nickname', () => {
    expect(lookupUserName(users, 'alan')).toBe('Alan Kern');
  });

  it('matches case-insensitively', () => {
    expect(lookupUserName(users, 'KCKERN')).toBe('Dad');
  });

  it('falls back to the raw userId when no user matches', () => {
    expect(lookupUserName(users, 'guest1')).toBe('guest1');
  });

  it('falls back to the raw userId when the list is missing or empty', () => {
    expect(lookupUserName(null, 'milo')).toBe('milo');
    expect(lookupUserName([], 'milo')).toBe('milo');
    expect(lookupUserName(undefined, 'milo')).toBe('milo');
  });

  it('falls back to the raw userId when the matched user has no name or nickname', () => {
    expect(lookupUserName([{ id: 'milo' }], 'milo')).toBe('milo');
  });
});
