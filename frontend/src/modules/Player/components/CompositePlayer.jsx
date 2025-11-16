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

  const primaryProps = React.useMemo(() => {
    const baseProps = { ...props };
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
    <div className={`player composite ${shader}`}>
      <Player playerType="overlay" {...overlayProps} />
      <Player playerType="primary" {...primaryProps} ignoreKeys={true} />
    </div>
  );
}

CompositePlayer.propTypes = {
  play: PropTypes.object,
  queue: PropTypes.object,
  Player: PropTypes.elementType.isRequired
};
