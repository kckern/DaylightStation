import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseDirIndex, parseLyFiles, cacheName, listCached } from './fetch.mjs';

// Trimmed from the real mutopiaproject.org Apache index.
const DIR_INDEX = `<html><head><title>Index of /ftp/BurgmullerJFF/O100</title></head><body>
<tr><td><a href="/ftp/BurgmullerJFF/">Parent Directory</a></td></tr>
<tr><td><a href="?C=N;O=D">Name</a></td></tr>
<tr><td><a href="25EF-01/">25EF-01/</a></td></tr>
<tr><td><a href="25EF-02/">25EF-02/</a></td></tr>
</body></html>`;

const PIECE_INDEX = `<html><body>
<tr><td><a href="/ftp/BurgmullerJFF/O100/">Parent Directory</a></td></tr>
<tr><td><a href="25EF-01.ly">25EF-01.ly</a></td></tr>
<tr><td><a href="25EF-01.pdf">25EF-01.pdf</a></td></tr>
<tr><td><a href="25EF-01.mid">25EF-01.mid</a></td></tr>
</body></html>`;

describe('parseDirIndex', () => {
  it('returns piece directories only', () => {
    expect(parseDirIndex(DIR_INDEX)).toEqual(['25EF-01', '25EF-02']);
  });

  it('excludes the parent link and Apache sort links', () => {
    const got = parseDirIndex(DIR_INDEX);
    expect(got).not.toContain('..');
    expect(got.some((n) => n.includes('?'))).toBe(false);
    expect(got.some((n) => n.startsWith('/'))).toBe(false);
  });
});

describe('parseLyFiles', () => {
  it('picks .ly and ignores pdf/midi siblings', () => {
    expect(parseLyFiles(PIECE_INDEX)).toEqual(['25EF-01.ly']);
  });

  it('ignores absolute-path hrefs', () => {
    expect(parseLyFiles('<a href="/ftp/x/y.ly">y</a>')).toEqual([]);
  });
});

describe('cacheName / listCached', () => {
  it('flattens a source path reversibly', () => {
    expect(cacheName('BurgmullerJFF/O100/25EF-01/25EF-01.ly'))
      .toBe('BurgmullerJFF__O100__25EF-01__25EF-01.ly');
  });

  it('reconstructs sources offline and filters by set', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lycache-'));
    await fs.writeFile(path.join(dir, 'BurgmullerJFF__O100__25EF-01__25EF-01.ly'), 'x');
    await fs.writeFile(path.join(dir, 'ClementiM__O36__sonatina-1__sonatina-1.ly'), 'x');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x');

    const all = await listCached(dir);
    expect(all).toHaveLength(2);
    expect(all[0].sourcePath).toBe('BurgmullerJFF/O100/25EF-01/25EF-01.ly');

    const filtered = await listCached(dir, { composer: 'ClementiM', opus: 'O36' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sourceUrl).toContain('/ftp/ClementiM/O36/sonatina-1/sonatina-1.ly');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns nothing for a missing cache dir rather than throwing', async () => {
    expect(await listCached('/nonexistent/path/xyz')).toEqual([]);
  });
});
