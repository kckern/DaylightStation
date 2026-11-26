import { describe, it, expect, vi } from 'vitest';
import { youtubeVideoIdFrom, YouTubeSharedVideoSource } from './YouTubeSharedVideoSource.mjs';

describe('youtubeVideoIdFrom', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=xyz', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s', (url, id) => {
    expect(youtubeVideoIdFrom(url)?.value).toBe(id);
  });

  it.each([
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/playlist?list=PL123',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ$(x)',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(youtubeVideoIdFrom(url)).toBeNull();
  });
});

describe('YouTubeSharedVideoSource', () => {
  const chain = () => ({
    fetch: vi.fn(async () => ({ kind: 'downloaded', title: 't', duration: 1, media: {} })),
    stored: vi.fn(async () => ({ title: 'k', duration: 2, media: {} })),
    cancel: vi.fn(async () => {}),
  });

  it('recognises a link as the youtube provider and its id', () => {
    const source = new YouTubeSharedVideoSource({ fetcher: chain() });
    expect(source.recognize('https://youtu.be/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', sourceId: 'dQw4w9WgXcQ' });
    expect(source.recognize('https://example.com/x')).toBeNull();
  });

  it('fetches from the watch URL rebuilt from the id, never the shared text', async () => {
    const fetcher = chain();
    const source = new YouTubeSharedVideoSource({ fetcher });
    await source.fetch('dQw4w9WgXcQ', { name: 's000000000001' });
    expect(fetcher.fetch).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', expect.objectContaining({ name: 's000000000001', signal: expect.any(AbortSignal) }));
    expect(await source.fetch('bad id!', {})).toMatchObject({ kind: 'failed' });
  });

  it('cancel aborts its running fetch and cancels in the chain', async () => {
    const fetcher = chain();
    let seen;
    fetcher.fetch.mockImplementation(async (_u, { signal }) => { seen = signal; await new Promise((r) => setTimeout(r, 5)); return { kind: 'failed', reason: 'cancelled' }; });
    const source = new YouTubeSharedVideoSource({ fetcher });
    const pending = source.fetch('dQw4w9WgXcQ', { name: 's000000000001' });
    await source.cancel('s000000000001');
    await pending;
    expect(seen.aborted).toBe(true);
    expect(fetcher.cancel).toHaveBeenCalledWith('s000000000001');
  });

  it('names its provider for a stored video, and streams from youtube:<id> as the last fallback', async () => {
    const source = new YouTubeSharedVideoSource({ fetcher: chain() });
    expect(await source.stored('s000000000001')).toMatchObject({ provider: 'youtube', title: 'k' });
    expect(source.streamContentId('dQw4w9WgXcQ')).toBe('youtube:dQw4w9WgXcQ');
    expect(source.streamContentId('bad')).toBeNull();
  });
});
