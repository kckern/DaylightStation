import { describe, expect, it, vi } from 'vitest';
import { MediaDownloadService } from '#apps/media/services/MediaDownloadService.mjs';

describe('MediaDownloadService', () => {
  it('preserves the metadata response while delegating persistence and file addressing', async () => {
    const newsMediaStore = {
      hasThumbnail: vi.fn(() => false),
      saveMetadata: vi.fn(),
      publicReferences: vi.fn(() => ({
        metadataRelPath: 'media/video/news/news/metadata.yml',
        thumbnailRelPath: 'media/video/news/news/show.jpg',
      })),
    };
    const downloadThumbnail = vi.fn(async () => true);
    const service = new MediaDownloadService({
      videoSourceGateway: {
        fetchChannelMetadata: vi.fn(async () => ({
          title: 'News', description: 'Daily news', uploader: 'Daylight', thumbnailUrl: 'https://example.test/show.jpg',
        })),
      },
      newsMediaStore,
      downloadThumbnail,
      logger: { info() {} },
    });

    await expect(service.fetchAndSaveMetadata({ provider: 'news' })).resolves.toEqual({
      ok: true,
      title: 'News',
      thumbnailDownloaded: true,
      metadataRelPath: 'media/video/news/news/metadata.yml',
      thumbnailRelPath: 'media/video/news/news/show.jpg',
    });
    expect(newsMediaStore.saveMetadata).toHaveBeenCalledWith('news', {
      title: 'News', description: 'Daily news', uploader: 'Daylight', thumbnailUrl: 'https://example.test/show.jpg',
    });
    expect(downloadThumbnail).toHaveBeenCalledWith('https://example.test/show.jpg', 'news');
    expect(newsMediaStore.publicReferences).toHaveBeenCalledWith('news', { thumbnail: true });
  });
});
