// @vitest-environment node
// CameraClipLibrary.test.mjs
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CameraClipLibrary } from './CameraClipLibrary.mjs';

const NAME = 'Mp4Record/2026-10-27/RecS07_20261027_233456_233522_0_3914808000_10AF19.mp4';
let dir; afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const lib = ({ ledger = [], search = vi.fn().mockResolvedValue([]), fetch = vi.fn(async ({ destPath }) => { writeFileSync(destPath, 'mp4'); return 3; }) } = {}) => {
  dir = mkdtempSync(path.join(tmpdir(), 'clips-'));
  return { library: new CameraClipLibrary({ ledgerStore: { read: () => ledger }, openSource: () => ({ search, fetch }), cacheDir: dir, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }), search, fetch };
};

describe('CameraClipLibrary', () => {
  it('lists ledger clips that have a recording', async () => {
    const { library, search } = lib({ ledger: [{ ts: '2026-10-28T06:34:56.000Z', endTs: '2026-10-28T06:35:22.000Z', labels: ['visitor'], clip: { name: NAME } }, { ts: 'x', endTs: 'y', labels: [] }] });
    expect(await library.listClips({ cameraId: 'cam', day: '2026-10-27' })).toEqual([{ start: '2026-10-28T06:34:56.000Z', end: '2026-10-28T06:35:22.000Z', name: NAME, labels: ['visitor'] }]);
    expect(search).not.toHaveBeenCalled();
  });
  it('searches the camera when the ledger has nothing for the day, and survives a failed search', async () => {
    const search = vi.fn().mockRejectedValue(new Error('Search timeout'));
    expect(await lib({ search }).library.listClips({ cameraId: 'cam', day: '2026-10-28' })).toEqual([]);
  });
  it('fetches a clip once and serves it from the cache', async () => {
    const { library, fetch } = lib();
    const a = await library.openClip({ cameraId: 'cam', name: NAME });
    await library.openClip({ cameraId: 'cam', name: NAME });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.mimeType).toBe('video/mp4');
    expect(existsSync(path.join(dir, 'cam', path.basename(NAME)))).toBe(true);
  });
  it('refuses a name that is not a camera recording', async () => {
    await expect(lib().library.openClip({ cameraId: 'cam', name: '../../etc/passwd' })).rejects.toMatchObject({ name: 'ValidationError' });
  });
  it('keeps no cached file when a fetch fails, so the next open retries', async () => {
    const fetch = vi.fn()
      .mockImplementationOnce(async ({ destPath }) => { writeFileSync(destPath, 'partial'); throw new Error('Download HTTP 500'); })
      .mockImplementationOnce(async ({ destPath }) => { writeFileSync(destPath, 'mp4'); return 3; });
    const { library } = lib({ fetch });
    await expect(library.openClip({ cameraId: 'cam', name: NAME })).rejects.toThrow('Download HTTP 500');
    expect(existsSync(path.join(dir, 'cam', path.basename(NAME)))).toBe(false);
    await library.openClip({ cameraId: 'cam', name: NAME });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('prunes the cache to the newest maxCached clips', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-'));
    const fetch = vi.fn(async ({ destPath }) => { writeFileSync(destPath, 'mp4'); return 3; });
    const library = new CameraClipLibrary({ ledgerStore: { read: () => [] }, openSource: () => ({ search: vi.fn(), fetch }), cacheDir: dir, maxCached: 2, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } });
    for (const n of ['a', 'b', 'c']) {
      await library.openClip({ cameraId: 'cam', name: `Mp4Record/2026-10-27/${n}.mp4` });
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(['a', 'b', 'c'].map((n) => existsSync(path.join(dir, 'cam', `${n}.mp4`)))).toEqual([false, true, true]);
  });
  it('maps a camera search through toClip, ascending, and caches it for the day', async () => {
    const t = (hour, min) => ({ year: 2026, mon: 10, day: 28, hour, min, sec: 0 });
    const search = vi.fn().mockResolvedValue([
      { StartTime: t(9, 0), EndTime: t(9, 1), size: '100', name: 'Mp4Record/2026-10-28/b.mp4' },
      { StartTime: t(8, 0), EndTime: t(8, 1), size: '100', name: 'Mp4Record/2026-10-28/a.mp4' },
      { StartTime: t(7, 0), EndTime: t(7, 1), size: '100' },
    ]);
    const { library } = lib({ search });
    const clips = await library.listClips({ cameraId: 'cam', day: '2026-10-28' });
    expect(clips.map((c) => c.name)).toEqual(['Mp4Record/2026-10-28/a.mp4', 'Mp4Record/2026-10-28/b.mp4']);
    expect(clips[0]).toEqual({ start: new Date(2026, 9, 28, 8, 0, 0).toISOString(), end: new Date(2026, 9, 28, 8, 1, 0).toISOString(), name: 'Mp4Record/2026-10-28/a.mp4', labels: [] });
    await library.listClips({ cameraId: 'cam', day: '2026-10-28' });
    expect(search).toHaveBeenCalledTimes(1);
  });
});
