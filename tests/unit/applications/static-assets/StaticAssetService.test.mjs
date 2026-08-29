import { describe, expect, it, vi } from 'vitest';
import { StaticAssetService } from '#apps/static-assets/StaticAssetService.mjs';
import { IStaticImageRepository } from '#apps/static-assets/ports/IStaticImageRepository.mjs';

class Repository extends IStaticImageRepository {
  constructor(image) { super(); this.image = image; }
  async getImage() { return this.image; }
}

describe('StaticAssetService', () => {
  it('falls back to the original image when resizing fails', async () => {
    const image = {
      identity: 'photos/original.jpg', buffer: Buffer.from('original'), size: 8,
      mtimeMs: 1, contentType: 'image/jpeg',
    };
    const logger = { warn: vi.fn() };
    const service = new StaticAssetService({
      repository: new Repository(image),
      resizeImage: vi.fn().mockRejectedValue(new Error('decoder failed')),
      logger,
    });

    await expect(service.getImage({ kind: 'image', id: 'photos/original.jpg', width: 100 }))
      .resolves.toBe(image);
    expect(logger.warn).toHaveBeenCalledWith('static.img.resize_failed', {
      image: image.identity,
      error: 'decoder failed',
    });
  });
});
