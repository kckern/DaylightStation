import { describe, expect, it, vi } from 'vitest';
import { LibbyAdapter } from './LibbyAdapter.mjs';

const loan = Object.freeze({
  cardId: '123456789', titleId: '9999999', title: 'A Test Book', subtitle: 'A Subtitle', author: 'Author', narrator: 'Narrator',
  description: 'A book', thumbnail: null, expiresAt: Date.parse('2026-10-01T00:00:00Z'),
  parts: Object.freeze([
    Object.freeze({ key: 'part-a', index: 0, title: 'Part 1', duration: 61.5, contentLength: 1234, mimeType: 'audio/mpeg', upstreamUrl: 'https://od-cdn.com/a.mp3', headers: Object.freeze({}) }),
    Object.freeze({ key: 'part-b', index: 1, title: 'Part 2', duration: 42, contentLength: 900, mimeType: 'audio/mpeg', upstreamUrl: 'https://od-cdn.com/b.mp3', headers: Object.freeze({}) }),
  ]),
});

function adapter() {
  const issue = vi.fn(({ part }) => ({ handle: `handle-${part.key}` }));
  return {
    issue,
    value: new LibbyAdapter({
      client: { openLoan: vi.fn(async () => loan) },
      leases: { issue },
      proxyPath: '/api/v1/proxy/libby/stream',
    }),
  };
}

describe('LibbyAdapter', () => {
  it('exposes the explicit open-link identity as a queueable audiobook container', async () => {
    const { value } = adapter();
    const item = await value.getItem('loan/123456789/9999999');
    expect(item).toMatchObject({
      id: 'libby:loan/123456789/9999999', source: 'libby', title: 'A Test Book',
      itemType: 'container', childCount: 2, mediaType: 'audio',
    });
    expect(value.getCapabilities(item)).toEqual(['listable', 'queueable']);
  });

  it('resolves durable child IDs to opaque per-part lease URLs in spine order', async () => {
    const { value, issue } = adapter();
    const parts = await value.resolvePlayables('loan/123456789/9999999');
    expect(parts.map((part) => ({ id: part.id, mediaUrl: part.mediaUrl, duration: part.duration }))).toEqual([
      { id: 'libby:loan/123456789/9999999/part/part-a', mediaUrl: '/api/v1/proxy/libby/stream/handle-part-a', duration: 61.5 },
      { id: 'libby:loan/123456789/9999999/part/part-b', mediaUrl: '/api/v1/proxy/libby/stream/handle-part-b', duration: 42 },
    ]);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('publishes opaque artwork identity and fulfillment metadata on the book and parts', async () => {
    const { value } = adapter();
    const book = await value.getItem('loan/123456789/9999999');
    const parts = await value.resolvePlayables('loan/123456789/9999999');

    expect(book).toMatchObject({
      title: 'A Test Book',
      thumbnail: '/api/v1/proxy/libby/cover/123456789/9999999',
      metadata: { subtitle: 'A Subtitle', author: 'Author', narrator: 'Narrator' },
    });
    expect(parts[0]).toMatchObject({
      thumbnail: '/api/v1/proxy/libby/cover/123456789/9999999',
      metadata: { subtitle: 'A Subtitle', parentTitle: 'A Test Book', partIndex: 0 },
    });
    expect(JSON.stringify([book, ...parts])).not.toContain('od-cdn.com');
  });

  it('resolves a durable child ID without permitting a client-controlled upstream URL', async () => {
    const { value } = adapter();
    const part = await value.getItem('loan/123456789/9999999/part/part-b');
    expect(part).toMatchObject({
      id: 'libby:loan/123456789/9999999/part/part-b', mediaType: 'audio', resumable: true,
      mediaUrl: '/api/v1/proxy/libby/stream/handle-part-b',
    });
    expect(JSON.stringify(part)).not.toContain('listen.libbyapp.com');
  });

  it('fails closed for malformed IDs and unknown part keys', async () => {
    const { value, issue } = adapter();
    await expect(value.getItem('https://listen.libbyapp.com/a.mp3')).resolves.toBeNull();
    await expect(value.getItem('loan/123456789/9999999/part/missing')).resolves.toBeNull();
    expect(issue).not.toHaveBeenCalled();
  });
});
