/**
 * CuratedPageVideoGateway — lets a fresh-video source be a curated web page
 * (`type: page` in media/sources.yml) instead of a channel or playlist.
 *
 * The listing page names the newest item by its first link matching the
 * source's `link_pattern`; that item's page embeds one YouTube video, which
 * is handed to the inner gateway (yt-dlp) as a single video. Every other
 * source passes straight through.
 */
import { firstMatchingLink, firstYouTubeEmbedId, publishedDate } from '../domain/curatedPage.mjs';

async function defaultFetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (DaylightStation fresh video)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.text();
}

export class CuratedPageVideoGateway {
  #inner;
  #fetchText;
  #logger;

  constructor({ inner, fetchText = defaultFetchText, logger = console }) {
    if (!inner) throw new TypeError('CuratedPageVideoGateway requires inner');
    this.#inner = inner;
    this.#fetchText = fetchText;
    this.#logger = logger;
  }

  static isPage(source) {
    return String(source?.sourceRef?.collectionType || '').toLowerCase() === 'page';
  }

  async downloadLatest(source, options) {
    if (!CuratedPageVideoGateway.isPage(source)) return this.#inner.downloadLatest(source, options);
    const { locator: listingUrl, linkPattern } = source.sourceRef;
    try {
      const lessonUrl = firstMatchingLink(await this.#fetchText(listingUrl), linkPattern, listingUrl);
      if (!lessonUrl) {
        this.#logger.warn?.('freshvideo.page.no_link', { provider: source.provider, listingUrl });
        return { kind: 'failed', error: 'curated page: no matching link' };
      }
      const lessonHtml = await this.#fetchText(lessonUrl);
      const videoId = firstYouTubeEmbedId(lessonHtml);
      if (!videoId) {
        this.#logger.warn?.('freshvideo.page.no_video', { provider: source.provider, lessonUrl });
        return { kind: 'failed', error: 'curated page: no embedded video' };
      }
      // Dated by the lesson, not the embedded video's upload date: a lesson can
      // embed a segment that aired years ago, which retention would delete.
      const fileDate = publishedDate(lessonHtml);
      this.#logger.info?.('freshvideo.page.resolved', { provider: source.provider, lessonUrl, videoId, fileDate });
      return this.#inner.downloadLatest({
        ...source,
        sourceRef: { platform: 'youtube', collectionType: 'video', locator: videoId },
      }, fileDate ? { ...options, fileDate } : options);
    } catch (error) {
      this.#logger.warn?.('freshvideo.page.fetch_failed', { provider: source.provider, error: error.message });
      return { kind: 'failed', error: error.message };
    }
  }

  async fetchChannelMetadata(source) {
    if (!CuratedPageVideoGateway.isPage(source)) return this.#inner.fetchChannelMetadata?.(source) ?? null;
    return { title: source.sourceRef.description || source.provider, description: null, uploader: null, thumbnailUrl: null };
  }

  downloadThumbnail(url, provider) {
    return this.#inner.downloadThumbnail?.(url, provider);
  }
}
