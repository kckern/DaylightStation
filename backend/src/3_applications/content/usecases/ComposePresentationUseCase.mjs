// backend/src/3_applications/content/usecases/ComposePresentationUseCase.mjs
//
// Use case for composing multi-track presentations from heterogeneous media sources.
// Handles track resolution (visual/audio), source parsing, and modifier scoping.

import {
  createVisualTrack,
  createAudioTrack,
  createComposedPresentation
} from '#domains/content/capabilities/Composable.mjs';
import { ApplicationError, ServiceNotFoundError } from '#apps/shared/errors/index.mjs';

/**
 * @typedef {Object} ComposePresentationConfig
 * @property {import('./Composable.mjs').AdvanceConfig} [advance] - Advance configuration for visual track
 * @property {boolean} [loop] - Loop behavior (scoped by getModifierScope)
 * @property {'loop.visual' | 'loop.audio'} [loop.visual] - Per-track loop override for visual
 * @property {'loop.visual' | 'loop.audio'} [loop.audio] - Per-track loop override for audio
 * @property {boolean} [shuffle] - Shuffle behavior (scoped by getModifierScope)
 * @property {boolean} [continuous] - Continuous playback (scoped by getModifierScope)
 * @property {string} [shader] - Shader to apply (visual only)
 * @property {number} [volume] - Volume level (audio only)
 * @property {number} [playbackRate] - Playback speed (visual only, avoids audio pitch shift)
 * @property {import('./Composable.mjs').CompositionLayout} [layout] - Layout arrangement
 */

/**
 * ComposePresentationUseCase - Orchestrates composition of multi-track presentations.
 *
 * Responsibilities:
 * - Parse source identifiers (provider:id format)
 * - Resolve track assignment (visual vs audio) via explicit prefix or inference
 * - Apply modifier scoping rules
 * - Build IComposedPresentation output
 *
 * @example
 * const useCase = new ComposePresentationUseCase({ contentSourceRegistry });
 *
 * // Explicit track assignment
 * const result = await useCase.compose(
 *   ['visual:plex:12345', 'audio:plex:67890'],
 *   { loop: true, shuffle: true }
 * );
 *
 * // Inferred track assignment (video -> visual, audio -> audio)
 * const result2 = await useCase.compose(
 *   ['plex:12345', 'plex:67890'],
 *   { advance: { mode: 'timed', interval: 5000 } }
 * );
 */
export class ComposePresentationUseCase {
  #contentSourceRegistry;
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.contentSourceRegistry - Registry of content source adapters
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.contentSourceRegistry) {
      throw new Error('contentSourceRegistry is required');
    }
    this.#contentSourceRegistry = config.contentSourceRegistry;
    this.#logger = config.logger || console;
  }

  /**
   * Compose a multi-track presentation from source identifiers.
   *
   * @param {string[]} sources - Array of source identifiers
   *   - Format: [track:]provider:id or [track:]id (assumes plex for numeric)
   *   - Track prefix: 'visual:' or 'audio:' (optional, infers from mediaType if omitted)
   * @param {ComposePresentationConfig} [config={}] - Composition configuration
   * @returns {Promise<import('#domains/content/capabilities/Composable.mjs').IComposedPresentation>}
   */
  async compose(sources, config = {}) {
    this.#logger.debug?.('composePresentationUseCase.start', { sources, config });

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      throw new ApplicationError('At least one source is required', {
        code: 'INVALID_INPUT',
        field: 'sources'
      });
    }

    // Resolve tracks from sources
    const tracks = await Promise.all(
      sources.map(source => this.#resolveTrack(source))
    );

    // Separate into visual and audio tracks
    const visualTracks = tracks.filter(t => t.track === 'visual');
    const audioTracks = tracks.filter(t => t.track === 'audio');

    if (visualTracks.length === 0) {
      throw new ApplicationError('At least one visual track is required', {
        code: 'NO_VISUAL_TRACK',
        resolvedTracks: tracks.map(t => ({ source: t.source, track: t.track }))
      });
    }

    // Resolve modifiers based on track count
    const trackCount = (visualTracks.length > 0 ? 1 : 0) + (audioTracks.length > 0 ? 1 : 0);
    const resolvedModifiers = this.#resolveModifiers(config, trackCount);

    // Build visual track
    // For now, take first visual source; future: support multiple visual items
    const visualSource = visualTracks[0];
    const visualTrack = createVisualTrack({
      type: this.#inferVisualType(visualSource.item),
      items: [{
        id: visualSource.item.id,
        url: visualSource.item.mediaUrl || visualSource.item.thumbnail,
        duration: visualSource.item.duration ? visualSource.item.duration * 1000 : null,
        caption: visualSource.item.title
      }],
      advance: config.advance || { mode: 'none' },
      loop: resolvedModifiers.visual.loop ?? false
    });

    // Build audio track (if any audio sources)
    let audioTrack = null;
    if (audioTracks.length > 0) {
      audioTrack = createAudioTrack({
        items: audioTracks.map(t => t.item),
        shuffle: resolvedModifiers.audio.shuffle ?? false,
        loop: resolvedModifiers.audio.loop ?? false
      });
    }

    // Create composed presentation
    const presentation = createComposedPresentation(
      visualTrack,
      audioTrack,
      config.layout || 'fullscreen'
    );

    // Attach additional modifiers to presentation for consumer use
    // These are not part of the core interface but useful for the player
    presentation.modifiers = {
      shader: resolvedModifiers.visual.shader,
      volume: resolvedModifiers.audio.volume,
      playbackRate: resolvedModifiers.visual.playbackRate,
      continuous: resolvedModifiers.continuous
    };

    this.#logger.debug?.('composePresentationUseCase.complete', {
      visualTrackType: visualTrack.type || visualTrack.app,
      hasAudio: !!audioTrack,
      layout: presentation.layout
    });

    return presentation;
  }

  /**
   * Resolve a source string to track assignment and item metadata.
   *
   * @param {string} source - Source identifier with optional track prefix
   * @returns {Promise<{track: 'visual'|'audio', source: string, item: Object}>}
   * @private
   */
  async #resolveTrack(source) {
    // Check for explicit track prefix: visual:source or audio:source
    let track = null;
    let sourceWithoutTrack = source;

    if (source.startsWith('visual:')) {
      track = 'visual';
      sourceWithoutTrack = source.slice(7);
    } else if (source.startsWith('audio:')) {
      track = 'audio';
      sourceWithoutTrack = source.slice(6);
    }

    // Parse provider and ID
    const { provider, id } = this.#parseSource(sourceWithoutTrack);

    // Get adapter from registry
    const adapter = this.#contentSourceRegistry.getAdapter?.(provider) ||
                    this.#contentSourceRegistry.get?.(provider) ||
                    this.#contentSourceRegistry[provider];

    if (!adapter) {
      throw new ServiceNotFoundError('ContentSourceAdapter', provider);
    }

    // Get item metadata
    const item = await adapter.getItem(id);

    if (!item) {
      throw new ApplicationError(`Item not found: ${sourceWithoutTrack}`, {
        code: 'ITEM_NOT_FOUND',
        provider,
        id
      });
    }

    // Infer track from mediaType if not explicitly specified
    if (!track) {
      track = this.#inferTrack(item);
    }

    return { track, source: sourceWithoutTrack, item };
  }

  /**
   * Parse a source string into provider and ID components.
   *
   * @param {string} source - Source identifier (provider:id or numeric id)
   * @returns {{provider: string, id: string}}
   * @private
   *
   * Rules:
   * - Numeric-only: assumes Plex (e.g., '12345' -> plex:12345)
   * - Otherwise: split on first colon (e.g., 'immich:abc123')
   */
  #parseSource(source) {
    // Numeric-only assumes Plex
    if (/^\d+$/.test(source)) {
      return { provider: 'plex', id: source };
    }

    // Split on first colon
    const colonIndex = source.indexOf(':');
    if (colonIndex === -1) {
      // No colon - treat as Plex ID (could be alphanumeric in future)
      return { provider: 'plex', id: source };
    }

    return {
      provider: source.slice(0, colonIndex),
      id: source.slice(colonIndex + 1)
    };
  }

  /**
   * Infer track assignment from item metadata.
   *
   * @param {Object} item - Item with mediaType property
   * @returns {'visual' | 'audio'}
   * @private
   *
   * Inference rules:
   * - mediaType 'audio' -> audio track
   * - mediaType 'video', 'image', 'live', 'composite' -> visual track
   * - Default: visual track
   */
  #inferTrack(item) {
    const mediaType = item.mediaType;

    if (mediaType === 'audio') {
      return 'audio';
    }

    // video, image, live, composite, or unknown -> visual
    return 'visual';
  }

  /**
   * Infer visual media type from item metadata.
   *
   * @param {Object} item - Item with mediaType property
   * @returns {'video' | 'image' | 'pages'}
   * @private
   */
  #inferVisualType(item) {
    const mediaType = item.mediaType;

    if (mediaType === 'video' || mediaType === 'live') {
      return 'video';
    }

    if (mediaType === 'image') {
      return 'image';
    }

    // Default to video for unknown types
    return 'video';
  }

  /**
   * Resolve modifier scoping based on track count and per-track overrides.
   *
   * @param {ComposePresentationConfig} config - User-provided config
   * @param {number} trackCount - Number of distinct tracks (1 or 2)
   * @returns {{visual: Object, audio: Object, continuous: boolean}}
   * @private
   *
   * MODIFIER SCOPING RULES (documented inline as requested):
   *
   * - shader: VISUAL ONLY
   *   Shaders are GPU effects applied to visual rendering. Audio has no visual.
   *
   * - volume: AUDIO ONLY
   *   Volume controls audio output level. Visual track has no audio output.
   *
   * - playbackRate: VISUAL ONLY
   *   Changing playback rate on audio causes pitch shift (chipmunk/slowed effect).
   *   Visual playback rate changes frame timing without audio artifacts.
   *
   * - loop: BOTH TRACKS (when multi-track)
   *   When single track, loop applies to that track.
   *   When multi-track, loop applies to both unless per-track override specified.
   *   Per-track: config['loop.visual'], config['loop.audio']
   *
   * - shuffle: BOTH TRACKS (when multi-track)
   *   Shuffle randomizes item order. Applies to both tracks for consistency.
   *   Per-track: config['shuffle.visual'], config['shuffle.audio']
   *
   * - continuous: BOTH TRACKS (when multi-track)
   *   Continuous playback (no pause between items). Applies to both tracks.
   */
  #resolveModifiers(config, trackCount) {
    const visual = {};
    const audio = {};

    // shader: visual only
    if (config.shader !== undefined) {
      visual.shader = config.shader;
    }

    // volume: audio only
    if (config.volume !== undefined) {
      audio.volume = config.volume;
    }

    // playbackRate: visual only (avoid audio pitch shift)
    if (config.playbackRate !== undefined) {
      visual.playbackRate = config.playbackRate;
    }

    // loop: scoped based on track count
    const loopScope = this.#getModifierScope('loop', trackCount);
    if (config['loop.visual'] !== undefined) {
      visual.loop = config['loop.visual'];
    } else if (loopScope === 'both' || loopScope === 'visual') {
      visual.loop = config.loop;
    }
    if (config['loop.audio'] !== undefined) {
      audio.loop = config['loop.audio'];
    } else if (loopScope === 'both' || loopScope === 'audio') {
      audio.loop = config.loop;
    }

    // shuffle: scoped based on track count
    const shuffleScope = this.#getModifierScope('shuffle', trackCount);
    if (config['shuffle.visual'] !== undefined) {
      visual.shuffle = config['shuffle.visual'];
    } else if (shuffleScope === 'both' || shuffleScope === 'visual') {
      visual.shuffle = config.shuffle;
    }
    if (config['shuffle.audio'] !== undefined) {
      audio.shuffle = config['shuffle.audio'];
    } else if (shuffleScope === 'both' || shuffleScope === 'audio') {
      audio.shuffle = config.shuffle;
    }

    // continuous: applies to both when multi-track
    const continuous = config.continuous ?? false;

    return { visual, audio, continuous };
  }

  /**
   * Determine modifier scope based on modifier type and track count.
   *
   * @param {string} modifier - Modifier name
   * @param {number} trackCount - Number of tracks (1 or 2)
   * @returns {'visual' | 'audio' | 'both'}
   * @private
   */
  #getModifierScope(modifier, trackCount) {
    // Track-specific modifiers (always apply to one track only)
    const visualOnlyModifiers = ['shader', 'playbackRate'];
    const audioOnlyModifiers = ['volume'];

    if (visualOnlyModifiers.includes(modifier)) {
      return 'visual';
    }

    if (audioOnlyModifiers.includes(modifier)) {
      return 'audio';
    }

    // Shared modifiers: apply to both when multi-track
    // loop, shuffle, continuous
    if (trackCount >= 2) {
      return 'both';
    }

    // Single track: default to visual (most common single-track case)
    return 'visual';
  }
}

export default ComposePresentationUseCase;
