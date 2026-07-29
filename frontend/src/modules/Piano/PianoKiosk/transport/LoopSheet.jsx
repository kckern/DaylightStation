import TransportSheet from './TransportSheet.jsx';
import TransportButton from './TransportButton.jsx';

/**
 * LoopSheet — the score loop picker on the shared sheet (was the LoopControl
 * popover): rehearsal-mark sections, the guided "Select measures…" two-tap
 * flow, and (when active) Clear plus ±1-measure Start/End nudges. Nudges keep
 * the sheet open so endpoints can be walked without redoing the selection.
 */
export default function LoopSheet({
  open, onClose, active = false, sections = [],
  onPickSection, onStartSelect, onClearFocus, onNudge,
}) {
  const pickAndClose = (fn, arg) => { fn?.(arg); onClose(); };
  return (
    <TransportSheet open={open} title="Loop" onClose={onClose}>
      <div className="piano-loopsheet__options">
        {sections.map((s) => (
          <TransportButton key={s.label} label={s.label} onPress={() => pickAndClose(onPickSection, s)} />
        ))}
        <TransportButton label="Select measures…" onPress={() => pickAndClose(onStartSelect)} />
        {active && <TransportButton label="Clear loop" onPress={() => pickAndClose(onClearFocus)} />}
      </div>
      {active && (
        <div className="piano-loopsheet__nudge" role="group" aria-label="Adjust loop">
          <span>Start</span>
          <TransportButton icon="minus" ariaLabel="Loop start earlier" onPress={() => onNudge?.('in', -1)} />
          <TransportButton icon="plus" ariaLabel="Loop start later" onPress={() => onNudge?.('in', 1)} />
          <span>End</span>
          <TransportButton icon="minus" ariaLabel="Loop end earlier" onPress={() => onNudge?.('out', -1)} />
          <TransportButton icon="plus" ariaLabel="Loop end later" onPress={() => onNudge?.('out', 1)} />
        </div>
      )}
    </TransportSheet>
  );
}
