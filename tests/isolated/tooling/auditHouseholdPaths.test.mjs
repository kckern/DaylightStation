import { describe, it, expect } from 'vitest';
import { findWriterReaderSplits } from '../../../scripts/audit-household-paths.mjs';

describe('findWriterReaderSplits', () => {
  it('flags a subpath written in one place and read from another root', () => {
    const sites = [
      { file: 'a.mjs', line: 1, subpath: 'history/piano', mode: 'write' },
      { file: 'b.mjs', line: 2, subpath: 'piano/log', mode: 'read' },
    ];
    // Same domain ('piano'), disjoint write/read subpaths — the exact 2026-08-16 split.
    const splits = findWriterReaderSplits(sites);
    expect(splits.map(s => s.subpath).sort()).toEqual(['history/piano', 'piano/log']);
  });

  it('stays quiet when writer and reader agree', () => {
    const sites = [
      { file: 'a.mjs', line: 1, subpath: 'piano/log', mode: 'write' },
      { file: 'b.mjs', line: 2, subpath: 'piano/log', mode: 'read' },
    ];
    expect(findWriterReaderSplits(sites)).toEqual([]);
  });

  it('stays quiet for a write-only trail with no reader at all', () => {
    // barcode/log and pressure-mats/log are legitimately write-only.
    const sites = [{ file: 'a.mjs', line: 1, subpath: 'barcode/log', mode: 'write' }];
    expect(findWriterReaderSplits(sites)).toEqual([]);
  });

  it('stays quiet for a read-only tree with no writer', () => {
    const sites = [{ file: 'a.mjs', line: 1, subpath: 'config/devices', mode: 'read' }];
    expect(findWriterReaderSplits(sites)).toEqual([]);
  });
});
