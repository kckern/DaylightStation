import { rangeBands } from './focusRangeGeometry.js';

export default function LearnPassageLayer({ passages = [], measures = [], stepBoxes = [], selectedId = null, onSelect }) {
  return passages.flatMap((passage) => rangeBands(measures, stepBoxes, {
    inMeasure: passage.inMeasure,
    outMeasure: passage.outMeasure,
  }).map((band, index) => (
    <button
      key={`${passage.id}:${index}`}
      type="button"
      className={`piano-learn-passage-map${passage.id === selectedId ? ' is-selected' : ''}`}
      data-state={passage.testedOut ? 'tested-out' : passage.complete ? 'complete' : 'open'}
      aria-label={`${passage.label}${passage.testedOut ? ', tested out' : passage.complete ? ', complete' : ''}`}
      style={{ left: band.left, top: band.top, width: Math.max(band.right - band.left, 8), height: band.bottom - band.top }}
      onClick={(event) => { event.stopPropagation(); onSelect(passage.id); }}
    >
      {index === 0 && <span>{passage.order}</span>}
    </button>
  )));
}
