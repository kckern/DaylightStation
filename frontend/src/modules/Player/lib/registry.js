// frontend/src/modules/Player/lib/registry.js

/**
 * Playable Content Format Registry
 *
 * Maps content formats to their renderer components.
 * SinglePlayer consumes this registry for format-based dispatch.
 *
 * To add a new playable content type:
 * 1. Create the renderer component implementing the Playable Contract
 *    (see docs/reference/content/content-playback.md)
 * 2. Import and register it here
 * 3. No changes needed in SinglePlayer
 */
import { SingalongScroller } from '../renderers/SingalongScroller.jsx';
import { ReadalongScroller } from '../renderers/ReadalongScroller.jsx';
import PlayableAppShell from '../components/PlayableAppShell.jsx';
import PagedReader from '../components/PagedReader.jsx';
import FlowReader from '../components/FlowReader.jsx';

/**
 * Content format → renderer component.
 * Media formats (video, audio, dash_video) are NOT in this map —
 * they use AudioPlayer/VideoPlayer via separate dispatch in SinglePlayer.
 */
const CONTENT_FORMAT_COMPONENTS = {
  singalong: SingalongScroller,
  readalong: ReadalongScroller,
  app: PlayableAppShell,
  readable_paged: PagedReader,
  readable_flow: FlowReader,
};

const MEDIA_PLAYBACK_FORMATS = new Set(['video', 'dash_video', 'audio']);

/**
 * Get the renderer component for a content format.
 * @param {string} format - Content format string from Play API
 * @returns {React.ComponentType | null} The renderer component, or null if not registered
 */
export function getRenderer(format) {
  return CONTENT_FORMAT_COMPONENTS[format] || null;
}

/**
 * Check if a format is a media playback format (video/audio).
 * Media formats use AudioPlayer/VideoPlayer, not the content format registry.
 * @param {string} format
 * @returns {boolean}
 */
export function isMediaFormat(format) {
  return MEDIA_PLAYBACK_FORMATS.has(format);
}

/**
 * Get all registered content format names.
 * @returns {string[]}
 */
export function getRegisteredFormats() {
  return Object.keys(CONTENT_FORMAT_COMPONENTS);
}
