/**
 * YouTube Content Plugin
 *
 * Detects YouTube URLs in feed items from any source (FreshRSS, Reddit, etc.)
 * and enriches them with videoId, embed URL, thumbnail, and playable flag.
 *
 * @module adapters/feed/plugins/youtube
 */
import { IContentPlugin } from '#apps/feed/plugins/IContentPlugin.mjs';

const YT_URL_PATTERN = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/;
const YT_SHORTS_PATTERN = /youtube\.com\/shorts\//;

// Scraped YouTube pages produce footer garbage as body text
const YT_FOOTER_PATTERN = /AboutPressCopyright|How YouTube works|NFL Sunday Ticket/;

function isScrapedGarbage(text) {
  return text && YT_FOOTER_PATTERN.test(text);
}

export class YouTubeContentPlugin extends IContentPlugin {
  get contentType() { return 'youtube'; }

  detect(item) {
    if (!item.link) return false;
    return YT_URL_PATTERN.test(item.link);
  }

  enrich(item) {
    const match = item.link?.match(YT_URL_PATTERN);
    if (!match) return {};

    const videoId = match[1];
    const isShort = YT_SHORTS_PATTERN.test(item.link);
    const result = {
      contentType: 'youtube',
      meta: {
        videoId,
        playable: true,
        embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
        // Embed dimensions: 9:16 for shorts, 16:9 for regular
        imageWidth: isShort ? 9 : 16,
        imageHeight: isShort ? 16 : 9,
      },
    };

    // Set thumbnail if item has no image
    if (!item.image) {
      result.image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }

    // Strip scraped YouTube page footer from body/content
    if (isScrapedGarbage(item.body)) result.body = '';
    if (isScrapedGarbage(item.content)) result.content = '';

    return result;
  }
}
