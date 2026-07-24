/**
 * Geography drill: server-graded (like QuizRunner) AND resurfacing (like
 * FlashcardRunner). Correct -> drop; wrong -> show the answer, requeue at the
 * end; unrecorded (record failed, grade unknown) -> requeue as not-mastered
 * with an inline banner, never strand. Ends when the queue empties.
 */
import { useRef, useState } from 'react';
import { useGradedSession } from './useGradedSession.js';
import RegionClickItem from '../quiz/items/RegionClickItem.jsx';
import AssetChoiceItem from '../quiz/items/AssetChoiceItem.jsx';
import MultipleChoiceItem from '../quiz/items/MultipleChoiceItem.jsx';

const ITEM_COMPONENTS = {
  region_click: RegionClickItem,
  asset_choice: AssetChoiceItem,
  multiple_choice: MultipleChoiceItem,
};

export default function GeoQuizRunner({ bank, onExit }) {
  const { sessionId, submit } = useGradedSession({ bank, mode: 'drill', onExit });
  const [queue, setQueue] = useState(bank.items);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [firstTry, setFirstTry] = useState(0);
  const [done, setDone] = useState(false);
  const missedOnce = useRef(new Set());
  const submittingRef = useRef(false);

  const total = bank.items.length;
  const card = queue[0];

  const onItemSubmit = async (given) => {
    if (!sessionId || verdict || submittingRef.current) return;
    submittingRef.current = true;
    const result = await submit(card.id, given);
    submittingRef.current = false;
    if (!result) return; // abandoned / exited
    if (result.unrecorded) { setUnrecorded(true); setVerdict({ unrecorded: true }); return; }
    setUnrecorded(false);
    setVerdict(result);
  };

  const next = () => {
    const wasUnrecorded = !!verdict?.unrecorded;
    const correct = !!verdict?.correct;
    setVerdict(null);
    setUnrecorded(false);
    if (correct) {
      if (!missedOnce.current.has(card.id)) setFirstTry((n) => n + 1);
      const rest = queue.slice(1);
      if (rest.length === 0) setDone(true); else setQueue(rest);
    } else {
      // wrong OR unrecorded -> not mastered, resurface at the end
      if (!wasUnrecorded) missedOnce.current.add(card.id);
      setQueue((q) => [...q.slice(1), q[0]]);
    }
  };

  if (done) {
    return (
      <div className="school-runner school-runner--summary" data-testid="geo-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">Mastered {total} / {total}</p>
        <p className="school-runner__hint">first try {firstTry}</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
      </div>
    );
  }
  if (!sessionId) {
    return (
      <div className="school-runner school-runner--geo" data-testid="geo-loading">
        <p className="school-runner__loading">Loading…</p>
      </div>
    );
  }
  if (!card) return null;
  const ItemComponent = ITEM_COMPONENTS[card.type];
  return (
    <div className="school-runner school-runner--geo">
      <div className="school-runner__progress">{queue.length} left</div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">Answer not recorded — check the server.</div>}
      <ItemComponent key={card.id} item={card} onSubmit={onItemSubmit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
    </div>
  );
}
