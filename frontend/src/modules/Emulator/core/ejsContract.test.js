import { describe, it, expect } from 'vitest';
import { assertEjsContract, readPath, matchesType, EJS_CONTRACT } from './ejsContract.js';

/** A minimal instance satisfying the real contract. */
function validInstance(overrides = {}) {
  return {
    started: true,
    volume: 0.1,
    gamepadSelection: ['', '', '', ''],
    gamepad: { gamepads: [] },
    gameManager: { functions: { simulateInput: () => {} } },
    setVolume: () => {},
    ...overrides,
  };
}

describe('readPath', () => {
  it('reads a nested path', () => {
    expect(readPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
  });

  it('returns undefined for a missing intermediate instead of throwing', () => {
    expect(readPath({ a: null }, 'a.b.c')).toBeUndefined();
    expect(readPath({}, 'nope.nada')).toBeUndefined();
    expect(readPath(null, 'a')).toBeUndefined();
  });
});

describe('matchesType', () => {
  it('distinguishes array from object (typeof [] === object)', () => {
    expect(matchesType([], 'array')).toBe(true);
    expect(matchesType({}, 'array')).toBe(false);
  });

  it('rejects null and undefined for every type', () => {
    expect(matchesType(null, 'object')).toBe(false);
    expect(matchesType(undefined, 'function')).toBe(false);
  });

  it('accepts false and 0 as valid boolean/number values', () => {
    // Regression guard: a truthiness check here would wrongly reject a stopped
    // emulator (started === false) or a muted one (volume === 0).
    expect(matchesType(false, 'boolean')).toBe(true);
    expect(matchesType(0, 'number')).toBe(true);
  });
});

describe('assertEjsContract', () => {
  it('passes a fully-formed instance', () => {
    const res = assertEjsContract(validInstance());
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
  });

  it('names the exact missing path — the 2026-08-15 gamepadSelection failure', () => {
    const instance = validInstance();
    delete instance.gamepadSelection;
    const res = assertEjsContract(instance);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([
      { path: 'gamepadSelection', expected: 'array', actual: 'undefined' },
    ]);
  });

  it('flags a path whose type changed (upgrade drift), not just a missing one', () => {
    const res = assertEjsContract(validInstance({ setVolume: 'nope' }));
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([
      { path: 'setVolume', expected: 'function', actual: 'string' },
    ]);
  });

  it('detects a missing deep path', () => {
    const res = assertEjsContract(validInstance({ gameManager: {} }));
    expect(res.ok).toBe(false);
    expect(res.missing.map((m) => m.path)).toEqual(['gameManager.functions.simulateInput']);
  });

  it('reports every contract entry missing when there is no instance', () => {
    const res = assertEjsContract(null);
    expect(res.ok).toBe(false);
    expect(res.missing).toHaveLength(EJS_CONTRACT.length);
    expect(res.missing.every((m) => m.actual === 'no-instance')).toBe(true);
  });

  it('passes the engine version through for boot provenance', () => {
    expect(assertEjsContract(validInstance(), { version: '4.2.3' }).version).toBe('4.2.3');
  });
});
