import { describe, it, expect, vi } from 'vitest';
import { CuratedPageVideoGateway } from './CuratedPageVideoGateway.mjs';

const pageSource = {
  provider: 'pbs_lesson',
  sourceRef: {
    platform: 'youtube', collectionType: 'page',
    locator: 'https://www.pbs.org/newshour/classroom/daily-news-lessons',
    linkPattern: '/newshour/classroom/daily-news-lessons/\\d{4}/\\d{2}/[a-z0-9-]+',
    description: 'PBS NewsHour Classroom — Daily News Lesson',
  },
};
const channelSource = { provider: 'tldr_global', sourceRef: { platform: 'youtube', collectionType: 'channel', locator: 'UC-uhvujip5deVcEtLxnW8qg' } };

function build(pages = {}) {
  const inner = {
    downloadLatest: vi.fn(async () => ({ kind: 'downloaded', assetId: 'x', uploadDate: '20261029' })),
    fetchChannelMetadata: vi.fn(async () => ({ title: 'Inner' })),
    downloadThumbnail: vi.fn(async () => true),
  };
  const fetchText = vi.fn(async (url) => {
    if (!(url in pages)) throw new Error(`HTTP 404 ${url}`);
    return pages[url];
  });
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return { gateway: new CuratedPageVideoGateway({ inner, fetchText, logger }), inner, fetchText, logger };
}

describe('CuratedPageVideoGateway', () => {
  it('passes non-page sources straight to the inner gateway', async () => {
    const { gateway, inner, fetchText } = build();
    await gateway.downloadLatest(channelSource, { timeoutMs: 1 });
    expect(inner.downloadLatest).toHaveBeenCalledWith(channelSource, { timeoutMs: 1 });
    expect(fetchText).not.toHaveBeenCalled();
    expect(await gateway.fetchChannelMetadata(channelSource)).toEqual({ title: 'Inner' });
  });

  it('resolves a page source to the newest lesson\'s embedded video and downloads that', async () => {
    const lesson = 'https://www.pbs.org/newshour/classroom/daily-news-lessons/2026/10/whats-next';
    const { gateway, inner, logger } = build({
      [pageSource.sourceRef.locator]: '<a href="/newshour/classroom/daily-news-lessons/2026/10/whats-next">x</a>',
      [lesson]: '<script>{"datePublished":"2026-10-29T14:03:00+00:00"}</script><iframe src="https://www.youtube.com/embed/QAyxgojwmec"></iframe>',
    });
    const out = await gateway.downloadLatest(pageSource, { timeoutMs: 1 });
    expect(out.kind).toBe('downloaded');
    // The file is dated by the lesson, not by the embedded video's upload date
    // (a lesson can embed a segment that aired years ago).
    expect(inner.downloadLatest).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'pbs_lesson', sourceRef: { platform: 'youtube', collectionType: 'video', locator: 'QAyxgojwmec' } }),
      { timeoutMs: 1, fileDate: '20261029' },
    );
    expect(logger.info).toHaveBeenCalledWith('freshvideo.page.resolved', expect.objectContaining({ provider: 'pbs_lesson', videoId: 'QAyxgojwmec', lessonUrl: lesson }));
  });

  it('fails cleanly when the listing has no matching link', async () => {
    const { gateway, inner, logger } = build({ [pageSource.sourceRef.locator]: '<p>maintenance</p>' });
    expect(await gateway.downloadLatest(pageSource, {})).toEqual({ kind: 'failed', error: 'curated page: no matching link' });
    expect(inner.downloadLatest).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('freshvideo.page.no_link', expect.objectContaining({ provider: 'pbs_lesson' }));
  });

  it('fails cleanly when the lesson page embeds no video', async () => {
    const lesson = 'https://www.pbs.org/newshour/classroom/daily-news-lessons/2026/10/text-only';
    const { gateway } = build({
      [pageSource.sourceRef.locator]: '<a href="/newshour/classroom/daily-news-lessons/2026/10/text-only">',
      [lesson]: '<p>no video</p>',
    });
    expect(await gateway.downloadLatest(pageSource, {})).toEqual({ kind: 'failed', error: 'curated page: no embedded video' });
  });

  it('a fetch error becomes a failed outcome, never a throw', async () => {
    const { gateway } = build({});
    const out = await gateway.downloadLatest(pageSource, {});
    expect(out.kind).toBe('failed');
    expect(out.error).toMatch(/HTTP 404/);
  });

  it('describes a page source from config without asking the inner gateway', async () => {
    const { gateway, inner } = build();
    expect(await gateway.fetchChannelMetadata(pageSource)).toEqual({
      title: 'PBS NewsHour Classroom — Daily News Lesson', description: null, uploader: null, thumbnailUrl: null,
    });
    expect(inner.fetchChannelMetadata).not.toHaveBeenCalled();
  });
});
