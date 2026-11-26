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
  it('recognises a link as the youtube provider and its id', () => {
    const source = new YouTubeSharedVideoSource({ downloader: { downloadOne: vi.fn() } });
    expect(source.recognize('https://youtu.be/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', sourceId: 'dQw4w9WgXcQ' });
    expect(source.recognize('https://example.com/x')).toBeNull();
  });

  it('fetches from the watch URL rebuilt from the id, never the shared text', async () => {
    const downloadOne = vi.fn(async () => ({ kind: 'downloaded', filePath: '/x.mp4', title: 't', duration: 1 }));
    const source = new YouTubeSharedVideoSource({ downloader: { downloadOne } });
    await source.fetch('dQw4w9WgXcQ', { outputPath: '/x.mp4' });
    expect(downloadOne).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { outputPath: '/x.mp4' });
    expect(await source.fetch('bad id!', {})).toEqual({ kind: 'failed', error: 'not a YouTube video id' });
  });
});
