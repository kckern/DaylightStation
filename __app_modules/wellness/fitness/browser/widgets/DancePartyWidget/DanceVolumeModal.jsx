import PropTypes from 'prop-types';
import { TouchVolumeButtons } from "../../../../../../__capabilities/playback/browser/volume/TouchVolumeButtons.jsx";
import "./DancePartyWidget.scss";

/**
 * DanceVolumeModal — touch volume sheet behind the bar's small volume icon.
 * One labelled TouchVolumeButtons strip per channel (music, and the video's
 * own sound when the ambience keeps it). Backdrop tap or ✕ closes.
 */
export default function DanceVolumeModal({ channels, onClose }) {
  const single = channels.length === 1;
  return (
    <div className="dance-volume-modal" role="dialog" aria-modal="true" aria-label="Volume">
      <div className="dance-volume-modal__backdrop" onPointerDown={onClose} />
      <div className="dance-volume-modal__sheet">
        {channels.map((ch, i) => (
          <div className="dance-volume-modal__channel" key={ch.id}>
            <div className="dance-volume-modal__header">
              <span>{single ? 'Volume' : ch.label} {ch.level}%</span>
              {i === 0 && <button type="button" aria-label="Close volume" onClick={onClose}>✕</button>}
            </div>
            <TouchVolumeButtons
              controlId={`dance-volume-${ch.id}`}
              currentLevel={ch.level}
              onSelect={ch.onSelect}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

DanceVolumeModal.propTypes = {
  channels: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    level: PropTypes.number.isRequired,
    onSelect: PropTypes.func.isRequired
  })).isRequired,
  onClose: PropTypes.func.isRequired
};
