import { describe, expect, it, vi } from 'vitest';
import { LibbyStreamGateway } from './LibbyStreamGateway.mjs';

describe('LibbyStreamGateway', () => {
  it('follows only approved HTTPS redirects and strips credentials across origins', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://audioclips.cdn.overdrive.com/audio.mp3' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206, headers: {
        'content-type': 'audio/mpeg', 'content-length': '1', 'content-range': 'bytes 0-0/1', 'accept-ranges': 'bytes',
      } }));
    const gateway = new LibbyStreamGateway({ fetch, allowedHosts: ['.listen.libbyapp.com', 'audioclips.cdn.overdrive.com'] });

    const result = await gateway.open({
      source: { upstreamUrl: 'https://book.listen.libbyapp.com/part.mp3', headers: { Cookie: 'secret', Authorization: 'secret' }, mimeType: 'audio/mpeg' },
      method: 'GET', range: 'bytes=0-0',
    });

    expect(result).toMatchObject({ kind: 'opened', status: 206, contentType: 'audio/mpeg', contentLength: '1', contentRange: 'bytes 0-0/1' });
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Cookie: 'secret', Authorization: 'secret', Range: 'bytes=0-0' } });
    expect(fetch.mock.calls[1][1].headers).toEqual({ Range: 'bytes=0-0' });
  });

  it('translates forbidden origins, provider status, and unsatisfiable ranges categorically', async () => {
    const fetch = vi.fn();
    const gateway = new LibbyStreamGateway({ fetch, allowedHosts: ['.listen.libbyapp.com'] });
    await expect(gateway.open({ source: { upstreamUrl: 'https://evil.example/audio.mp3' } })).resolves.toEqual({ kind: 'upstream_error', reason: 'forbidden_origin' });
    expect(fetch).not.toHaveBeenCalled();

    fetch.mockResolvedValueOnce(new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } }));
    await expect(gateway.open({ source: { upstreamUrl: 'https://book.listen.libbyapp.com/audio.mp3' } })).resolves.toEqual({ kind: 'range_not_satisfiable', contentRange: 'bytes */10' });

    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(gateway.open({ source: { upstreamUrl: 'https://book.listen.libbyapp.com/audio.mp3' } })).resolves.toEqual({ kind: 'upstream_error', reason: 'provider_status' });
  });

  it('returns unauthorized without exposing provider status and honors cancellation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }));
    const gateway = new LibbyStreamGateway({ fetch, allowedHosts: ['.listen.libbyapp.com'] });
    await expect(gateway.open({ source: { upstreamUrl: 'https://book.listen.libbyapp.com/audio.mp3' } })).resolves.toEqual({ kind: 'unauthorized' });
    const controller = new AbortController(); controller.abort();
    await expect(gateway.open({ source: { upstreamUrl: 'https://book.listen.libbyapp.com/audio.mp3' }, signal: controller.signal })).resolves.toEqual({ kind: 'upstream_error', reason: 'cancelled' });
  });
});
