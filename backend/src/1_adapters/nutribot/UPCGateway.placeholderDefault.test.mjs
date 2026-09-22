import { describe, it, expect, vi } from 'vitest';

// The real 4,944-byte barcodespider file is not committed, so every digest is
// forced to the known placeholder's. That proves the DEFAULT list is wired into
// both the helper and a gateway built without `placeholderDigests`.
vi.mock('node:crypto', async importOriginal => {
  const real = await importOriginal();
  return { ...real, createHash: () => ({ update() { return this; },
    digest: () => 'ab815c08e2dae4cfb52c02471fdbcf5169c853dcfe8b0a05bc87dc877e3af055' }) };
});

const { UPCGateway, isPlaceholderImage } = await import('./UPCGateway.mjs');
const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0x00]);

describe('placeholder refusal defaults', () => {
  it('isPlaceholderImage consults PLACEHOLDER_IMAGE_SHA256 when no list is given', () => {
    expect(isPlaceholderImage(jpeg)).toBe(true);
  });
  it('a gateway built without placeholderDigests refuses the barcodespider file', async () => {
    const logger = { debug() {}, info: vi.fn(), warn() {}, error() {} };
    const gw = new UPCGateway({ httpClient: { downloadBuffer: vi.fn(async () => jpeg) }, logger });
    expect(await gw.fetchImage('https://images.barcodespider.com/upcimage/1.jpg')).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('upc.image.placeholder', expect.any(Object));
  });
});
