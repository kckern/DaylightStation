/**
 * FilesystemWorkImageCache — rendered work pages on the media mount under
 * `school/beeloo-pages/`. A miss reads as null; a key that could leave the
 * directory is refused.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FilesystemWorkImageCache } from '../../../../__app_modules/learning/school/server/adapters/persistence/FilesystemWorkImageCache.mjs';

let tmp, cache;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-work-image-'));
  cache = new FilesystemWorkImageCache({ mediaBasePath: tmp });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('FilesystemWorkImageCache', () => {
  it('reads a miss as null', async () => {
    expect(await cache.read('beeloo-x1.png')).toBeNull();
  });

  it('writes under school/beeloo-pages and reads the bytes back', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await cache.write('beeloo-x1.png', bytes);
    const file = path.join(tmp, 'school', 'beeloo-pages', 'beeloo-x1.png');
    expect(fs.existsSync(file)).toBe(true);
    const hit = await cache.read('beeloo-x1.png');
    expect(Buffer.isBuffer(hit)).toBe(true);
    expect(hit.equals(bytes)).toBe(true);
    // No staging file left beside it.
    expect(fs.readdirSync(path.dirname(file))).toEqual(['beeloo-x1.png']);
  });

  it.each(['../escape.png', 'a/b.png', 'x.jpg', '.png', 'x y.png', ''])('refuses the key %j', async (key) => {
    await expect(cache.read(key)).rejects.toThrow(/key/);
    await expect(cache.write(key, Buffer.from('x'))).rejects.toThrow(/key/);
  });

  it('requires a media base path', () => {
    expect(() => new FilesystemWorkImageCache({})).toThrow(/mediaBasePath/);
  });
});
