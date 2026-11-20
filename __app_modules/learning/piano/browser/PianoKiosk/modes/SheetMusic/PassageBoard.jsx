import { useEffect, useRef } from 'react';
import PassageCoin from './PassageCoin.jsx';
import { boardColumns } from './passageRail.js';

const Close = () => <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const Check = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/**
 * The passage board: the piece's table of contents and trophy board. Every
 * passage is its state icon: a tomato, a flower, a silver coin or a gold coin.
 * Its header counts the two goals, each beside its coin. Its cards are shared
 * evenly between the rows (`boardColumns`), so no row ends in blank cells. It slides
 * over the score from the rail without moving the music, and closes only with
 * its own control. Tapping a card selects that passage on the score.
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
  return <section className="piano-passage-board" role="dialog" aria-label="Passage board">
    <header className="piano-passage-board__head">
      <h2 className="piano-passage-board__title">{title}</h2>
      <ul className="piano-passage-board__goals" aria-label="Goals for this piece">
        {model.goals.map((goal) => <li key={goal.level} data-level={goal.level} data-reached={goal.reached}
          aria-label={`${goal.label}: ${goal.reached ? 'done' : `${goal.done} of ${goal.total}`}${!goal.reached && gemOffered ? ', earn a gem' : ''}`}>
          <PassageCoin state={goal.level} /><strong>{goal.done}/{goal.total}</strong>{goal.reached && <Check />}
          {!goal.reached && gemOffered && <span>earn a gem</span>}
        </li>)}
      </ul>
      {review && <button type="button" className="piano-passage-board__review" onClick={onReview}>Review a passage</button>}
      <button ref={close} type="button" className="piano-passage-board__close" onClick={onClose}><Close /><span>Close</span></button>
    </header>
    <ol ref={cards} className="piano-passage-board__cards" style={{ gridTemplateColumns: `repeat(${boardColumns(model.tiles.length)}, minmax(0, 1fr))` }}>
      {model.tiles.map((tile) => <li key={tile.id}>
        <button type="button" className="piano-passage-board__card" data-passage={tile.id} data-state={tile.state}
          aria-current={tile.id === (focusId ?? model.outlinedId) ? 'step' : undefined} aria-label={tile.label} onClick={() => onSelect?.(tile.id)}>
          <PassageCoin state={tile.state} />
          <strong>{tile.bars}</strong>
          {tile.underway && <span className="piano-passage-board__steps" aria-hidden="true">
            {Array.from({ length: tile.steps.total }, (_, step) => <i key={step} data-done={step < tile.steps.done} />)}
          </span>}
        </button>
      </li>)}
    </ol>
  </section>;
}
