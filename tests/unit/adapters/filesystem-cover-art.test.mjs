// tests/unit/adapters/filesystem-cover-art.unit.test.mjs
import { jest } from '@jest/globals';
import { FilesystemAdapter } from '../../../backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('FilesystemAdapter.getCoverArt', () => {
  let adapter;

  beforeEach(() => {
    adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });
  });

  test('returns null when file not found (resolvePath returns null)', async () => {
    const result = await adapter.getCoverArt('nonexistent/file.mp3');
    expect(result).toBeNull();
  });

  test('returns null when no picture in metadata', async () => {
    adapter._parseFile = jest.fn().mockResolvedValue({
      common: {
        title: 'Test Song',
        artist: 'Test Artist'
        // no picture field
      }
    });

    const result = await adapter.getCoverArt('audio/test.mp3');
    expect(result).toBeNull();
  });

  test('returns null when picture array is empty', async () => {
    adapter._parseFile = jest.fn().mockResolvedValue({
      common: {
        picture: []
      }
    });

    const result = await adapter.getCoverArt('audio/test.mp3');
    expect(result).toBeNull();
  });

  test('returns buffer and mimeType when picture exists', async () => {
    const testImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
    adapter._parseFile = jest.fn().mockResolvedValue({
      common: {
        picture: [{
          data: testImageData,
          format: 'image/png'
        }]
      }
    });

    const result = await adapter.getCoverArt('audio/test.mp3');

    expect(result).not.toBeNull();
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.equals(Buffer.from(testImageData))).toBe(true);
    expect(result.mimeType).toBe('image/png');
  });

  test('returns first picture when multiple exist', async () => {
    const firstImageData = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic bytes
    const secondImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes

    adapter._parseFile = jest.fn().mockResolvedValue({
      common: {
        picture: [
          { data: firstImageData, format: 'image/jpeg' },
          { data: secondImageData, format: 'image/png' }
        ]
      }
    });

    const result = await adapter.getCoverArt('audio/test.mp3');

    expect(result).not.toBeNull();
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer.equals(Buffer.from(firstImageData))).toBe(true);
  });

  test('returns null on parse error', async () => {
    adapter._parseFile = jest.fn().mockRejectedValue(new Error('Cannot parse file'));

    const result = await adapter.getCoverArt('audio/test.mp3');
    expect(result).toBeNull();
  });

  test('handles undefined common object gracefully', async () => {
    adapter._parseFile = jest.fn().mockResolvedValue({});

    const result = await adapter.getCoverArt('audio/test.mp3');
    expect(result).toBeNull();
  });

  test('handles null metadata gracefully', async () => {
    adapter._parseFile = jest.fn().mockResolvedValue(null);

    const result = await adapter.getCoverArt('audio/test.mp3');
    expect(result).toBeNull();
  });
});
