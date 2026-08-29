import { describe, expect, it, vi } from 'vitest';
import { HttpEinkDataSourceGateway } from './HttpEinkDataSourceGateway.mjs';

describe('HttpEinkDataSourceGateway', () => {
  it('preserves partial-source degradation and relative URL resolution', async () => {
    const logger = { warn: vi.fn() };
    const fetchImpl = vi.fn(async url => {
      if (url.endsWith('/bad')) throw new Error('503 Service Unavailable');
      return { ok: true, json: async () => ({ value: 1 }) };
    });
    const gateway = new HttpEinkDataSourceGateway({ baseUrl: 'http://daylight.test', fetchImpl });
    await expect(gateway.resolve({ good: { source: '/good' }, bad: { source: '/bad' } }, { logger }))
      .resolves.toEqual({ good: { value: 1 } });
    expect(fetchImpl).toHaveBeenCalledWith('http://daylight.test/good');
    expect(logger.warn).toHaveBeenCalledWith('eink.data.source_rejected', expect.objectContaining({ key: 'bad' }));
  });

  it('keeps JSON when optional image loading fails', async () => {
    const json = { imageUrl: '/photo.jpg', caption: 'hello' };
    const gateway = new HttpEinkDataSourceGateway({
      baseUrl: 'http://daylight.test',
      fetchImpl: async (url) => url.endsWith('/photo')
        ? { ok: true, json: async () => json }
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(0) },
      decodeImage: async () => { throw new Error('decode failed'); },
    });
    await expect(gateway.resolve({ photo: { source: '/photo', image: 'imageUrl' } }, { loadImages: true }))
      .resolves.toEqual({ photo: json });
    expect(json).not.toHaveProperty('imageEl');
  });

  it('owns panel scoping in the resolved URL', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new HttpEinkDataSourceGateway({ baseUrl: 'http://daylight.test', fetchImpl });
    await gateway.resolve({ photo: { source: '/photo?favorites=true' } }, { scopeKey: 'upstairs eink' });
    expect(fetchImpl).toHaveBeenCalledWith('http://daylight.test/photo?favorites=true&hold_key=upstairs%20eink');
  });
});
