import React from 'react';
import PropTypes from 'prop-types';
import { CompositeControllerProvider } from './CompositeControllerContext.jsx';
import { CompositeProvider, useCompositeContext, VISUAL_STATUS, AUDIO_STATUS } from './CompositeContext.jsx';
import { VisualRenderer } from './VisualRenderer.jsx';
import { useAdvanceController } from '../hooks/useAdvanceController.js';
import { guid } from '../lib/helpers.js';

/**
 * Composite Player - Video player with audio overlay
 * Use cases:
 * - Workout video with audio playlist
 * - Ambient video with modular background music
 * - Sermon video with background hymns or talks
 *
 * Supports two formats:
 * - New format: props.visual and props.audio (from compose endpoint)
 * - Old format: props.play.overlay or props.queue.overlay (backward compat)
 */

/**
 * NewFormatComposite - Renders composed presentation with new architecture
 * Uses VisualRenderer for visual track and Player for audio track
 */
function NewFormatComposite({ visual, audio, Player, ignoreKeys, coordination }) {
  const { visual: visualState, audio: audioState } = useCompositeContext();
  const noop = React.useCallback(() => {}, []);

  // Plex session IDs for distinct client identifiers
  const visualPlexSession = React.useMemo(() => `composite-visual-${guid()}`, []);
  const audioPlexSession = React.useMemo(() => `composite-audio-${guid()}`, []);

  // Audio state for advance controller (would be provided by actual audio player)
  const [audioPlaybackState, setAudioPlaybackState] = React.useState({
    currentTime: 0,
    trackEnded: false,
    isPlaying: false
  });

  // Use advance controller for visual track
  const advanceController = useAdvanceController(visual, audioPlaybackState);

  // Build audio props from audio track config
  const audioProps = React.useMemo(() => {
    if (!audio) return null;

    // Audio track should provide play or queue configuration
    if (audio.items && audio.items.length > 0) {
      // Build queue from items, mapping to Player's expected format
      const queueItems = audio.items.map(item => {
        // Extract plex key from id if it's a plex item (e.g., "plex:587484" -> "587484")
        const plexKey = item.id?.startsWith('plex:') ? item.id.slice(5) : null;

        return {
          ...item,
          // Map camelCase to snake_case for Player compatibility
          media_url: item.mediaUrl || item.media_url,
          media_type: item.mediaType || item.media_type || 'audio',
          // Set plex key for SinglePlayer's fetchMediaInfo
          plex: plexKey || item.plex,
          seconds: 0,
          resume: false,
          shader: 'minimal'
        };
      });

      return {
        queue: queueItems.length === 1 ? queueItems[0] : queueItems,
        shuffle: audio.shuffle ?? false
      };
    }

    // Direct play/queue config from audio track
    if (audio.play) {
      return { play: { ...audio.play, seconds: 0, resume: false, shader: 'minimal' } };
    }

    if (audio.queue) {
      return { queue: audio.queue };
    }

    // Plex reference
    if (audio.plex) {
      return { queue: { plex: audio.plex, shuffle: audio.shuffle ?? 1 } };
    }

    return null;
  }, [audio]);

  // Keyboard overrides to prevent audio controls from affecting visual
  const audioKeyboardOverrides = React.useMemo(() => ({
    'ArrowLeft': () => {},
    'ArrowRight': () => {},
    'j': () => {},
    'l': () => {},
    'n': () => {},
    'p': () => {},
    'MediaNextTrack': () => {},
    'MediaPreviousTrack': () => {}
  }), []);

  const shader = visual?.shader || 'regular';

  return (
    <div
      className={`player composite ${shader}`}
      data-visual-status={visualState.status}
      data-audio-status={audioState.status}
    >
      {/* Visual Track */}
      <div data-track="visual" className="composite-visual-layer">
        <VisualRenderer
          track={visual}
          audioState={audioPlaybackState}
          currentIndex={advanceController.currentIndex}
          onAdvance={advanceController.advance}
        />
      </div>

      {/* Audio Track */}
      {audioProps && (
        <div data-track="audio" className="composite-audio-layer">
          <Player
            playerType="overlay"
            ignoreKeys={ignoreKeys}
            clear={noop}
            plexClientSession={audioPlexSession}
            keyboardOverrides={audioKeyboardOverrides}
            {...audioProps}
          />
        </div>
      )}
    </div>
  );
}

NewFormatComposite.propTypes = {
  visual: PropTypes.object,
  audio: PropTypes.object,
  Player: PropTypes.elementType.isRequired,
  ignoreKeys: PropTypes.bool,
  coordination: PropTypes.object
};

/**
 * LegacyFormatComposite - Original implementation for backward compatibility
 * Uses play.overlay / queue.overlay format
 */
function LegacyFormatComposite(props) {
  const { play, queue, Player } = props;
  const isQueue = !!queue;
  const noop = React.useCallback(() => {}, []);

  // Stable session IDs for each player to ensure distinct Plex client identifiers
  const primaryPlexSession = React.useMemo(() => `composite-primary-${guid()}`, []);
  const overlayPlexSession = React.useMemo(() => `composite-overlay-${guid()}`, []);

  const primaryProps = React.useMemo(() => {
    const { coordination: _ignoredCoordination, Player: _ignoredPlayer, ...baseProps } = props;
    const overlayKey = isQueue ? 'queue' : 'play';
    const normalizePrimaryEntry = (value) => {
      if (!value) return value;
      const applyDefaults = (entry) => ({
        ...entry,
        seconds: 0,
        resume: false,
        shader: 'minimal'
      });
      return Array.isArray(value) ? value.map(applyDefaults) : applyDefaults(value);
    };

    if (baseProps[overlayKey] && !Array.isArray(baseProps[overlayKey])) {
      baseProps[overlayKey] = { ...baseProps[overlayKey], overlay: undefined };
    }

    if (baseProps.play) {
      baseProps.play = normalizePrimaryEntry(baseProps.play);
    }

    if (baseProps.queue) {
      baseProps.queue = normalizePrimaryEntry(baseProps.queue);
    }

    return baseProps;
  }, [props, isQueue]);

  const overlayConfig = React.useMemo(() => (isQueue ? queue?.overlay : play?.overlay) || null, [play, queue, isQueue]);

  const overlayProps = React.useMemo(() => {
    if (!overlayConfig) return null;

    const ensureSecondsReset = (entry = {}) => ({
      ...entry,
      seconds: 0,
      resume: false,
      shader: entry.shader || 'minimal'
    });

    const normalizeOverlayValue = (value) => (
      Array.isArray(value) ? value.map(ensureSecondsReset) : ensureSecondsReset(value)
    );

    if (Array.isArray(overlayConfig)) {
      return { queue: overlayConfig.map(ensureSecondsReset) };
    }

    if (typeof overlayConfig === 'string' || typeof overlayConfig === 'number') {
      return { queue: { plex: overlayConfig, shuffle: 1 } };
    }

    if (overlayConfig.play || overlayConfig.queue) {
      if (overlayConfig.queue) {
        return { queue: normalizeOverlayValue(overlayConfig.queue) };
      }
      return { play: normalizeOverlayValue(overlayConfig.play) };
    }

    const normalized = ensureSecondsReset(overlayConfig);
    const targetKey = normalized.playlist || normalized.queue || normalized.plex || normalized.media
      ? 'queue'
      : 'play';

    if (targetKey === 'queue') {
      return { queue: { ...normalized, shuffle: normalized.shuffle ?? 1 } };
    }

    return { play: normalized };
  }, [overlayConfig]);

  const primaryKeyboardOverrides = React.useMemo(() => {
    if (!overlayProps) return primaryProps.keyboardOverrides;
    return {
      ...(primaryProps.keyboardOverrides || {}),
      'ArrowLeft': () => {},
      'ArrowRight': () => {},
      'j': () => {},
      'l': () => {},
      'n': () => {},
      'p': () => {},
      'MediaNextTrack': () => {},
      'MediaPreviousTrack': () => {}
    };
  }, [overlayProps, primaryProps.keyboardOverrides]);

  const shader = (
    primaryProps.play?.shader
    || primaryProps.queue?.shader
    || 'regular'
  );

  return (
    <CompositeControllerProvider config={props.coordination}>
      <div className={`player composite ${shader}`}>
        {overlayProps && (
          <div data-track="audio">
            <Player
              playerType="overlay"
              ignoreKeys={props.ignoreKeys}
              clear={noop}
              plexClientSession={overlayPlexSession}
              {...overlayProps}
            />
          </div>
        )}
        <div data-track="visual">
          <Player
            playerType="primary"
            plexClientSession={primaryPlexSession}
            {...primaryProps}
            keyboardOverrides={primaryKeyboardOverrides}
          />
        </div>
      </div>
    </CompositeControllerProvider>
  );
}

LegacyFormatComposite.propTypes = {
  play: PropTypes.object,
  queue: PropTypes.object,
  Player: PropTypes.elementType.isRequired,
  coordination: PropTypes.object,
  ignoreKeys: PropTypes.bool
};

/**
 * SourceResolver - Resolves unresolved sources via backend /api/content/compose
 * Handles the case where URL params provide sources that need resolution
 */
function SourceResolver({ sources, config, Player, ignoreKeys, coordination }) {
  const [resolvedTracks, setResolvedTracks] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!sources || sources.length === 0) {
      setLoading(false);
      return;
    }

    const resolveSources = async () => {
      try {
        const response = await fetch('/api/v1/content/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources, config })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${response.status}`);
        }

        const presentation = await response.json();
        setResolvedTracks(presentation);
      } catch (err) {
        console.error('[SourceResolver] Failed to resolve sources:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    resolveSources();
  }, [sources, config]);

  if (loading) {
    return (
      <div className="player composite" data-loading="true">
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666'
        }}>
          Loading presentation...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="player composite" data-error="true">
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#f66'
        }}>
          Error: {error}
        </div>
      </div>
    );
  }

  if (!resolvedTracks) {
    return null;
  }

  return (
    <CompositeProvider>
      <NewFormatComposite
        visual={resolvedTracks.visual}
        audio={resolvedTracks.audio}
        Player={Player}
        ignoreKeys={ignoreKeys}
        coordination={coordination}
      />
    </CompositeProvider>
  );
}

SourceResolver.propTypes = {
  sources: PropTypes.arrayOf(PropTypes.string).isRequired,
  config: PropTypes.object,
  Player: PropTypes.elementType.isRequired,
  ignoreKeys: PropTypes.bool,
  coordination: PropTypes.object
};

/**
 * CompositePlayer - Main entry point
 *
 * Detects format and delegates to appropriate implementation:
 * - Unresolved sources (compose.sources): Resolves via backend then renders
 * - New format (visual/audio tracks): Uses VisualRenderer + CompositeContext
 * - Old format (play.overlay): Uses legacy Player-based approach
 */
export function CompositePlayer(props) {
  const { visual, audio, compose, play, queue, Player, coordination, sources: topLevelSources } = props;

  // Detect new format: explicit visual/audio tracks, compose object, or sources array
  const isNewFormat = !!(visual || audio || compose || topLevelSources);

  if (isNewFormat) {
    // Check if we have unresolved sources that need backend resolution
    // Sources can be in compose.sources or directly in props.sources
    const unresolvedSources = compose?.sources ?? topLevelSources;
    if (unresolvedSources && Array.isArray(unresolvedSources)) {
      // Extract config from either compose or props
      const { sources: _, ...configFromCompose } = compose || {};
      const { sources: __, Player: ___, coordination: ____, ...configFromProps } = props;
      const config = { ...configFromProps, ...configFromCompose };
      return (
        <SourceResolver
          sources={unresolvedSources}
          config={config}
          Player={Player}
          ignoreKeys={props.ignoreKeys}
          coordination={coordination}
        />
      );
    }

    // Extract tracks from compose object if provided (already resolved)
    const visualTrack = visual || compose?.visual;
    const audioTrack = audio || compose?.audio;

    return (
      <CompositeProvider>
        <NewFormatComposite
          visual={visualTrack}
          audio={audioTrack}
          Player={Player}
          ignoreKeys={props.ignoreKeys}
          coordination={coordination}
        />
      </CompositeProvider>
    );
  }

  // Legacy format with play.overlay or queue.overlay
  return <LegacyFormatComposite {...props} />;
}

CompositePlayer.propTypes = {
  // New format props
  visual: PropTypes.shape({
    category: PropTypes.oneOf(['media', 'app']),
    type: PropTypes.string,
    app: PropTypes.string,
    items: PropTypes.array,
    advance: PropTypes.object,
    loop: PropTypes.bool,
    shader: PropTypes.string
  }),
  audio: PropTypes.shape({
    items: PropTypes.array,
    play: PropTypes.object,
    queue: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
    plex: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    shuffle: PropTypes.oneOfType([PropTypes.bool, PropTypes.number])
  }),
  compose: PropTypes.shape({
    // Unresolved sources (from URL params)
    sources: PropTypes.arrayOf(PropTypes.string),
    // Resolved tracks (from backend)
    visual: PropTypes.object,
    audio: PropTypes.object
  }),

  // Legacy format props
  play: PropTypes.object,
  queue: PropTypes.object,

  // Shared props
  Player: PropTypes.elementType.isRequired,
  coordination: PropTypes.shape({
    overlayStallStrategy: PropTypes.oneOf(['mute-overlay', 'pause-primary'])
  }),
  ignoreKeys: PropTypes.bool
};
