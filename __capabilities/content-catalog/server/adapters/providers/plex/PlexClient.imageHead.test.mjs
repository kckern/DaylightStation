import { describe, it, expect, vi } from 'vitest';
import { PlexClient } from './PlexClient.mjs';

describe('PlexClient.imageHead', () => {
  it('works with an axios-style client (production wiring has no requestRaw)', async () => {
    const get = vi.fn(async () => ({ status: 206, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer }));
    const c = new PlexClient({ host: 'http://plex:32400', token: 't' }, { httpClient: { get, put: vi.fn() } });
    const buf = await c.imageHead('/library/metadata/1/clearLogo');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(get.mock.calls[0][1]).toMatchObject({ responseType: 'arraybuffer', headers: { Range: expect.stringMatching(/^bytes=0-/) } });
  });
  it('still uses requestRaw when the client has it', async () => {
    const requestRaw = vi.fn(async () => ({ data: Buffer.from([1, 2]) }));
    const c = new PlexClient({ host: 'http://plex:32400', token: 't' }, { httpClient: { requestRaw, get: vi.fn() } });
    expect([...(await c.imageHead('https://x/y.png'))]).toEqual([1, 2]);
  });
});
