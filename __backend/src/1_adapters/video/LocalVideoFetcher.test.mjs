import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalVideoFetcher } from './LocalVideoFetcher.mjs';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-local-')); });

const downloader = (write = true) => ({
  downloadOne: vi.fn(async (_url, { outputPath }) => {
    if (!write) return { kind: 'failed', error: 'cancelled' };
    fs.writeFileSync(outputPath, 'video-bytes');
    return { kind: 'downloaded', filePath: outputPath, title: 'T', duration: 7 };
  }),
});

describe('LocalVideoFetcher', () => {
  it('fetches to its own folder and answers a media resource of the file', async () => {
    const f = new LocalVideoFetcher({ downloader: downloader(), dir, logger: { warn() {}, info() {} } });
    const out = await f.fetch('u', { name: 's000000000001', maxHeight: 720 });
    expect(out).toMatchObject({ kind: 'downloaded', title: 'T', duration: 7 });
    expect(out.media.size).toBe(11);
    expect(await f.stored('s000000000001')).toMatchObject({ title: 'T', duration: 7 });
  });

  it('passes a cancelled download on as cancelled', async () => {
    const f = new LocalVideoFetcher({ downloader: downloader(false), dir });
    expect(await f.fetch('u', { name: 's000000000001' })).toMatchObject({ kind: 'failed', reason: 'cancelled' });
  });

  it('cancel deletes the files, and the sweep only old ones', async () => {
    let now = 10_000_000_000_000;
    const f = new LocalVideoFetcher({ downloader: downloader(), dir, clock: () => now, logger: { warn() {}, info() {} } });
    await f.fetch('u', { name: 's000000000001' });
    await f.fetch('u', { name: 's000000000002' });
    await f.cancel('s000000000001');
    expect(await f.stored('s000000000001')).toBeNull();
    expect(f.sweep({ maxAgeMs: 1 })).toBe(2);
    expect(await f.stored('s000000000002')).toBeNull();
  });
});
