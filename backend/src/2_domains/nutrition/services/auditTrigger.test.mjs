import { describe, expect, it } from 'vitest';
import { classifyChange, onlyOwnChanges, snapshotDigest } from './auditTrigger.mjs';

const hash = s => s;
const row = (uuid, extra = {}) => ({ uuid, id: uuid, name: 'Apple', icon: 'apple', photoRef: null, date: '2026-09-05',
  calories: 95, settled: false, settledBy: null, review: { status: 'provisional', stabilizesAt: '2026-09-08T00:00:00Z' }, version: 1, ...extra });
const snap = ({ rows = [row('a'), row('b')], pending = [], dates = ['2026-09-05', '2026-09-04'], observations = [] } = {}) =>
  ({ dates, rows, pending, observations, fingerprint: 'ignored' });
const digest = options => snapshotDigest(snap(options), hash);
const kinds = (before, after) => [...classifyChange(digest(before), digest(after))].sort();

describe('classifyChange', () => {
  it('reports nothing when nothing moved', () => {
    expect(kinds({}, {})).toEqual([]);
  });
  it('treats a first look as the daily sweep', () => {
    expect([...classifyChange(null, digest({}))]).toEqual(['dailySweep']);
  });
  it('sees a new row as a capture, including pending capture items', () => {
    expect(kinds({}, { rows: [row('a'), row('b'), row('c')] })).toEqual(['captures']);
    expect(kinds({}, { pending: [{ id: 'log', version: 1, date: '2026-09-05', items: [row('p')] }] })).toEqual(['captures']);
  });
  it('does not treat a row leaving the window as a trigger', () => {
    expect(kinds({}, { rows: [row('a')] })).toEqual([]);
  });
  it('sees an observations change as a scale reconcile', () => {
    expect(kinds({}, { observations: [{ id: 'o1', grams: 120 }] })).toEqual(['scaleReconcile']);
  });
  it('sees a person settling a row as a review', () => {
    expect(kinds({}, { rows: [row('a', { settled: true, settledBy: 'user', settledAt: 'x', review: { status: 'accepted' }, version: 2 }), row('b')] }))
      .toEqual(['reviews']);
  });
  it('sees an automatic settle or review status change as stabilization', () => {
    expect(kinds({}, { rows: [row('a', { settled: true, settledBy: 'system', version: 2 }), row('b')] })).toEqual(['stabilization']);
    expect(kinds({}, { rows: [row('a', { review: { status: 'stable' } }), row('b')] })).toEqual(['stabilization']);
  });
  it('sees an icon-only change with its version bump as artwork', () => {
    expect(kinds({}, { rows: [row('a', { icon: 'pear', version: 2 }), row('b')] })).toEqual(['artwork']);
    expect(kinds({}, { rows: [row('a', { photoRef: 'ph_1', version: 2, cleanupFields: ['icon'], cleanupEvidence: { icon: ['e1'] } }), row('b')] }))
      .toEqual(['artwork']);
  });
  it('sees a content change as an edit', () => {
    expect(kinds({}, { rows: [row('a', { name: 'Pear', version: 2 }), row('b')] })).toEqual(['edits']);
    expect(kinds({}, { rows: [row('a', { icon: 'pear', calories: 60, version: 2 }), row('b')] })).toEqual(['edits']);
  });
  it('sees a new day as a day rollover', () => {
    expect(kinds({}, { dates: ['2026-09-06', '2026-09-05'] })).toEqual(['dayRollover']);
  });
  it('ignores bookkeeping-only changes', () => {
    expect(kinds({}, { rows: [row('a', { version: 3, updatedAt: 'later' }), row('b')] })).toEqual([]);
  });
});

describe('onlyOwnChanges', () => {
  const own = new Set(['a']);
  it('is true when only the auditor\'s own rows moved', () => {
    expect(onlyOwnChanges(digest({}), digest({ rows: [row('a', { calories: 80, version: 2 }), row('b')] }), own)).toBe(true);
  });
  it('is false when another row moved', () => {
    expect(onlyOwnChanges(digest({}), digest({ rows: [row('a', { calories: 80 }), row('b', { name: 'Pear' })] }), own)).toBe(false);
    expect(onlyOwnChanges(digest({}), digest({ rows: [row('a'), row('b'), row('c')] }), own)).toBe(false);
  });
  it('is false when observations or dates moved', () => {
    expect(onlyOwnChanges(digest({}), digest({ observations: [{ id: 'o1' }] }), own)).toBe(false);
    expect(onlyOwnChanges(digest({}), digest({ dates: ['2026-09-06', '2026-09-05'] }), own)).toBe(false);
  });
  it('is false without a previous digest', () => {
    expect(onlyOwnChanges(null, digest({}), own)).toBe(false);
  });
});
