import { describe, expect, it, vi } from 'vitest';
import { LibbyCoverService } from './LibbyCoverService.mjs';

describe('LibbyCoverService', () => {
  it.each([
    ['LIBBY_LOAN_NOT_FOUND', 'gone'], ['LIBBY_LOAN_EXPIRED', 'gone'],
    ['LIBBY_CREDENTIAL_UNAVAILABLE', 'credential_unavailable'],
    ['LIBBY_CREDENTIAL_REJECTED', 'upstream_error'], ['LIBBY_PROVIDER_FAILED', 'upstream_error'],
    ['LIBBY_ORIGIN_REJECTED', 'upstream_error'], [undefined, 'upstream_error'],
  ])('maps gateway failure %s to %s without provider details', async (code, kind) => {
    const service = new LibbyCoverService({ coverGateway: { openCover: async () => { throw Object.assign(new Error('private provider detail'), { code }); } } });
    await expect(service.open({ cardId: '1', titleId: '2' })).resolves.toEqual({ kind });
  });

  it('maps cancellation to upstream_error', async () => {
    const service = new LibbyCoverService({ coverGateway: { openCover: async () => { throw new DOMException('Aborted', 'AbortError'); } } });
    await expect(service.open({})).resolves.toEqual({ kind: 'upstream_error' });
  });

  it('returns the neutral stream capability and passes identity and signal to the gateway', async () => {
    const body = new Response('image').body;
    const cleanup = vi.fn();
    const openCover = vi.fn(async () => ({ body, contentType: 'image/jpeg', contentLength: '5', cleanup, coverUrl: 'private provider URL' }));
    const service = new LibbyCoverService({ coverGateway: { openCover } });
    const input = { cardId: '1', titleId: '2', signal: new AbortController().signal };
    const result = await service.open(input);
    expect(result).toEqual({ kind: 'opened', body, contentType: 'image/jpeg', contentLength: '5', cleanup });
    expect(openCover).toHaveBeenCalledWith(input);
    expect(await new Response(result.body).text()).toBe('image');
  });
});
