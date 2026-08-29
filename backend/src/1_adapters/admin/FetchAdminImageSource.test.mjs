import { describe, expect, it, vi } from 'vitest';
import { FetchAdminImageSource } from './FetchAdminImageSource.mjs';

describe('FetchAdminImageSource', () => {
  it('does not consume a failed response body', async () => {
    const arrayBuffer = vi.fn().mockRejectedValue(new Error('must not read'));
    const source = new FetchAdminImageSource({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'text/plain' }),
        arrayBuffer,
      }),
    });

    await expect(source.download('https://example.invalid/missing')).resolves.toEqual({
      ok: false,
      status: 404,
      contentType: 'text/plain',
      buffer: null,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('buffers successful image responses', async () => {
    const source = new FetchAdminImageSource({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
      }),
    });

    await expect(source.download('https://example.invalid/image')).resolves.toEqual({
      ok: true,
      status: 200,
      contentType: 'image/png',
      buffer: Buffer.from([1, 2, 3]),
    });
  });
});
