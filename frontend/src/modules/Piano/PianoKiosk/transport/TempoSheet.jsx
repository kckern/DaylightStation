import Icon from '../icons/Icon.jsx';
import TransportSheet from './TransportSheet.jsx';
import StepGrid from './StepGrid.jsx';

// The kiosk's canonical practice-tempo ladder (percent of written tempo).
// NOT Producer's absolute-BPM sheet — that stays in producer/ until a later wave.
// Nine steps, laid out as a 3×3 grid (wave-2 T6) rather than one long row.
export const TEMPO_STEPS = [
  { label: '50%', value: 0.5 }, { label: '60%', value: 0.6 }, { label: '70%', value: 0.7 },
  { label: '80%', value: 0.8 }, { label: '90%', value: 0.9 }, { label: '100%', value: 1 },
  { label: '110%', value: 1.1 }, { label: '125%', value: 1.25 }, { label: '150%', value: 1.5 },
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
 * notation). Wave-2 T6: nine steps laid out as three rows of three (a 3×3
 * ladder) rather than one long row, so the sheet stays compact on the tablet.
 */
export default function TempoSheet({ open, onClose, value = 1, onPick, baseBpm = 90 }) {
  const idx = nearestStep(TEMPO_STEPS, value);
  const row = (start) => (
    <StepGrid
      key={start}
      steps={TEMPO_STEPS.slice(start, start + 3).map((s) => ({
        label: s.label,
        sub: (<><Icon name="quarter-note" /> {Math.round(baseBpm * s.value)}</>),
      }))}
      activeIndex={idx >= start && idx < start + 3 ? idx - start : -1}
      onPick={(i) => onPick(TEMPO_STEPS[start + i].value)}
      ariaLabel={`Tempo ${start / 3 + 1}`}
    />
  );
  return (
    <TransportSheet open={open} title="Tempo" onClose={onClose}>
      {row(0)}
      {row(3)}
      {row(6)}
    </TransportSheet>
  );
}
