import { describe, it, expect } from 'vitest';
import { UNCOUNTED_STATUSES, isCountedRow, sumCounted } from './countedRows.mjs';

// This file is the contract the server's equation and the client's bars share.
// If it changes, both move together — that is the whole point of it existing.

describe('countedRows contract', () => {
  it('excludes exactly pending, rejected and deleted', () => {
    expect([...UNCOUNTED_STATUSES]).toEqual(['pending', 'rejected', 'deleted']);
  });

  it('counts a row with no status, and an accepted one', () => {
    expect(isCountedRow({})).toBe(true);
    expect(isCountedRow({ status: 'accepted' })).toBe(true);
  });

  it('never excludes on `settled` — an unsettled row counts the moment it is captured', () => {
    expect(isCountedRow({ settled: false })).toBe(true);
    expect(sumCounted([{ calories: 100, settled: false }], 'calories')).toBe(100);
  });

  it.each(['pending', 'rejected', 'deleted'])('drops a %s row from a sum', (status) => {
    expect(sumCounted([{ protein: 10 }, { protein: 999, status }], 'protein')).toBe(10);
  });

  it('counts a group and its children once — the header carries zeros by design', () => {
    const rows = [
      { kind: 'group', calories: 0, protein: 0 },
      { kind: 'item', parentId: 'g', calories: 200, protein: 12 },
      { kind: 'item', parentId: 'g', calories: 300, protein: 18 },
    ];
    expect(sumCounted(rows, 'calories')).toBe(500);
    expect(sumCounted(rows, 'protein')).toBe(30);
  });

  it('tolerates missing and non-numeric fields without producing NaN', () => {
    expect(sumCounted([{}, { protein: 'lots' }, { protein: null }, { protein: 7 }], 'protein')).toBe(7);
  });

  it('tolerates a non-array', () => {
    expect(sumCounted(undefined, 'calories')).toBe(0);
  });
});
