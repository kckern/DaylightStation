import { describe, expect, it, vi } from 'vitest';
import { AdminImageService } from '#apps/admin/AdminImageService.mjs';

function service(overrides = {}) {
  const store = {
    list: vi.fn(() => []),
    save: vi.fn(({ id, extension }) => ({ filename: `${id}.${extension}`, path: `/media/img/lists/${id}.${extension}` })),
  };
  const source = { download: vi.fn() };
  return {
    store,
    source,
    service: new AdminImageService({ store, source, createId: () => 'fixed-id', logger: {}, ...overrides }),
  };
}

describe('AdminImageService', () => {
  it('preserves upload response fields and extension mapping', () => {
    const { service: images, store } = service();
    expect(images.upload({ buffer: Buffer.from('x'), mimeType: 'image/jpeg', size: 1 })).toEqual({
      path: '/media/img/lists/fixed-id.jpg', size: 1, type: 'image/jpeg',
    });
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'fixed-id', extension: 'jpg' }));
  });

  it('preserves URL content-type validation and 5 MiB rejection payload', async () => {
    const { service: images, source } = service();
    source.download.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'image/png; charset=binary',
      buffer: Buffer.alloc(images.maxFileSize + 1),
    });
    await expect(images.uploadFromUrl('https://example.test/image')).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Image too large',
      limit: 5 * 1024 * 1024,
    });
  });
});
