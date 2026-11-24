import { useEffect, useRef } from 'react';
import PassageCoin from './PassageCoin.jsx';
import { boardColumns } from './passageRail.js';
import GemIcon from '../../../../../../../frontend/src/lib/icons/GemIcon.jsx';
import { polishStone } from './polishAwards.js';

const Close = () => <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const Check = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Play = () => <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><path d="M5.5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L6.4 3.1a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>;

/**
 * The passage board: the piece's table of contents and trophy board, and the path's mirror. Every
 * passage is a lettered card (its coin or disc, its bars, its steps while under way); every join
 * played through is a silver card named for its span; the join on offer is a socket card; the same
 * single play disc marks the unit a tap on the path opens. Its header counts the goals, each beside
 * its coin, then the piece's Polish gem once earned (the diamond in its place after that; `polish` is
 * `{ gem, diamond }` from the practice record GET). Its cards are shared evenly between the rows
 * (`boardColumns`), so no row ends in blank cells. It slides over the score from the path without
 * moving the music, and closes only with its own control. Tapping a card selects that unit.
 */
export default function PassageBoard({ title, model, focusId = null, gemOffered = false, polish = null, review = false, onSelect, onReview, onClose }) {
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
  const stone = polishStone(polish);
  const list = model.cards ?? model.tiles;
  const current = focusId ?? model.outlinedId;
  return <section className="piano-passage-board" role="dialog" aria-label="Passage board">
    <header className="piano-passage-board__head">
      <h2 className="piano-passage-board__title">{title}</h2>
      <ul className="piano-passage-board__goals" aria-label="Goals for this piece">
        {model.goals.map((goal) => <li key={goal.level} data-level={goal.level} data-reached={goal.reached}
          aria-label={`${goal.label}: ${goal.reached ? 'done' : `${goal.done} of ${goal.total}`}${!goal.reached && gemOffered ? ', earn a gem' : ''}`}>
          <PassageCoin state={goal.level} /><strong>{goal.done}/{goal.total}</strong>{goal.reached && <Check />}
          {!goal.reached && gemOffered && <span>earn a gem</span>}
        </li>)}
        {stone && <li data-level="polish" data-stone={stone.kind} aria-label={`${stone.label}: earned`}>
          <GemIcon size="2.2rem" color={stone.color} />
        </li>}
      </ul>
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
