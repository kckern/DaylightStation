import TransportSheet from './TransportSheet.jsx';
import StepGrid from './StepGrid.jsx';
import { soundingKeyLabel } from './soundingKey.js';
import { abbrevKey } from '../modes/SheetMusic/keyLabel.js';

// ASCII labels only (house rule): '-6'..'-1', '0', '+1'..'+6'.
const DOWN = [-6, -5, -4, -3, -2, -1];
const UP = [1, 2, 3, 4, 5, 6];
const label = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * KeySheet — direct-pick transpose: every semitone offset −6…+6 is its own
 * 48px target with the current offset lit (replaces the old −/+ text-glyph
 * stepper, audit F2/F11). Values outside ±6 clamp to the nearest edge for
 * display only; onPick always emits the tapped offset.
 */
export default function KeySheet({ open, onClose, value = 0, onPick, keyFifths, keyMode }) {
  const v = Math.max(-6, Math.min(6, value));
  // Each cell speaks the SOUNDING key when the written key is known (label =
  // key name, sub = offset), so the picker reads "D major / +2" instead of a
  // bare offset; unknown key falls back to today's offset-only label.
  const cell = (n) => {
    const name = soundingKeyLabel(keyFifths, keyMode, n);
    return name ? { label: abbrevKey(name), sub: label(n) } : { label: label(n) };
  };
  const row = (values) => (
    <StepGrid
      steps={values.map(cell)}
      activeIndex={values.indexOf(v)}
      onPick={(i) => onPick(values[i])}
      ariaLabel={values[0] < 0 ? 'Transpose down' : values[0] === 0 ? 'No transpose' : 'Transpose up'}
    />
  );
  const sounding = soundingKeyLabel(keyFifths, keyMode, v);
  return (
    <TransportSheet open={open} title="Key" onClose={onClose}>
      {row(DOWN)}
      {row([0])}
      {row(UP)}
      {sounding && <p className="piano-keysheet__sounding">Sounding key: {sounding}</p>}
    </TransportSheet>
  );
}
