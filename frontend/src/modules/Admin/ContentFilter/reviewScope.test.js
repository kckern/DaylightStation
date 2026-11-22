import { describe, it, expect } from 'vitest';
import { rowAction, scopeRows, stepFrom, actionKeysFor, nextKind, DEFAULT_SCOPE, isOpen } from './reviewScope.js';

const rows = [
  { id: 'a', kind: 'words', effect: 'mute', group: 'profanity', verdict: null, reviewed: null },
  { id: 'b', kind: 'words', effect: 'bleep', group: 'slurs', verdict: { verdict: 'approve' }, reviewed: { by: 'x' } },
  { id: 'c', kind: 'picture', effect: 'full-blur', group: 'sexual', verdict: null, reviewed: null },
  { id: 'd', kind: 'scenes', effect: 'skip-card', group: 'violence_blood_gore', verdict: null, reviewed: null },
];
describe('reviewScope', () => {
  it('names a row action', () => {
    expect(rows.map(rowAction)).toEqual(['mute', 'bleep', 'blur', 'skip']);
    expect(rowAction({ effect: 'profile' })).toBeNull();
  });
  it('scope is kind x action x needs x group', () => {
    const ids = (s) => scopeRows(rows, { ...DEFAULT_SCOPE, ...s }).map((r) => r.id);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ kind: 'words' })).toEqual(['a', 'b']);
    expect(ids({ action: 'blur' })).toEqual(['c']);
    expect(ids({ kind: 'words', action: 'skip' })).toEqual([]);
    expect(ids({ needs: true })).toEqual(['a', 'c', 'd']);
    expect(ids({ group: 'slurs' })).toEqual(['b']);
  });
  it('steps without wrapping and can skip rows that have a verdict', () => {
    expect(stepFrom(rows, 'a', 1).id).toBe('b');
    expect(stepFrom(rows, 'a', 1, { onlyOpen: true }).id).toBe('c');
    expect(stepFrom(rows, 'd', 1)).toBeNull();
    expect(stepFrom(rows, 'a', -1)).toBeNull();
    expect(stepFrom(rows, 'zz', 1).id).toBe('a');
    expect(stepFrom(rows, 'zz', -1).id).toBe('d');
  });
  it('action keys follow the kind', () => {
    expect(actionKeysFor('words').map((k) => k[0])).toEqual(['M', 'P']);
    expect(actionKeysFor('picture').map((k) => k[0])).toEqual(['B', 'K']);
    expect(actionKeysFor('scenes').map((k) => k[0])).toEqual(['K', 'B']);
  });
  it('F cycles all > words > picture > scenes > all', () => {
    expect(['all', 'words', 'picture', 'scenes'].map(nextKind)).toEqual(['words', 'picture', 'scenes', 'all']);
  });
});

describe('all parts: playing parts, timing and order (2026-11-21)', () => {
  const r = (id, o) => ({ id, kind: 'words', effect: 'mute', in: 0, out: 1, ...o });
  const list = [r('b', { in: 50, timing: 'rough' }), r('p', { in: 10, acts: false, effect: 'off', timing: 'rough' }), r('a', { in: 20, timing: 'refined' })];
  it('a playing part is never "open" except in the Plays view', () => {
    expect(isOpen(list[1])).toBe(false);
    expect(isOpen(list[1], { show: 'plays' })).toBe(true);
    expect(stepFrom(scopeRows(list, DEFAULT_SCOPE), 'p', 1, { onlyOpen: true })?.id).toBe('a');
  });
  it('film order by default; timing narrows', () => {
    expect(scopeRows(list, DEFAULT_SCOPE).map((x) => x.id)).toEqual(['p', 'a', 'b']);
    expect(scopeRows(list, { ...DEFAULT_SCOPE, timing: 'rough' }).map((x) => x.id)).toEqual(['p', 'b']);
    expect(scopeRows(list, { ...DEFAULT_SCOPE, order: 'attention', show: 'filtered' }).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
