import TransportSheet from '../../transport/TransportSheet.jsx';
import TransportButton from '../../transport/TransportButton.jsx';

// The practice ladder, selected from the header's mode crumb (wave-2 B).
export const MODES = [
  { id: 'listen', label: 'Listen', icon: 'mode-listen' },
  { id: 'learn', label: 'Learn', icon: 'mode-learn' },
  { id: 'polish', label: 'Polish', icon: 'mode-polish' },
  { id: 'perform', label: 'Perform', icon: 'mode-perform' },
];

/** Centered mode picker: four icon rows; picking switches and closes. */
export default function ModeSheet({ open, onClose, mode, onPick }) {
  return (
    <TransportSheet open={open} title="Mode" onClose={onClose}>
      <div className="piano-modesheet" role="group" aria-label="Score mode">
        {MODES.map((m) => (
          <TransportButton
            key={m.id}
            icon={m.icon}
            label={m.label}
            on={mode === m.id}
            aria-pressed={mode === m.id}
            className="piano-modesheet__opt"
            onPress={() => { onPick(m.id); onClose(); }}
          />
        ))}
      </div>
    </TransportSheet>
  );
}
