import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import DanceVolumeModal from './DanceVolumeModal.jsx';
import './DancePartyWidget.scss';

const volumeGlyph = (level) => (level === 0 ? '🔇' : level < 50 ? '🔉' : '🔊');

export default function DanceNowPlayingBar({
  track, isPlaying, onPlayPause, onNext, onExit,
  volumeLevel = 100, onVolumeSelect
}) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const closeVolume = useCallback(() => setVolumeOpen(false), []);
  return (
    <>
      <button type="button" className="dance-exit" aria-label="Exit dance party" onClick={onExit}>✕</button>
      {volumeOpen && onVolumeSelect && (
        <DanceVolumeModal level={volumeLevel} onSelect={onVolumeSelect} onClose={closeVolume} />
      )}
      <div className="dance-nowplaying">
        <div className="dance-cover">
          {track?.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className="dance-cover__ph">♪</span>}
        </div>
        <div className="dance-meta">
          <div className="dance-title">{track?.title || '— No Track —'}</div>
          <div className="dance-artist">{track?.artist || ''}</div>
        </div>
        <div className="dance-controls">
          {onVolumeSelect && (
            <button type="button" className="dance-volume-btn" aria-label="Volume" onClick={() => setVolumeOpen((v) => !v)}>
              {volumeGlyph(volumeLevel)}
            </button>
          )}
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
