import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HarvestMidiRecordings } from '#apps/midi/HarvestMidiRecordings.mjs';

const FIXTURE = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));
const refA = { recordingId: '/JAMC/2026/s1/A.mid' };
const refB = { recordingId: '/JAMC/2026/s1/B.mid' };

function fakeArchive(seen = new Set()) {
  const saved = [];
  return {
    saved,
    hasRecording: (recordingId) => seen.has(recordingId),
    archiveRecording: vi.fn(async (ref, artifact) => {
      if (artifact.toString() === 'garbage') throw new Error('invalid MIDI artifact');
      const relPath = '2026/2026-01/2026-01-02 18.17.40.mid';
      saved.push({ relPath, len: artifact.length });
      seen.add(ref.recordingId);
      return { archiveId: relPath };
    }),
  };
}
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('HarvestMidiRecordings', () => {
  it('downloads only new recordings and saves them at the derived path', async () => {
    const source = { listRecordings: async () => [refA, refB], fetchRecording: async () => FIXTURE };
    const archive = fakeArchive(new Set([refB.recordingId])); // B already processed
    const res = await new HarvestMidiRecordings({ source, archive, logger: silent }).execute();
    expect(res).toEqual({ count: 1, status: 'success' });
    expect(archive.archiveRecording).toHaveBeenCalledTimes(1);
    expect(archive.saved[0].relPath).toBe('2026/2026-01/2026-01-02 18.17.40.mid');
    expect(archive.archiveRecording).toHaveBeenCalledWith(refA, FIXTURE);
  });

  it('returns status error and writes nothing when listing fails', async () => {
    const source = { listRecordings: async () => { throw new Error('ECONNREFUSED'); }, fetchRecording: async () => FIXTURE };
    const archive = fakeArchive();
    const res = await new HarvestMidiRecordings({ source, archive, logger: silent }).execute();
    expect(res.status).toBe('error');
    expect(res.count).toBe(0);
    expect(archive.archiveRecording).not.toHaveBeenCalled();
  });

  it('skips an unparseable file without failing the run', async () => {
    const source = {
      listRecordings: async () => [refA, refB],
      fetchRecording: async (ref) => (ref === refA ? Buffer.from('garbage') : FIXTURE),
    };
    const archive = fakeArchive();
    const res = await new HarvestMidiRecordings({ source, archive, logger: silent }).execute();
    expect(res).toEqual({ count: 1, status: 'success' }); // only B saved
    expect(archive.archiveRecording).toHaveBeenCalledTimes(2);
  });
});
