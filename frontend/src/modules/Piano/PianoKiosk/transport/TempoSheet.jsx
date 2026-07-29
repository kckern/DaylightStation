import Icon from '../icons/Icon.jsx';
import TransportSheet from './TransportSheet.jsx';
import StepGrid from './StepGrid.jsx';

// The kiosk's canonical practice-tempo ladder (percent of written tempo).
// NOT Producer's absolute-BPM sheet — that stays in producer/ until a later wave.
export const TEMPO_STEPS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
];

/** Which step is lit for a current value — the nearest one by amount. */
export const nearestStep = (steps, val) => {
  let best = 0;
  let bestDist = Infinity;
  steps.forEach((s, i) => {
    const d = Math.abs(s.value - val);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
};

/**
 * TempoSheet — the practice-speed picker: percent steps, each sub-labeled with
 * the BPM it produces at this piece's written tempo (audit F12's `percent`
 * notation, now on the shared sheet).
 */
export default function TempoSheet({ open, onClose, value = 1, onPick, baseBpm = 90 }) {
  return (
    <TransportSheet open={open} title="Tempo" onClose={onClose}>
      <StepGrid
        steps={TEMPO_STEPS.map((s) => ({
          label: s.label,
          sub: (<><Icon name="quarter-note" /> {Math.round(baseBpm * s.value)}</>),
        }))}
        activeIndex={nearestStep(TEMPO_STEPS, value)}
        onPick={(i) => onPick(TEMPO_STEPS[i].value)}
        ariaLabel="Tempo"
      />
    </TransportSheet>
  );
}
