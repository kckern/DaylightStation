import PropTypes from 'prop-types';
import VolumeControl from '../../shared/primitives/VolumeControl';
import './DancePartyWidget.scss';

// Snap points match TouchVolumeButtons' 10%-step touch levels.
const VOLUME_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export default function DanceNowPlayingBar({
  track, isPlaying, onPlayPause, onNext, onExit,
  volume = 100, muted = false, onVolumeChange, onMuteToggle
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
        {onVolumeChange && (
          <VolumeControl
            className="dance-volume"
            orientation="horizontal"
            size="sm"
            steps={VOLUME_STEPS}
            value={volume}
            muted={muted}
            onChange={onVolumeChange}
            onMuteToggle={onMuteToggle}
            showMute
            showValue={false}
            showButtons={false}
          />
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
  volume: PropTypes.number,
  muted: PropTypes.bool,
  onVolumeChange: PropTypes.func,
  onMuteToggle: PropTypes.func
};
