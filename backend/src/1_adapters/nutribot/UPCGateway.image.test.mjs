import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { UPCGateway, PLACEHOLDER_IMAGE_SHA256, isPlaceholderImage } from './UPCGateway.mjs';

const jpeg = (tail) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.from(tail)]);
const sha = b => createHash('sha256').update(b).digest('hex');
const quietLogger = () => ({ debug() {}, info: vi.fn(), warn() {}, error() {} });

describe('UPCGateway.fetchImage', () => {
  it('refuses a known placeholder image', async () => {
    const placeholder = jpeg('coming soon');
    const logger = quietLogger();
    const gw = new UPCGateway({ httpClient: { downloadBuffer: vi.fn(async () => placeholder) }, logger,
      placeholderDigests: [sha(placeholder)] });
    expect(await gw.fetchImage('https://images.barcodespider.com/upcimage/1.jpg')).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('upc.image.placeholder', expect.any(Object));
  });
  it('keeps a real product image', async () => {
    const real = jpeg('a real can');
    const gw = new UPCGateway({ httpClient: { downloadBuffer: vi.fn(async () => real) }, logger: quietLogger(), placeholderDigests: [] });
    expect(await gw.fetchImage('https://x/y.jpg')).toEqual(real);
  });
  it('refuses the barcodespider "image coming soon" file by default', () => {
    expect(PLACEHOLDER_IMAGE_SHA256).toContain('ab815c08e2dae4cfb52c02471fdbcf5169c853dcfe8b0a05bc87dc877e3af055');
  });
});

describe('isPlaceholderImage', () => {
  it('matches a buffer whose digest is in the list', () => {
    const buffer = jpeg('stock');
    expect(isPlaceholderImage(buffer, [sha(buffer)])).toBe(true);
    expect(isPlaceholderImage(buffer, new Set([sha(buffer)]))).toBe(true);
    expect(isPlaceholderImage(jpeg('other'), [sha(buffer)])).toBe(false);
  });
});
