import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HarvestJamCorderRecordings } from '#apps/jamcorder/HarvestJamCorderRecordings.mjs';

const FIXTURE = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));
const refA = { listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' };
const refB = { listPath: '/JAMC/2026/s1/B.mid', downloadPath: '/sdcard/JAMC/2026/s1/B.mid' };

function fakeArchive(seen = new Set()) {
  const saved = [];
  return {
    saved,
    has: (ref) => seen.has(ref.listPath),
    save: vi.fn(async (relPath, buf) => { saved.push({ relPath, len: buf.length }); }),
    markProcessed: vi.fn(async (ref) => { seen.add(ref.listPath); }),
  };
}
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('HarvestJamCorderRecordings', () => {
  it('downloads only new recordings and saves them at the derived path', async () => {
    const source = { listRecordings: async () => [refA, refB], download: async () => FIXTURE };
    const archive = fakeArchive(new Set([refB.listPath])); // B already processed
    const res = await new HarvestJamCorderRecordings({ source, archive, logger: silent }).execute();
    expect(res).toEqual({ count: 1, status: 'success' });
    expect(archive.save).toHaveBeenCalledTimes(1);
    expect(archive.saved[0].relPath).toBe('2026/2026-01/2026-01-02 18.17.40.mid');
    expect(archive.markProcessed).toHaveBeenCalledWith(refA, '2026/2026-01/2026-01-02 18.17.40.mid');
  });

  it('returns status error and writes nothing when listing fails', async () => {
    const source = { listRecordings: async () => { throw new Error('ECONNREFUSED'); }, download: async () => FIXTURE };
    const archive = fakeArchive();
    const res = await new HarvestJamCorderRecordings({ source, archive, logger: silent }).execute();
    expect(res.status).toBe('error');
    expect(res.count).toBe(0);
    expect(archive.save).not.toHaveBeenCalled();
  });

  it('skips an unparseable file without failing the run', async () => {
    const source = {
      listRecordings: async () => [refA, refB],
      download: async (ref) => (ref === refA ? Buffer.from('garbage') : FIXTURE),
    };
    const archive = fakeArchive();
    const res = await new HarvestJamCorderRecordings({ source, archive, logger: silent }).execute();
    expect(res).toEqual({ count: 1, status: 'success' }); // only B saved
    expect(archive.save).toHaveBeenCalledTimes(1);
  });
});
