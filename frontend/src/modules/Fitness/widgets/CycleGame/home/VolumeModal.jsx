import React from 'react';
import PropTypes from 'prop-types';
import { TouchVolumeButtons, snapToTouchLevel, linearVolumeFromLevel, linearLevelFromVolume } from '@/modules/Fitness/player/panels/TouchVolumeButtons.jsx';
import { useEscapeToClose } from './useEscapeToClose.js';
import './picker.scss';
import './VolumeModal.scss';

/**
 * Master-volume modal — the rail's volume strip moved behind a lone icon so the
 * rail can lead with high scores + history. Reuses the picker modal chrome.
 */
export function VolumeModal({ volume = 1, muted = false, onSetVolume, onClose }) {
  useEscapeToClose(onClose);
  return (
    <div className="cgh-picker cgh-picker--volume" role="dialog" aria-modal="true" data-testid="cycle-game-volume-modal">
      <div className="cgh-picker__backdrop" onClick={onClose} />
      <div className="cgh-picker__sheet cgh-volume-sheet">
        <div className="cgh-picker__head">
          <div className="cgh-picker__heading">
            <div className="cgh-section-label cgh-section-label--sub">Master volume</div>
            <div className="cgh-picker__bike" data-testid="cycle-game-volume-readout">
              {muted ? 'Muted' : `${Math.round((volume ?? 0) * 100)}%`}
            </div>
          </div>
          <button type="button" className="cgh-picker__close" aria-label="close" onClick={onClose}>×</button>
        </div>
        <div className="cgh-volume" data-testid="cycle-game-volume">
          <TouchVolumeButtons
            controlId="cycle-game-volume"
            currentLevel={snapToTouchLevel(linearLevelFromVolume(muted ? 0 : volume))}
            onSelect={(level) => onSetVolume?.(linearVolumeFromLevel(level))}
          />
        </div>
      </div>
    </div>
  );
}

VolumeModal.propTypes = {
  volume: PropTypes.number,
  muted: PropTypes.bool,
  onSetVolume: PropTypes.func,
  onClose: PropTypes.func
};

export default VolumeModal;
