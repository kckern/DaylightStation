import { rangeBands } from './focusRangeGeometry.js';

const passageState = (passage) => passage.locked ? ['locked', 'Locked']
  : passage.testedOut ? ['tested-out', 'Tested out']
  : passage.complete ? ['mastered', 'Mastered']
  : passage.inProgress ? ['in-progress', 'In progress']
  : passage.recommended ? ['next', 'Next'] : ['unstarted', 'Unstarted'];

export default function LearnPassageLayer({
  passages = [], measures = [], stepBoxes = [], measureRects = [], selectedId = null,
  selectedRange = null, onSelect,
}) {
  const selected = selectedRange || passages.find((passage) => passage.id === selectedId);
  const outlines = selected ? rangeBands(measures, stepBoxes, selected, measureRects) : [];
  return <>
    {outlines.map((band, index) => <div
      key={`outline-${index}`}
      className="piano-learn-selection-outline"
      aria-hidden="true"
      style={{ left: band.left, top: band.top, width: Math.max(band.right - band.left, 8), height: band.bottom - band.top }}
    />)}
    {passages.map((passage) => {
      const first = rangeBands(measures, stepBoxes, {
        inMeasure: passage.inMeasure,
        outMeasure: passage.inMeasure,
      }, measureRects)[0];
      if (!first) return null;
      const [state, stateLabel] = passageState(passage);
      return <button
        key={passage.id}
        type="button"
        className={`piano-learn-passage-map${passage.id === selectedId ? ' is-selected' : ''}`}
        data-state={state}
        disabled={passage.locked}
        aria-label={[passage.label, passage.name, passage.barLabel, stateLabel].filter(Boolean).join(', ')}
        style={{ left: first.left + 4, top: first.top + 4 }}
        onClick={(event) => { event.stopPropagation(); onSelect?.(passage.id); }}
      ><span aria-hidden="true">{passage.number ?? passage.order}</span><small aria-hidden="true">{stateLabel}</small></button>;
    })}
  </>;
}
