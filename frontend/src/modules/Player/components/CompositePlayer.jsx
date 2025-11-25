import React from 'react';
import PropTypes from 'prop-types';

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
    if (baseProps[overlayKey]) {
      baseProps[overlayKey] = { ...baseProps[overlayKey], overlay: undefined };
    }
    return baseProps;
  }, [props, isQueue]);

  const overlayConfig = React.useMemo(() => (isQueue ? queue?.overlay : play?.overlay) || null, [play, queue, isQueue]);

  const overlayProps = React.useMemo(() => {
    if (!overlayConfig) return null;

    const ensureSecondsReset = (entry = {}) => ({
      ...entry,
      seconds: 0,
      shader: entry.shader || 'minimal'
    });

    if (Array.isArray(overlayConfig)) {
      return { queue: overlayConfig.map(ensureSecondsReset) };
    }

    if (typeof overlayConfig === 'string' || typeof overlayConfig === 'number') {
      return { queue: { plex: overlayConfig, shuffle: 1 } };
    }

    if (overlayConfig.play || overlayConfig.queue) {
      if (overlayConfig.queue) {
        return { queue: ensureSecondsReset(overlayConfig.queue) };
      }
      return { play: ensureSecondsReset(overlayConfig.play) };
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
    <div className={`player composite ${shader}`}>
      {overlayProps && <Player playerType="overlay" ignoreKeys clear={noop} {...overlayProps} />}
      <Player playerType="primary" {...primaryProps} ignoreKeys />
    </div>
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
