import PropTypes from 'prop-types';
import { TouchVolumeButtons } from '../../player/panels/TouchVolumeButtons.jsx';
import './DancePartyWidget.scss';

/**
 * DanceVolumeModal — touch volume sheet behind the bar's small volume icon.
 * Backdrop tap or ✕ closes; the TouchVolumeButtons strip is the only control.
 */
export default function DanceVolumeModal({ level, onSelect, onClose }) {
  return (
    <div className="dance-volume-modal" role="dialog" aria-modal="true" aria-label="Volume">
      <div className="dance-volume-modal__backdrop" onPointerDown={onClose} />
      <div className="dance-volume-modal__sheet">
        <div className="dance-volume-modal__header">
          <span id="dance-volume-label">Volume {level}%</span>
          <button type="button" aria-label="Close volume" onClick={onClose}>✕</button>
        </div>
        <TouchVolumeButtons
          controlId="dance-volume"
          currentLevel={level}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

DanceVolumeModal.propTypes = {
  level: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired
};
