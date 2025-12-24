import React from 'react';
import PropTypes from 'prop-types';
import { AppIconButton, ProgressBar } from '../../primitives';
import './MusicPlayerWidget.scss';

const MusicPlayerWidget = ({
  track,
  isPlaying = false,
  onPlayPause,
  onNext,
  onPrevious,
  progress = 0,
  duration = 0,
  className,
  ...props
}) => {
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className={`music-player-widget ${className || ''}`} {...props}>
      <div className="music-player-widget__cover">
        {track?.coverUrl ? (
          <img src={track.coverUrl} alt={track.title} />
        ) : (
          <div className="music-player-widget__cover-placeholder">♪</div>
        )}
      </div>

      <div className="music-player-widget__info">
        <div className="music-player-widget__title">{track?.title || 'No Track'}</div>
        <div className="music-player-widget__artist">{track?.artist || 'Unknown Artist'}</div>
        
        <div className="music-player-widget__progress-container">
          <ProgressBar 
            value={progress} 
            max={duration} 
            size="xs" 
            showLabel={false} 
            animated={false}
          />
          <div className="music-player-widget__time">
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="music-player-widget__controls">
          <AppIconButton
            icon={<span>⏮</span>}
            variant="ghost"
            size="sm"
            onClick={onPrevious}
            ariaLabel="Previous"
          />
          <AppIconButton
            icon={isPlaying ? <span>⏸</span> : <span>▶</span>}
            variant="primary"
            size="md"
            shape="circle"
            onClick={onPlayPause}
            ariaLabel={isPlaying ? 'Pause' : 'Play'}
          />
          <AppIconButton
            icon={<span>⏭</span>}
            variant="ghost"
            size="sm"
            onClick={onNext}
            ariaLabel="Next"
          />
        </div>
      </div>
    </div>
  );
};

MusicPlayerWidget.propTypes = {
  track: PropTypes.shape({
    title: PropTypes.string,
    artist: PropTypes.string,
    coverUrl: PropTypes.string
  }),
  isPlaying: PropTypes.bool,
  onPlayPause: PropTypes.func,
  onNext: PropTypes.func,
  onPrevious: PropTypes.func,
  progress: PropTypes.number,
  duration: PropTypes.number,
  className: PropTypes.string
};

export default MusicPlayerWidget;
