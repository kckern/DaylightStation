// backend/src/2_domains/content/capabilities/Composable.mjs
//
// Domain interfaces for composed presentations - multi-track media playback
// combining visual content (images, video, apps) with audio tracks.

import { ValidationError } from '../../core/errors/index.mjs';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * @typedef {'media' | 'app'} VisualCategory
 *
 * Category distinction:
 * - 'media': Content served from backend adapters via proxy (images, video, pages)
 *   These are actual media files fetched and streamed through the backend.
 *
 * - 'app': Frontend-rendered UI components (blackout, screensaver, clock, art-frame)
 *   These are React components that render on the frontend without backend media.
 */

/**
 * @typedef {'image' | 'video' | 'pages'} VisualMediaType
 *
 * Media types for visual track:
 * - 'image': Single image or image slideshow (Immich album, filesystem images)
 * - 'video': Video content, single or playlist (Plex movies, ambient videos)
 * - 'pages': Sequential pages like book content (Komga manga, Audiobookshelf)
 */

/**
 * @typedef {'blackout' | 'screensaver' | 'clock' | 'art-frame'} VisualAppType
 *
 * App types for visual track:
 * - 'blackout': No visual output, audio-only mode
 * - 'screensaver': Animated UI patterns or effects
 * - 'clock': Time display component
 * - 'art-frame': Single static image with art-mode presentation
 */

/**
 * @typedef {'none' | 'timed' | 'onTrackEnd' | 'manual' | 'synced'} AdvanceMode
 *
 * Advance modes control how visual content progresses:
 *
 * - 'none': Static display. No automatic advance.
 *   Use for: Single images, looping video, app displays
 *
 * - 'timed': Advance every N milliseconds (configurable via interval).
 *   Use for: Photo slideshows, ambient image rotation
 *
 * - 'onTrackEnd': Advance when audio track ends.
 *   Use for: Slideshow synced to music playlist (new image when song ends)
 *
 * - 'manual': User-controlled only via keyboard/touch/remote.
 *   Use for: Presentations, manual photo browsing
 *
 * - 'synced': Advance based on audio time markers.
 *   Use for: Book pages with narration (page turns at chapter timestamps)
 */

/**
 * @typedef {Object} VisualItem
 * @property {string} id - Unique identifier for the item
 * @property {string} url - Proxy URL for display
 * @property {number} [duration] - Suggested display time in milliseconds (optional)
 * @property {string} [caption] - Optional caption or metadata text
 */

/**
 * @typedef {Object} AdvanceConfig
 * @property {AdvanceMode} mode - How visual content advances
 * @property {number} [interval] - Milliseconds between advances (for 'timed' mode)
 * @property {Array<SyncMarker>} [markers] - Time-based markers (for 'synced' mode)
 */

/**
 * @typedef {Object} SyncMarker
 * @property {number} time - Audio time in milliseconds when this marker triggers
 * @property {number} index - Visual item index to display at this time
 *
 * Sync markers enable tight audio-visual synchronization.
 * When audioState.currentTime reaches marker.time, visual advances to marker.index.
 *
 * Example: Book narration with page turns
 * - markers: [
 *     { time: 0, index: 0 },       // Page 1 at start
 *     { time: 45000, index: 1 },   // Page 2 at 45 seconds
 *     { time: 92000, index: 2 }    // Page 3 at 1:32
 *   ]
 *
 * Adapters like AudiobookshelfAdapter can provide these from chapter metadata.
 * If markers are unavailable, use case falls back to 'timed' or 'manual' mode.
 */

/**
 * @typedef {'fullscreen' | 'pip' | 'splitscreen'} CompositionLayout
 *
 * Layout options for composed presentations:
 * - 'fullscreen': Visual track takes full screen, audio overlays
 * - 'pip': Picture-in-picture, small video over main visual
 * - 'splitscreen': Side-by-side visual tracks
 */

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * @typedef {Object} IVisualTrack
 * Domain interface for visual content in composed presentations.
 *
 * @property {VisualCategory} category - 'media' for proxied content, 'app' for frontend components
 *
 * For media category:
 * @property {VisualMediaType} [type] - Type of media ('image', 'video', 'pages')
 * @property {VisualItem[]} [items] - Array of media items with URLs and metadata
 *
 * For app category:
 * @property {VisualAppType} [app] - Which app component to render
 * @property {Object} [appConfig] - App-specific configuration object
 *
 * Common properties:
 * @property {AdvanceConfig} advance - Configuration for how visual advances
 * @property {boolean} loop - Whether to loop back to start after last item
 */

/**
 * @typedef {Object} IAudioTrack
 * Domain interface for audio content.
 * Reuses existing PlayableItem capability for items.
 *
 * @property {import('./Playable.mjs').PlayableItem[]} items - Array of playable audio items
 * @property {boolean} [shuffle] - Whether to shuffle playback order (default: false)
 * @property {boolean} [loop] - Whether to loop playlist (default: false)
 */

/**
 * @typedef {Object} IComposedPresentation
 * Full composed output from use case.
 * Combines visual and audio tracks with layout configuration.
 *
 * @property {IVisualTrack} visual - Visual track configuration
 * @property {IAudioTrack|null} audio - Audio track, or null for silent presentation
 * @property {CompositionLayout} layout - How tracks are arranged on screen
 */

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a visual track for media content.
 *
 * @param {Object} config - Visual track configuration
 * @param {VisualMediaType} config.type - Media type: 'image', 'video', or 'pages'
 * @param {VisualItem[]} config.items - Array of media items
 * @param {AdvanceConfig} [config.advance] - Advance configuration
 * @param {boolean} [config.loop=false] - Whether to loop
 * @returns {IVisualTrack}
 *
 * @example
 * // Image slideshow with timed advance
 * const slideshow = createVisualTrack({
 *   type: 'image',
 *   items: [
 *     { id: 'img1', url: '/proxy/immich/123.jpg' },
 *     { id: 'img2', url: '/proxy/immich/456.jpg' }
 *   ],
 *   advance: { mode: 'timed', interval: 5000 },
 *   loop: true
 * });
 *
 * @example
 * // Book pages with audio sync markers
 * const bookPages = createVisualTrack({
 *   type: 'pages',
 *   items: pages.map((p, i) => ({ id: `page-${i}`, url: p.url })),
 *   advance: {
 *     mode: 'synced',
 *     markers: chapters.map(c => ({ time: c.startMs, index: c.pageIndex }))
 *   },
 *   loop: false
 * });
 */
export function createVisualTrack(config) {
  // App category
  if (config.app) {
    const validApps = ['blackout', 'screensaver', 'clock', 'art-frame'];
    if (!validApps.includes(config.app)) {
      throw new ValidationError(`Invalid app type: ${config.app}`, {
        code: 'INVALID_APP_TYPE',
        field: 'app',
        validValues: validApps
      });
    }

    return {
      category: 'app',
      app: config.app,
      appConfig: config.appConfig || {},
      advance: config.advance || { mode: 'none' },
      loop: config.loop ?? false
    };
  }

  // Media category - validate required fields
  if (!config.type) {
    throw new ValidationError('Visual track requires type for media category', {
      code: 'MISSING_TYPE',
      field: 'type'
    });
  }

  const validTypes = ['image', 'video', 'pages'];
  if (!validTypes.includes(config.type)) {
    throw new ValidationError(`Invalid media type: ${config.type}`, {
      code: 'INVALID_MEDIA_TYPE',
      field: 'type',
      validValues: validTypes
    });
  }

  if (!config.items || !Array.isArray(config.items)) {
    throw new ValidationError('Visual track requires items array for media category', {
      code: 'MISSING_ITEMS',
      field: 'items'
    });
  }

  // Validate items have required properties
  config.items.forEach((item, index) => {
    if (!item.id) {
      throw new ValidationError(`Visual item at index ${index} requires id`, {
        code: 'MISSING_ITEM_ID',
        field: `items[${index}].id`
      });
    }
    if (!item.url) {
      throw new ValidationError(`Visual item at index ${index} requires url`, {
        code: 'MISSING_ITEM_URL',
        field: `items[${index}].url`
      });
    }
  });

  // Validate advance configuration
  const advance = config.advance || { mode: 'none' };
  const validModes = ['none', 'timed', 'onTrackEnd', 'manual', 'synced'];
  if (!validModes.includes(advance.mode)) {
    throw new ValidationError(`Invalid advance mode: ${advance.mode}`, {
      code: 'INVALID_ADVANCE_MODE',
      field: 'advance.mode',
      validValues: validModes
    });
  }

  // Validate mode-specific requirements
  if (advance.mode === 'timed' && (!advance.interval || advance.interval <= 0)) {
    throw new ValidationError('Timed advance mode requires positive interval', {
      code: 'MISSING_INTERVAL',
      field: 'advance.interval'
    });
  }

  if (advance.mode === 'synced' && (!advance.markers || !Array.isArray(advance.markers))) {
    throw new ValidationError('Synced advance mode requires markers array', {
      code: 'MISSING_MARKERS',
      field: 'advance.markers'
    });
  }

  return {
    category: 'media',
    type: config.type,
    items: config.items.map(item => ({
      id: item.id,
      url: item.url,
      duration: item.duration ?? null,
      caption: item.caption ?? null
    })),
    advance,
    loop: config.loop ?? false
  };
}

/**
 * Create an audio track from playable items.
 *
 * @param {Object} config - Audio track configuration
 * @param {import('./Playable.mjs').PlayableItem[]} config.items - Playable audio items
 * @param {boolean} [config.shuffle=false] - Shuffle playback order
 * @param {boolean} [config.loop=false] - Loop playlist
 * @returns {IAudioTrack}
 *
 * @example
 * // Simple playlist
 * const playlist = createAudioTrack({
 *   items: [musicTrack1, musicTrack2, musicTrack3],
 *   shuffle: true,
 *   loop: true
 * });
 *
 * @example
 * // Narration track (single item, no loop)
 * const narration = createAudioTrack({
 *   items: [audiobookChapter],
 *   loop: false
 * });
 */
export function createAudioTrack(config) {
  if (!config.items || !Array.isArray(config.items)) {
    throw new ValidationError('Audio track requires items array', {
      code: 'MISSING_ITEMS',
      field: 'items'
    });
  }

  if (config.items.length === 0) {
    throw new ValidationError('Audio track requires at least one item', {
      code: 'EMPTY_ITEMS',
      field: 'items'
    });
  }

  return {
    items: config.items,
    shuffle: config.shuffle ?? false,
    loop: config.loop ?? false
  };
}

/**
 * Create a composed presentation combining visual and audio tracks.
 *
 * @param {IVisualTrack} visual - Visual track (required)
 * @param {IAudioTrack|null} audio - Audio track (optional, null for silent)
 * @param {CompositionLayout} [layout='fullscreen'] - Layout arrangement
 * @returns {IComposedPresentation}
 *
 * @example
 * // Fireplace video with Christmas music
 * const fireplace = createComposedPresentation(
 *   createVisualTrack({
 *     type: 'video',
 *     items: [{ id: 'fireplace', url: '/proxy/plex/123' }],
 *     advance: { mode: 'none' },
 *     loop: true
 *   }),
 *   createAudioTrack({
 *     items: christmasPlaylist,
 *     shuffle: true,
 *     loop: true
 *   }),
 *   'fullscreen'
 * );
 *
 * @example
 * // Photo slideshow with background music
 * const slideshow = createComposedPresentation(
 *   createVisualTrack({
 *     type: 'image',
 *     items: photos,
 *     advance: { mode: 'timed', interval: 8000 },
 *     loop: true
 *   }),
 *   createAudioTrack({
 *     items: ambientMusic,
 *     loop: true
 *   }),
 *   'fullscreen'
 * );
 *
 * @example
 * // Book with narration (synced)
 * const audiobook = createComposedPresentation(
 *   createVisualTrack({
 *     type: 'pages',
 *     items: bookPages,
 *     advance: {
 *       mode: 'synced',
 *       markers: chapterMarkers
 *     },
 *     loop: false
 *   }),
 *   createAudioTrack({
 *     items: [narrationTrack],
 *     loop: false
 *   }),
 *   'fullscreen'
 * );
 *
 * @example
 * // Art mode - single image, no audio
 * const artMode = createComposedPresentation(
 *   createVisualTrack({
 *     app: 'art-frame',
 *     appConfig: { imageUrl: '/proxy/immich/featured.jpg' }
 *   }),
 *   null,
 *   'fullscreen'
 * );
 */
export function createComposedPresentation(visual, audio, layout = 'fullscreen') {
  if (!visual) {
    throw new ValidationError('Composed presentation requires visual track', {
      code: 'MISSING_VISUAL',
      field: 'visual'
    });
  }

  const validLayouts = ['fullscreen', 'pip', 'splitscreen'];
  if (!validLayouts.includes(layout)) {
    throw new ValidationError(`Invalid layout: ${layout}`, {
      code: 'INVALID_LAYOUT',
      field: 'layout',
      validValues: validLayouts
    });
  }

  return {
    visual,
    audio: audio || null,
    layout
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  createVisualTrack,
  createAudioTrack,
  createComposedPresentation
};
