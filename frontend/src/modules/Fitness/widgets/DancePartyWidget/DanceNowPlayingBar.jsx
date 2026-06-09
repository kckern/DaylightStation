import PropTypes from 'prop-types';
import { TouchVolumeButtons } from '../../player/panels/TouchVolumeButtons.jsx';
import './DancePartyWidget.scss';

export default function DanceNowPlayingBar({
  track, isPlaying, onPlayPause, onNext, onExit,
  volumeLevel = 100, onVolumeSelect
}) {
  return (
    <>
      <button type="button" className="dance-exit" aria-label="Exit dance party" onClick={onExit}>✕</button>
      <div className="dance-nowplaying">
        <div className="dance-cover">
          {track?.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className="dance-cover__ph">♪</span>}
        </div>
        <div className="dance-meta">
          <div className="dance-title">{track?.title || '— No Track —'}</div>
          <div className="dance-artist">{track?.artist || ''}</div>
        </div>
        {onVolumeSelect && (
          <div className="dance-volume" id="dance-volume-label" aria-label="Volume">
            <TouchVolumeButtons
              controlId="dance-volume"
              currentLevel={volumeLevel}
              onSelect={onVolumeSelect}
            />
          </div>
        )}
        <div className="dance-controls">
          <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onPlayPause}>{isPlaying ? '⏸' : '▶'}</button>
          <button type="button" aria-label="Next" onClick={onNext}>⏭</button>
        </div>
      </div>
    </>
  );
}

DanceNowPlayingBar.propTypes = {
  track: PropTypes.shape({ title: PropTypes.string, artist: PropTypes.string, coverUrl: PropTypes.string }),
  isPlaying: PropTypes.bool,
  onPlayPause: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
  onExit: PropTypes.func.isRequired,
  volumeLevel: PropTypes.number,
  onVolumeSelect: PropTypes.func
};
