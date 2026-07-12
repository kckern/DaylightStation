// tests/isolated/adapter/jamcorder/HttpJamCorderSource.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HttpJamCorderSource } from '#adapters/jamcorder/HttpJamCorderSource.mjs';

// Fake device tree: /JAMC → 2026/ → s1/ → A.mid, B.mid (+ a non-mid file ignored)
const TREE = {
  '/JAMC': [{ filename: '2026/', isDirectory: true }, { filename: 'other/', isDirectory: true }],
  '/JAMC/2026': [{ filename: 's1/', isDirectory: true }],
  '/JAMC/2026/s1': [
    { filename: 'A.mid', isDirectory: false },
    { filename: 'B.mid', isDirectory: false },
    { filename: 'notes.txt', isDirectory: false },
  ],
  '/JAMC/other': [],
};

function fakeHttp() {
  return {
    requestRaw: vi.fn(async (_method, _url, { body }) => {
      const files = TREE[body.filepath] ?? [];
      return { ok: true, status: 200, data: { dir: body.filepath + '/', files } };
    }),
    downloadBuffer: vi.fn(async (url) => Buffer.from('MID:' + url)),
  };
}
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('HttpJamCorderSource', () => {
  it('recursively enumerates .mid files with list + download paths', async () => {
    const src = new HttpJamCorderSource({ httpClient: fakeHttp(), host: '10.0.0.244', logger: silent });
    const refs = await src.listRecordings();
    expect(refs).toEqual([
      { listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' },
      { listPath: '/JAMC/2026/s1/B.mid', downloadPath: '/sdcard/JAMC/2026/s1/B.mid' },
    ]);
  });

  it('downloads via the /sdcard URL and returns the buffer', async () => {
    const http = fakeHttp();
    const src = new HttpJamCorderSource({ httpClient: http, host: '10.0.0.244', logger: silent });
    const buf = await src.download({ listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' });
    expect(http.downloadBuffer).toHaveBeenCalledWith('http://10.0.0.244/sdcard/JAMC/2026/s1/A.mid');
    expect(buf.toString()).toBe('MID:http://10.0.0.244/sdcard/JAMC/2026/s1/A.mid');
  });

  it('throws when a directory listing is not ok (surfaced to the use case)', async () => {
    const http = fakeHttp();
    http.requestRaw = vi.fn(async () => ({ ok: false, status: 500, data: null }));
    const src = new HttpJamCorderSource({ httpClient: http, host: '10.0.0.244', logger: silent });
    await expect(src.listRecordings()).rejects.toThrow();
  });
});
