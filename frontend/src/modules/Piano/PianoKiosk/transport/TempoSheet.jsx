import Icon from '../../ui/icons/Icon.jsx';
import TransportSheet from './TransportSheet.jsx';
import StepGrid from './StepGrid.jsx';
import { TEMPO_STEPS, nearestStep } from './tempoSteps.js';

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
