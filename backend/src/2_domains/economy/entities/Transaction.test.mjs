import { describe, it, expect } from 'vitest';
import { createTransaction, foldBalance } from './Transaction.mjs';

describe('createTransaction', () => {
  it('builds a stamped transaction with generated id', () => {
    const t = createTransaction({ kind: 'earn', delta: 5, action: 'piano-lesson-complete', source: 'piano', ref: 'plex:123' });
    expect(t.id).toMatch(/^txn_/);
    expect(t.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.kind).toBe('earn');
    expect(t.delta).toBe(5);
  });
  it('rejects sign/kind mismatch', () => {
    expect(() => createTransaction({ kind: 'earn', delta: -5, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'spend', delta: 3, action: 'x', source: 'test' })).toThrow();
  });
  it('rejects non-integer and zero deltas and unknown kinds', () => {
    expect(() => createTransaction({ kind: 'earn', delta: 1.5, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'earn', delta: 0, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'bogus', delta: 1, action: 'x', source: 'test' })).toThrow();
  });
});

describe('foldBalance', () => {
  it('sums deltas, never below zero reporting', () => {
    expect(foldBalance([{ delta: 5 }, { delta: 3 }, { delta: -2 }])).toBe(6);
    expect(foldBalance([])).toBe(0);
  });
  it('clamps a negative net to zero (never reports overdraft)', () => {
    expect(foldBalance([{ delta: 5 }, { delta: -9 }])).toBe(0);
  });
});
