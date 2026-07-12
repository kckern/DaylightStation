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

// The composition root injects `axios` into harvesters: `.post(url, body, config)`
// and `.get(url, config)`, returning `{ status, data }`, throwing on non-2xx.
function fakeHttp() {
  return {
    post: vi.fn(async (_url, body, _config) => {
      const files = TREE[body.filepath] ?? [];
      return { status: 200, data: { dir: body.filepath + '/', files } };
    }),
    get: vi.fn(async (url, _config) => ({ status: 200, data: Buffer.from('MID:' + url) })),
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

  it('downloads via the /sdcard URL using the injected binaryGet (insecure-parser seam)', async () => {
    const binaryGet = vi.fn(async (url) => Buffer.from('MID:' + url));
    const src = new HttpJamCorderSource({ httpClient: fakeHttp(), host: '10.0.0.244', logger: silent, binaryGet });
    const buf = await src.download({ listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' });
    expect(binaryGet).toHaveBeenCalledWith('http://10.0.0.244/sdcard/JAMC/2026/s1/A.mid');
    expect(buf.toString()).toBe('MID:http://10.0.0.244/sdcard/JAMC/2026/s1/A.mid');
  });

  it('propagates a listing failure (axios throws on non-2xx/offline) to the use case', async () => {
    const http = fakeHttp();
    http.post = vi.fn(async () => { throw new Error('Request failed with status code 500'); });
    const src = new HttpJamCorderSource({ httpClient: http, host: '10.0.0.244', logger: silent });
    await expect(src.listRecordings()).rejects.toThrow();
  });
});
