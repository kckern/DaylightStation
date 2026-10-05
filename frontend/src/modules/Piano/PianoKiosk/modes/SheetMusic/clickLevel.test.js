import { describe, expect, it } from 'vitest';
import { CLICK_LEVELS, readClickLevel, writeClickLevel } from './clickLevel.js';

describe('learn click levels', () => {
  it('offers four increasingly louder semantic levels with room for the accent', () => {
    expect(CLICK_LEVELS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'soft', label: 'Soft' }, { id: 'medium', label: 'Medium' },
      { id: 'loud', label: 'Loud' }, { id: 'max', label: 'Max' },
    ]);
    let previous = 0;
    for (const level of CLICK_LEVELS) {
      expect(level.gain).toBeGreaterThan(previous);
      expect(level.gain * (0.25 / 0.18)).toBeLessThan(1);
      previous = level.gain;
    }
  });

  it('defaults to Loud when no selection exists', () => {
    expect(readClickLevel({ getItem: () => null }).id).toBe('loud');
  });

  it('round-trips each level under the learn preference key', () => {
    const entries = new Map();
    const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value) };
    for (const id of ['soft', 'medium', 'loud', 'max']) {
      writeClickLevel(storage, id);
      expect(entries.get('piano.learn.click-level')).toBe(id);
      expect(readClickLevel(storage).id).toBe(id);
    }
  });

  it('falls back to Loud for an unknown stored value or write', () => {
    const entries = new Map([['piano.learn.click-level', 'muted']]);
    const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value) };
    expect(readClickLevel(storage).id).toBe('loud');
    writeClickLevel(storage, 'unknown');
    expect(entries.get('piano.learn.click-level')).toBe('loud');
    expect(readClickLevel(storage).id).toBe('loud');
  });

  it('survives throwing storage and returns Loud', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readClickLevel(storage).id).toBe('loud');
    expect(() => writeClickLevel(storage, 'soft')).not.toThrow();
  });

  it('survives unavailable storage', () => {
    for (const storage of [null, undefined, {}]) {
      expect(readClickLevel(storage).id).toBe('loud');
      expect(() => writeClickLevel(storage, 'soft')).not.toThrow();
    }
  });
});
