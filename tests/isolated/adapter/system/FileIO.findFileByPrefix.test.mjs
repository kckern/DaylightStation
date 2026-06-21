// tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs, { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findFileByPrefix } from '#system/utils/FileIO.mjs';

const tmps = [];
function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'findprefix-'));
  tmps.push(dir);
  for (const f of files) writeFileSync(join(dir, f), 'x');
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tmps.length) rmSync(tmps.pop(), { recursive: true, force: true });
});

describe('findFileByPrefix', () => {
  it('finds a file by numeric prefix (leading zeros ignored)', () => {
    const dir = makeDir(['00007-genesis-7.yml', '00008-genesis-8.yml']);
    expect(findFileByPrefix(dir, '7', ['.yml'])).toBe(join(dir, '00007-genesis-7.yml'));
  });

  it('reads the directory only once across repeated lookups (cache hit)', () => {
    const dir = makeDir(['00001-a.yml', '00002-b.yml', '00001-a.mp3']);
    const spy = vi.spyOn(fs, 'readdirSync');
    findFileByPrefix(dir, '1', ['.yml']);
    findFileByPrefix(dir, '2', ['.yml']);
    findFileByPrefix(dir, '1', ['.mp3']); // different extension, same dir
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the directory mtime changes', () => {
    const dir = makeDir(['00001-a.yml']);
    findFileByPrefix(dir, '1', ['.yml']); // populate cache (before spy)
    const spy = vi.spyOn(fs, 'readdirSync');
    const future = new Date(Date.now() + 60000);
    utimesSync(dir, future, future); // bump dir mtime → invalidate
    findFileByPrefix(dir, '1', ['.yml']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns null for a non-existent directory', () => {
    expect(findFileByPrefix('/no/such/dir/xyz', '1', ['.yml'])).toBeNull();
  });
});
