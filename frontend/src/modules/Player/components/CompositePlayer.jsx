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
  const { play, queue, Player, coordination } = props;
  const isQueue = !!queue;

  const primaryProps = React.useMemo(() => {
    const { coordination: _ignoredCoordination, Player: _ignoredPlayer, ...baseProps } = props;
    const overlayKey = isQueue ? 'queue' : 'play';
    if (baseProps[overlayKey]) {
      const stripped = { ...baseProps[overlayKey], overlay: undefined };
      if (!stripped.shader) {
        stripped.shader = 'minimal';
      }
      stripped.seconds = 0;
      baseProps[overlayKey] = stripped;
    }
    return baseProps;
  }, [props, isQueue]);

  const overlayProps = React.useMemo(() => ({ 
    queue: { 
      plex: isQueue ? queue.overlay : play.overlay, 
      shuffle: 1 
    } 
  }), [play, queue, isQueue]);
  
  const shader = primaryProps.primary?.shader || primaryProps.overlay?.shader || 'regular';
  
  return (
    <CompositeControllerProvider config={coordination}>
      <div className={`player composite ${shader}`}>
        <Player playerType="overlay" {...overlayProps} />
        <Player playerType="primary" {...primaryProps} ignoreKeys />
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
