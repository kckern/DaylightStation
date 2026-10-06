import TransportSheet from '../../transport/TransportSheet.jsx';

export default function LearnTempoSheet({ open, stages, selectedId, effectiveBpm, onPick, onClose }) {
  return <TransportSheet open={open} title="Practice tempo" onClose={onClose} className="piano-learn-tempo-sheet">
    {effectiveBpm > 0 && <p className="piano-learn-tempo-sheet__bpm">{effectiveBpm} BPM</p>}
    <div className="piano-learn-tempo-sheet__stages" role="group" aria-label="Tempo stages">
      {stages.map((stage) => <button key={stage.id} type="button"
        aria-pressed={stage.id === selectedId} data-autofocus={stage.id === selectedId ? '' : undefined}
        onClick={() => { onPick(stage); onClose(); }}>{stage.label}</button>)}
    </div>
    <button className="piano-learn-tempo-sheet__back" type="button" onClick={onClose}>Back</button>
  </TransportSheet>;
}
