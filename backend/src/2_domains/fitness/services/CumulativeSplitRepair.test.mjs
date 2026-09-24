import { describe, it, expect } from 'vitest';
import { repairCumulativeSplits } from './CumulativeSplitRepair.mjs';

const hrOf = (d) => (id) => d[`${id}:hr`] || [];

describe('repairCumulativeSplits', () => {
  it('pairs a drop with a matching jump and cancels both', () => {
    const d = {
      'a:hr': [150, 150, 150, 150, 150], 'a:rings': [0, 40, 88, 1, 2],
      'b:hr': [null, null, null, 120, 120], 'b:rings': [0, 0, 1, 89, 90],
    };
    const { repairs, unpaired } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(d['a:rings']).toEqual([0, 40, 88, 88, 89]);
    expect(d['b:rings']).toEqual([0, 0, 1, 2, 3]);
    expect(repairs).toEqual([{ metric: 'rings', from: 'b', to: 'a', tick: 3, amount: 87 }]);
    expect(unpaired).toEqual([]);
  });

  it('reports an unpaired drop without touching it', () => {
    const d = { 'a:hr': [150, 150, 150], 'a:rings': [0, 50, 3] };
    const { repairs, unpaired } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(repairs).toEqual([]);
    expect(unpaired).toEqual([{ key: 'a:rings', tick: 2, drop: 47 }]);
    expect(d['a:rings']).toEqual([0, 50, 3]);
  });

  it('pairs beats with a relative tolerance', () => {
    const d = {
      'a:hr': [150, 150, 150, 150], 'a:beats': [500, 586.4, 20.2, 29.9],
      'b:hr': [null, 110, 110, 110], 'b:beats': [0, 10.2, 20.3, 596.6],
    };
    const { repairs } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(repairs.map((r) => [r.metric, r.from, r.to])).toEqual([['beats', 'b', 'a']]);
    expect(d['a:beats'][2]).toBeCloseTo(586.4);
  });

  it('ignores equipment and global series', () => {
    const d = { 'bike:1:rotations': [0, 10, 2], 'global:rings': [0, 5, 1] };
    const { repairs, unpaired } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(repairs).toEqual([]);
    expect(unpaired).toEqual([]);
  });

  it('is idempotent', () => {
    const d = {
      'a:hr': [150, 150, 150, 150, 150], 'a:rings': [0, 40, 88, 1, 2],
      'b:hr': [null, null, null, 120, 120], 'b:rings': [0, 0, 1, 89, 90],
    };
    repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(repairCumulativeSplits(d, { hrOf: hrOf(d) })).toEqual({ repairs: [], unpaired: [] });
  });
});
