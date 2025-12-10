import React from 'react';
import PropTypes from 'prop-types';
import { CompositeControllerProvider } from './CompositeControllerContext.jsx';

/**
 * Composite Player - Video player with audio overlay
 * Use cases:
 * - Workout video with audio playlist
 * - Ambient video with modular background music
 * - Sermon video with background hymns or talks
 */
export function CompositePlayer(props) {
  const { play, queue, Player } = props;
  const isQueue = !!queue;
  const noop = React.useCallback(() => {}, []);

  const primaryProps = React.useMemo(() => {
    const { coordination: _ignoredCoordination, Player: _ignoredPlayer, ...baseProps } = props;
    const overlayKey = isQueue ? 'queue' : 'play';
    const normalizePrimaryEntry = (value) => {
      if (!value) return value;
      const applyDefaults = (entry) => {
        const originalSeconds = entry.seconds;
        const normalized = {
          ...entry,
          seconds: 0,
          resume: false,
          shader: 'minimal'
        };
        return normalized;
      };
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

    const ensureSecondsReset = (entry = {}) => {
      const originalSeconds = entry.seconds;
      const normalized = {
        ...entry,
        seconds: 0,
          resume: false,
          shader: entry.shader || 'minimal'
        };
        return normalized;
      };    const normalizeOverlayValue = (value) => (
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

  const shader = (
    primaryProps.play?.shader
    || primaryProps.queue?.shader
    || 'regular'
  );

  return (
    <CompositeControllerProvider config={props.coordination}>
      <div className={`player composite ${shader}`}>
        {overlayProps && (
          <Player
            playerType="overlay"
            ignoreKeys
            clear={noop}
            {...overlayProps}
          />
        )}
        <Player
          playerType="primary"
          {...primaryProps}
          ignoreKeys
        />
      </div>
    </CompositeControllerProvider>
  );
}

CompositePlayer.propTypes = {
  play: PropTypes.object,
  queue: PropTypes.object,
  Player: PropTypes.elementType.isRequired,
  coordination: PropTypes.shape({
    overlayStallStrategy: PropTypes.oneOf(['mute-overlay', 'pause-primary'])
  })
};
