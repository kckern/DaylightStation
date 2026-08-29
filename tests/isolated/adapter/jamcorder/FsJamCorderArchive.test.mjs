// tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsJamCorderArchive } from '#adapters/jamcorder/FsJamCorderArchive.mjs';

let dir;
const cfg = () => ({ getMediaDir: () => dir });
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const ref = { recordingId: '/JAMC/2026/s1/A.mid' };
const rel = '2026/2026-01/2026-01-02 18.17.40.mid';

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'jamc-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('FsJamCorderArchive', () => {
  it('saves the .mid at the nested rel path and records it in the index', async () => {
    const a = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    expect(a.hasRecording(ref.recordingId)).toBe(false);
    const fixture = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));
    const receipt = await a.archiveRecording(ref, fixture);
    expect(receipt.archiveId).toBe(rel);
    const full = path.join(dir, 'midi/piano/log/jamcorder', rel);
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full)).toEqual(fixture);
    expect(a.hasRecording(ref.recordingId)).toBe(true);
  });

  it('a fresh instance sees the persisted index (dedup across runs)', async () => {
    const a1 = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    const fixture = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));
    await a1.archiveRecording(ref, fixture);
    const a2 = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    expect(a2.hasRecording(ref.recordingId)).toBe(true);
  });
});
