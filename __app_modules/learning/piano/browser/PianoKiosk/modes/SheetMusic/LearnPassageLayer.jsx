import { notationRangeBands, PASSAGE_NUMBER_LIFT, PASSAGE_NUMBER_SIZE } from './focusRangeGeometry.js';

const passageState = (passage) => passage.locked ? ['locked', 'Locked']
  : passage.testedOut ? ['tested-out', 'Tested out']
  : passage.complete ? ['mastered', 'Mastered']
  : passage.inProgress ? ['in-progress', 'In progress']
  : passage.recommended ? ['next', 'Next'] : ['unstarted', 'Unstarted'];

/**
 * The passage map over the engraved score: a numbered disc over the first system
 * each passage reaches, its hitboxes, and the boxes for a chosen passage.
 * `numbers` (from passageNumberPlacements) places each disc clear of the ink in
 * its column, in the room the engraving keeps above every system; without it a
 * disc stands a fixed lift over its band. `view` (`{ top, bottom }` in the same
 * coordinates: what the page shows of the engraving) keeps every disc whole: one
 * that would cross its edge is not drawn at all.
 */
export default function LearnPassageLayer({
  passages = [], measures = [], stepBoxes = [], measureRects = [], numbers = null, selectedId = null,
  selectedRange = null, focusId = null, achievementId = null, view = null, onAchievementEnd, onSelect,
}) {
  const selected = selectedRange || passages.find((passage) => passage.id === selectedId);
  const outlines = selected ? notationRangeBands(measures, stepBoxes, selected, measureRects) : [];
  // The passage chosen on the rail or the board: boxed on every system it spans.
  const focused = focusId ? passages.find((passage) => passage.id === focusId) : null;
  const boxes = focused ? notationRangeBands(measures, stepBoxes, focused, measureRects) : [];
  const placed = new Map((numbers || []).map((number) => [number.id, number]));
  return <>
    {boxes.map((band, index) => <div
      key={`focus-${index}`}
      className="piano-learn-selection-box"
      data-passage={focused.id}
      aria-hidden="true"
      style={{ left: band.left - 3, top: band.top - 6, width: Math.max(band.right - band.left, 8) + 6, height: Math.max(band.bottom - band.top, 8) + 12 }}
    />)}
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
      const at = placed.has(passage.id)
        ? { left: placed.get(passage.id).left, top: placed.get(passage.id).top }
        : { left: first.left + 4, top: Math.max(2, first.top - PASSAGE_NUMBER_LIFT) };
      const whole = !view || (at.top >= view.top && at.top + PASSAGE_NUMBER_SIZE <= view.bottom);
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
        {whole && <button
          type="button"
          className={`piano-learn-passage-map${passage.id === selectedId || passage.id === focusId ? ' is-selected' : ''}${passage.id === achievementId ? ' is-achievement' : ''}`}
          data-state={state}
          disabled={passage.locked}
          aria-label={label}
          style={at}
          onClick={select}
          onAnimationEnd={() => { if (passage.id === achievementId) onAchievementEnd?.(passage.id); }}
        ><span aria-hidden="true">{passage.number ?? passage.order}</span></button>}
      </span>;
    })}
  </>;
}
