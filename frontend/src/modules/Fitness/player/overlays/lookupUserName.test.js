import { describe, it, expect } from 'vitest';
import { lookupUserName } from './lookupUserName.js';

const users = [
  { id: 'milo', name: 'Milo' },
  { id: 'kckern', name: 'Kevin' },
  { id: 'alan', name: 'Alan' },
];

describe('lookupUserName', () => {
  it('resolves a user slug to the configured given name', () => {
    expect(lookupUserName(users, 'milo')).toBe('Milo');
    expect(lookupUserName(users, 'kckern')).toBe('Kevin');
  });

  it('matches case-insensitively', () => {
    expect(lookupUserName(users, 'MILO')).toBe('Milo');
  });

  it('falls back to the raw userId when no user matches', () => {
    expect(lookupUserName(users, 'guest1')).toBe('guest1');
  });

  it('falls back to the raw userId when the list is missing or empty', () => {
    expect(lookupUserName(null, 'milo')).toBe('milo');
    expect(lookupUserName([], 'milo')).toBe('milo');
    expect(lookupUserName(undefined, 'milo')).toBe('milo');
  });

  it('falls back to the raw userId when the matched user has no name', () => {
    expect(lookupUserName([{ id: 'milo' }], 'milo')).toBe('milo');
  });
});
