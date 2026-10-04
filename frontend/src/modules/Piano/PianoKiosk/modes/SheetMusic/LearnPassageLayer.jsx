import { rangeBands } from './focusRangeGeometry.js';

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
      return <button
        key={passage.id}
        type="button"
        className={`piano-learn-passage-map${passage.id === selectedId ? ' is-selected' : ''}`}
        data-state={passage.testedOut ? 'tested-out' : passage.complete ? 'complete' : 'open'}
        aria-label={`${passage.label}${passage.testedOut ? ', tested out' : passage.complete ? ', complete' : ''}`}
        style={{ left: first.left + 4, top: first.top + 4 }}
        onClick={(event) => { event.stopPropagation(); onSelect?.(passage.id); }}
      >{passage.order}</button>;
    })}
  </>;
}
