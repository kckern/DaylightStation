import { describe, it, expect } from 'vitest';
import { entriesFor } from './instrumentsKeyMap.js';

describe('entriesFor', () => {
  it('prepends the Onboard entry to configured instruments', () => {
    const instruments = [{ id: 'grand', name: 'Grand', engine: 'sfizz' }];
    expect(entriesFor(instruments)).toEqual([
      { id: '__onboard__', name: 'Onboard', engine: null },
      { id: 'grand', name: 'Grand', engine: 'sfizz' },
    ]);
  });
  it('returns just Onboard for an empty instruments array', () => {
    expect(entriesFor([])).toEqual([{ id: '__onboard__', name: 'Onboard', engine: null }]);
  });
  it('treats a missing/undefined list as empty', () => {
    expect(entriesFor(undefined)).toEqual([{ id: '__onboard__', name: 'Onboard', engine: null }]);
  });
});
