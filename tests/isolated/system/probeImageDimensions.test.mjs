import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

describe('probeImageDimensions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns width and height for a valid JPEG', async () => {
    // Minimal JPEG: SOI + APP0 marker (2 bytes payload) + SOF0 marker with 100x200 dimensions
    const sof0 = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02,
      0xFF, 0xC0, 0x00, 0x0B, 0x08,
      0x00, 0xC8, // height = 200
      0x00, 0x64, // width = 100
      0x01, 0x01, 0x00,
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { [Symbol.asyncIterator]: async function* () { yield sof0; } },
    });

    const result = await probeImageDimensions('https://example.com/photo.jpg');
    expect(result).toEqual({ width: 100, height: 200 });
  });

  it('returns width and height for a valid PNG', async () => {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png, 0);
    png.writeUInt32BE(13, 8);       // IHDR chunk length
    Buffer.from('IHDR').copy(png, 12);
    png.writeUInt32BE(640, 16);     // width
    png.writeUInt32BE(480, 20);     // height

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { [Symbol.asyncIterator]: async function* () { yield png; } },
    });

    const result = await probeImageDimensions('https://example.com/photo.png');
    expect(result).toEqual({ width: 640, height: 480 });
  });

  it('returns null on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await probeImageDimensions('https://example.com/missing.jpg');
    expect(result).toBeNull();
  });

  it('returns null on timeout', async () => {
    // Mock fetch that respects the AbortSignal, like real fetch would
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });
    const result = await probeImageDimensions('https://example.com/slow.jpg', 50);
    expect(result).toBeNull();
  });

  it('returns null for non-image content', async () => {
    const html = Buffer.from('<html><body>Not an image</body></html>');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { [Symbol.asyncIterator]: async function* () { yield html; } },
    });

    const result = await probeImageDimensions('https://example.com/page.html');
    expect(result).toBeNull();
  });
});
