import { useEffect, useRef } from 'react';
import PassageCoin from './PassageCoin.jsx';
import { boardColumns } from './passageRail.js';
import LevelLadder from './LevelLadder.jsx';

const Close = () => <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const Play = () => <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><path d="M5.5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L6.4 3.1a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>;

/**
 * The passage board: the piece's table of contents and trophy board, and the path's mirror. Every
 * passage is a lettered card (its coin or disc, its bars, its steps while under way); every join
 * played through is a silver card named for its span; the join on offer is a socket card; the same
 * single play disc marks the unit a tap on the path opens. Its header carries the same level ladder as
 * the path (Bronze → Silver → Gold → Diamond, the lap the child is on and its count; the Diamond is
 * filled from `polish.diamond` through the model) with the one "earn a gem" when that lap pays one. Its cards are shared evenly between the rows
 * (`boardColumns`), so no row ends in blank cells. It slides over the score from the path without
 * moving the music, and closes only with its own control. Tapping a card selects that unit.
 */
export default function PassageBoard({ title, model, focusId = null, gemOffered = false, review = false, onSelect, onReview, onClose }) {
  const cards = useRef(null);
  const close = useRef(null);
  useEffect(() => { close.current?.focus?.({ preventScroll: true }); }, []);
  useEffect(() => {
    const wanted = focusId ?? model.outlinedId;
    const card = wanted && cards.current?.querySelector(`[data-passage="${CSS.escape(wanted)}"]`);
    card?.scrollIntoView?.({ block: 'nearest' });
  }, [focusId, model.outlinedId]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const list = model.cards ?? model.tiles;
  const current = focusId ?? model.outlinedId;
  return <section className="piano-passage-board" role="dialog" aria-label="Passage board">
    <header className="piano-passage-board__head">
      <h2 className="piano-passage-board__title">{title}</h2>
      <LevelLadder ladder={model.ladder} gemOffered={gemOffered} className="piano-passage-board__ladder" />
      {review && <button type="button" className="piano-passage-board__review" onClick={onReview}>Review a passage</button>}
      <button ref={close} type="button" className="piano-passage-board__close" onClick={onClose}><Close /><span>Close</span></button>
    </header>
    <ol ref={cards} className="piano-passage-board__cards" style={{ gridTemplateColumns: `repeat(${boardColumns(list.length)}, minmax(0, 1fr))` }}>
      {list.map((card) => <li key={card.id}>
        <button type="button" className="piano-passage-board__card" data-passage={card.id} data-state={card.state} data-kind={card.kind ?? 'passage'}
          aria-current={card.id === current ? 'step' : undefined} aria-label={card.label} onClick={() => onSelect?.(card.id)}>
          <span className="piano-passage-board__coin">
            <PassageCoin state={card.state} letter={card.letter} ring={card.ring} size="100%" />
            {card.id === model.outlinedId && <i className="piano-passage-board__play" aria-hidden="true"><Play /></i>}
          </span>
          <strong>{card.bars}</strong>
          {card.underway && <span className="piano-passage-board__steps" aria-hidden="true">
            {Array.from({ length: card.steps.total }, (_, step) => <i key={step} data-done={step < card.steps.done} />)}
          </span>}
        </button>
      </li>)}
    </ol>
  </section>;
}
