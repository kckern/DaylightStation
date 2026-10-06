import { notationRangeBands } from './focusRangeGeometry.js';

const passageState = (passage) => passage.locked ? ['locked', 'Locked']
  : passage.testedOut ? ['tested-out', 'Tested out']
  : passage.complete ? ['mastered', 'Mastered']
  : passage.inProgress ? ['in-progress', 'In progress']
  : passage.recommended ? ['next', 'Next'] : ['unstarted', 'Unstarted'];

export default function LearnPassageLayer({
  passages = [], measures = [], stepBoxes = [], measureRects = [], selectedId = null,
  selectedRange = null, achievementId = null, onAchievementEnd, onSelect,
}) {
  const selected = selectedRange || passages.find((passage) => passage.id === selectedId);
  const outlines = selected ? notationRangeBands(measures, stepBoxes, selected, measureRects) : [];
  return <>
    {outlines.map((band, index) => <div
      key={`outline-${index}`}
      className="piano-learn-selection-outline piano-learn-selection-bracket"
      aria-hidden="true"
      style={{ left: band.left, top: Math.max(2, band.top - 7), width: Math.max(band.right - band.left, 8), height: 7 }}
    />)}
    {passages.map((passage) => {
      const bands = notationRangeBands(measures, stepBoxes, passage, measureRects);
      const first = bands[0];
      if (!first) return null;
      const [state, stateLabel] = passageState(passage);
      const label = [passage.label, passage.name, passage.barLabel, stateLabel].filter(Boolean).join(', ');
      const select = (event) => { event.stopPropagation(); onSelect?.(passage.id); };
      return <span key={passage.id} className="piano-learn-passage-target">
        {bands.map((band, index) => <span
          key={`${passage.id}-hitbox-${index}`}
          className="piano-learn-passage-hitbox"
          aria-hidden="true"
          data-disabled={passage.locked || undefined}
          style={{ left: band.left, top: band.top, width: Math.max(band.right - band.left, 8), height: Math.max(band.bottom - band.top, 8) }}
          onClick={passage.locked ? undefined : select}
        />)}
        <button
          type="button"
          className={`piano-learn-passage-map${passage.id === selectedId ? ' is-selected' : ''}${passage.id === achievementId ? ' is-achievement' : ''}`}
          data-state={state}
          disabled={passage.locked}
          aria-label={label}
          style={{ left: first.left + 4, top: Math.max(2, first.top - 54) }}
          onClick={select}
          onAnimationEnd={() => { if (passage.id === achievementId) onAchievementEnd?.(passage.id); }}
        ><span aria-hidden="true">{passage.number ?? passage.order}</span></button>
      </span>;
    })}
  </>;
}
