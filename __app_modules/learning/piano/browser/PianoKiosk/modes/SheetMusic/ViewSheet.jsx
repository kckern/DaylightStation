import TransportSheet from '../../transport/TransportSheet.jsx';
import StepGrid from '../../transport/StepGrid.jsx';
import ToggleSwitch from '../../transport/ToggleSwitch.jsx';
import { nearestStep } from '../../transport/tempoSteps.js';

/**
 * ViewSheet — the "how the score looks" panel behind the View button (audit
 * J5/M4; wave-2 T8 ports this off the old bespoke ViewMenu popover onto the
 * shared {@link TransportSheet} shell, matching Key/Tempo: a centered sheet
 * with its own scrim instead of a corner-anchored popover). The metadata
 * ("About") block moves out entirely — this is controls only, not an info
 * panel.
 *
 * Presentational: open/close is owned by the parent (one boolean per sheet).
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {() => void} p.onClose
 * @param {number} p.scale
 * @param {number} [p.maxScale] - the largest size at which a whole system still fits the window; larger steps are disabled in place
 * @param {(v:number) => void} p.onScale
 * @param {boolean} p.keyboardVisible
 * @param {() => void} p.onToggleKeyboard
 */
export const SIZE_STEPS = [
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
];

export default function ViewSheet({ open, onClose, scale, maxScale = Infinity, onScale, keyboardVisible, onToggleKeyboard }) {
  const sizeIdx = nearestStep(SIZE_STEPS, scale);
  return (
    <TransportSheet open={open} title="View" onClose={onClose}>
      <div className="piano-score-view-row" role="group" aria-label="Size">
        <span className="piano-score-view-row__label">Size</span>
        <StepGrid
          steps={SIZE_STEPS.map((s) => ({ label: s.label, disabled: s.value > maxScale }))}
          activeIndex={sizeIdx}
          onPick={(i) => onScale?.(SIZE_STEPS[i].value)}
          ariaLabel="Size"
        />
      </div>

      <div className="piano-score-view-row">
        <ToggleSwitch
          label="Keyboard"
          checked={keyboardVisible}
          onChange={onToggleKeyboard}
        />
      </div>
    </TransportSheet>
  );
}
