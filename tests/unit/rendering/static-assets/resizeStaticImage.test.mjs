import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadImage = vi.fn(async () => ({ width: 10, height: 10 }));
const toBuffer = vi.fn(() => Buffer.from('resized'));

vi.mock('canvas', () => ({
  loadImage,
  createCanvas: vi.fn(() => ({
    getContext: () => ({ drawImage: vi.fn() }),
    toBuffer,
  })),
}));

const { resizeStaticImage } = await import('#rendering/static-assets/resizeStaticImage.mjs');

describe('resizeStaticImage cache identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not collide distinct resources with equal size and mtime', async () => {
    const shared = { buffer: Buffer.from('same-size'), size: 9, mtimeMs: 42, contentType: 'image/jpeg' };
    await resizeStaticImage({ ...shared, identity: 'one.jpg' }, { width: 5, height: null });
    await resizeStaticImage({ ...shared, identity: 'two.jpg' }, { width: 5, height: null });
    expect(loadImage).toHaveBeenCalledTimes(2);
  });
});
