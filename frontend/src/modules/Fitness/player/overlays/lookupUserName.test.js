import { describe, it, expect } from 'vitest';
import { lookupUserName } from './lookupUserName.js';

const users = [
  { id: 'milo', name: 'Milo Kern', groupLabel: 'Milo' },
  { id: 'kckern', name: 'KC Kern', groupLabel: 'Dad' },
  { id: 'alan', name: 'Alan Kern' }, // no nickname
];

describe('lookupUserName', () => {
  it('uses the given name by default (solo / preferGroupLabels false)', () => {
    expect(lookupUserName(users, 'kckern')).toBe('KC Kern');
    expect(lookupUserName(users, 'milo')).toBe('Milo Kern');
  });

  it('uses the household nickname only when preferGroupLabels is true', () => {
    expect(lookupUserName(users, 'kckern', { preferGroupLabels: true })).toBe('Dad');
    expect(lookupUserName(users, 'milo', { preferGroupLabels: true })).toBe('Milo');
  });

  it('falls back to the given name when there is no nickname, even with preferGroupLabels', () => {
    expect(lookupUserName(users, 'alan', { preferGroupLabels: true })).toBe('Alan Kern');
  });

  it('matches case-insensitively', () => {
    expect(lookupUserName(users, 'KCKERN')).toBe('KC Kern');
    expect(lookupUserName(users, 'KCKERN', { preferGroupLabels: true })).toBe('Dad');
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
    expect(lookupUserName([{ id: 'milo' }], 'milo', { preferGroupLabels: true })).toBe('milo');
  });
});
