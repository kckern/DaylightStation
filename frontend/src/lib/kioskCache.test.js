import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readCache, writeCache, localMonday } from './kioskCache.js';

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('kioskCache', () => {
  it('round-trips a payload for its version and week', () => {
    expect(writeCache('board:test', { a: 1 }, { version: 1, week: '2026-11-09' })).toBe(true);
    expect(readCache('board:test', { version: 1, week: '2026-11-09' })).toEqual({ a: 1 });
  });

  it('drops an entry from another week or another schema version', () => {
    writeCache('board:test', { a: 1 }, { version: 1, week: '2026-11-02' });
    expect(readCache('board:test', { version: 1, week: '2026-11-09' })).toBeNull();
    expect(localStorage.getItem('daylight.cache.board:test')).toBeNull(); // removed, not left to rot
    writeCache('board:test', { a: 1 }, { version: 1, week: '2026-11-09' });
    expect(readCache('board:test', { version: 2, week: '2026-11-09' })).toBeNull();
    expect(localStorage.getItem('daylight.cache.board:test')).toBeNull();
  });

  it('never writes an entry over the size cap', () => {
    expect(writeCache('big', { s: 'x'.repeat(2000) }, { version: 1, week: 'w', maxBytes: 1000 })).toBe(false);
    expect(readCache('big', { version: 1, week: 'w' })).toBeNull();
    expect(writeCache('small', { s: 'x'.repeat(10) }, { version: 1, week: 'w', maxBytes: 1000 })).toBe(true);
  });

  it('a blocked or throwing storage is a miss, never an error', () => {
    const boom = () => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(writeCache('k', { a: 1 }, { version: 1, week: 'w' })).toBe(false);
    expect(readCache('k', { version: 1, week: 'w' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('an unreadable entry is a miss and is removed', () => {
    localStorage.setItem('daylight.cache.k', '{not json');
    expect(readCache('k', { version: 1, week: 'w' })).toBeNull();
    expect(localStorage.getItem('daylight.cache.k')).toBeNull();
  });

  it('names the Monday of the local week', () => {
    expect(localMonday(new Date(2026, 10, 12, 15))).toBe('2026-11-09'); // a Thursday
    expect(localMonday(new Date(2026, 10, 15, 9))).toBe('2026-11-09'); // the Sunday
    expect(localMonday(new Date(2026, 10, 9, 0, 5))).toBe('2026-11-09'); // the Monday itself
  });
});
