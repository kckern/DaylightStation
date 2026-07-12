// tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsJamCorderArchive } from '#adapters/jamcorder/FsJamCorderArchive.mjs';

let dir;
const cfg = () => ({ getHouseholdPath: (rel) => path.join(dir, rel) });
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const ref = { listPath: '/JAMC/2026/s1/A.mid' };
const rel = '2026/2026-01/2026-01-02 18.17.40.mid';

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'jamc-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('FsJamCorderArchive', () => {
  it('saves the .mid at the nested rel path and records it in the index', async () => {
    const a = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    expect(a.has(ref)).toBe(false);
    await a.save(rel, Buffer.from('MThd-bytes'));
    await a.markProcessed(ref, rel);
    const full = path.join(dir, 'history/piano/jamcorder', rel);
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full).toString()).toBe('MThd-bytes');
    expect(a.has(ref)).toBe(true);
  });

  it('a fresh instance sees the persisted index (dedup across runs)', async () => {
    const a1 = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    await a1.save(rel, Buffer.from('x'));
    await a1.markProcessed(ref, rel);
    const a2 = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    expect(a2.has(ref)).toBe(true);
  });
});
