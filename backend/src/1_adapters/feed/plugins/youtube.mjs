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
    const result = {
      contentType: 'youtube',
      meta: {
        videoId,
        playable: true,
        embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
      },
    };

    // Set thumbnail if item has no image
    if (!item.image) {
      result.image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      result.meta.imageWidth = 480;
      result.meta.imageHeight = 360;
    }

    return result;
  }
}
