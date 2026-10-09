// Deck tile (quizzes/flashcards): a card-stack motif (offset borders behind
// the card, static — no animation), title, "N items" meta (plus best-accuracy
// when known), and two 64px action buttons. The card body itself does NOT
// navigate — only Quiz/Cards act, each dispatching a launch mode via onOpen.
//
// launchingRef mirrors BankBrowser's double-tap guard (a ref, not state, so
// it blocks a second tap within the same synchronous burst before React
// would ever re-render): onOpen is the launch dispatcher and returns the
// in-flight promise precisely so this can await it.
import { useRef } from 'react';

export default function DeckTile({ item, onOpen }) {
  const launchingRef = useRef(false);
  const launch = async (mode) => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    try {
      await onOpen(item, mode);
    } finally {
      launchingRef.current = false;
    }
  };

  const meta = `${item.itemCount} items${item.bestAccuracy != null ? ` · ${item.bestAccuracy}% best` : ''}`;

  return (
    <li className="school-tile school-tile--deck">
      <div className="school-tile__stack">
        <div className="school-tile__card">
          <h3 className="school-tile__title">{item.title}</h3>
          <p className="school-tile__meta">{meta}</p>
          <div className="school-tile__deck-actions">
            <button type="button" onClick={() => launch('quiz')}>Quiz</button>
            <button type="button" onClick={() => launch('flashcard')}>Cards</button>
          </div>
        </div>
      </div>
    </li>
  );
}
