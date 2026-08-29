import { describe, expect, it, vi } from 'vitest';
import { FetchImageDownloader } from './FetchImageDownloader.mjs';

describe('FetchImageDownloader', () => {
  it('returns the response body bytes without changing legacy status handling', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    const downloader = new FetchImageDownloader({ fetchImpl });

    await expect(downloader.download('https://example.test/photo.jpg'))
      .resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/photo.jpg');
  });
});
