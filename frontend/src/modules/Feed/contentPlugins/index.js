// frontend/src/modules/Feed/contentPlugins/index.js
/**
 * Content plugin registry (frontend).
 *
 * Maps `item.contentType` to view-specific renderers.
 * Each plugin exports: { contentType, ScrollBody, ReaderRow }
 *
 * Checked before the source-based body module registry (bodies/index.js).
 */
import { YouTubeScrollBody, YouTubeReaderRow } from './youtube.jsx';

const CONTENT_PLUGINS = [
  { contentType: 'youtube', ScrollBody: YouTubeScrollBody, ReaderRow: YouTubeReaderRow },
];

const pluginMap = new Map(CONTENT_PLUGINS.map(p => [p.contentType, p]));

/**
 * Get content plugin for an item, if any.
 * @param {Object} item - Feed item with optional `contentType` field
 * @returns {{ contentType: string, ScrollBody: Function, ReaderRow: Function } | null}
 */
export function getContentPlugin(item) {
  if (!item?.contentType) return null;
  return pluginMap.get(item.contentType) || null;
}
