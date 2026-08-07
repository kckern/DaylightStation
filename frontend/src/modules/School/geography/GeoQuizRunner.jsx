/**
 * Geography drill: server-graded (like QuizRunner) AND resurfacing (like
 * FlashcardRunner). Correct -> drop; wrong -> show the answer, requeue at the
 * end; unrecorded (record failed, grade unknown) -> requeue as not-mastered
 * with an inline banner, never strand. Ends when the queue empties.
 *
 * Student-advocacy hardening (wave 7): a Stop button is always present (a
 * drill with no exit is a trap); a card missed twice grows a "Skip this one"
 * escape hatch (skipped, never mastered — the summary says so honestly); an
 * unknown item type renders an error card instead of crashing; a failed open
 * shows a sign instead of silently bouncing to the menu.
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
  const {
    sessionId, submit, openFailed, sessionLost, unsaved,
  } = useGradedSession({ bank, mode: 'drill', onExit });
  const [queue, setQueue] = useState(bank.items);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [firstTry, setFirstTry] = useState(0);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const missedOnce = useRef(new Set());
  const missCount = useRef(new Map());
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
      if (!wasUnrecorded) {
        missedOnce.current.add(card.id);
        missCount.current.set(card.id, (missCount.current.get(card.id) ?? 0) + 1);
      }
      setQueue((q) => [...q.slice(1), q[0]]);
    }
  };

  // The escape hatch for a card the child can't get: drop it from the queue
  // entirely. It stays un-mastered and the summary counts it honestly.
  const skip = () => {
    // An answer in flight owns the card: skipping now would rotate the queue
    // and land the late verdict on the NEXT card (M7 fix).
    if (submittingRef.current) return;
    setVerdict(null);
    setUnrecorded(false);
    setSkipped((n) => n + 1);
    const rest = queue.slice(1);
    if (rest.length === 0) setDone(true); else setQueue(rest);
  };

  if (openFailed) {
    return (
      <div className="school-runner school-runner--error" data-testid="geo-open-failed">
        <h2>{bank.title}</h2>
        <p>That one wouldn&rsquo;t open. Tell a grown-up, or try again in a bit.</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Back</button>
      </div>
    );
  }
  // A lost (410) session must show a sign, not a silent bounce — same
  // student-advocacy contract as openFailed above.
  if (sessionLost) {
    return (
      <div className="school-runner school-runner--error" data-testid="session-lost">
        <h2>{bank.title}</h2>
        <p>Your drill took a long break and timed out. Your finished answers are saved — start again to keep going.</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Back</button>
      </div>
    );
  }
  if (done) {
    const mastered = total - skipped;
    return (
      <div className="school-runner school-runner--summary" data-testid="geo-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__cheer" data-testid="geo-cheer">
          {skipped === 0 && firstTry === total
            ? 'Every one, first try — amazing!'
            : skipped === 0
              ? 'You mastered the whole set!'
              : 'Good work — the tricky ones will still be here next time.'}
        </p>
        <p className="school-runner__score">Mastered {mastered} / {total}</p>
        <p className="school-runner__hint">first try {firstTry}</p>
        {skipped > 0 && <p className="school-runner__skipped" data-testid="geo-skipped">{skipped} skipped for now</p>}
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
  if (!ItemComponent) {
    // A bank authored with an item type this runner can't draw must not
    // white-screen the kiosk mid-drill — show the sign and offer the exit.
    return (
      <div className="school-runner school-runner--error" data-testid="geo-bad-item">
        <h2>{bank.title}</h2>
        <p>This one won&rsquo;t load right. Tell a grown-up what happened.</p>
        <button type="button" className="school-runner__done" onClick={skip}>Skip it</button>
        <button type="button" className="school-runner__done" onClick={onExit}>Stop</button>
      </div>
    );
  }
  const canSkip = (missCount.current.get(card.id) ?? 0) >= 2;
  return (
    <div className="school-runner school-runner--geo">
      {unsaved && (
        <div className="school-runner__guest" data-testid="guest-banner">
          Playing as guest — this won&rsquo;t be saved.
        </div>
      )}
      <div className="school-runner__progress">
        <span>{queue.length} left</span>
        <button type="button" className="school-runner__stop" data-testid="geo-stop" onClick={onExit}>Stop</button>
      </div>
      {unrecorded && (
        <div className="school-runner__unrecorded" data-testid="unrecorded">
          That one didn&rsquo;t save. Keep going — tell a grown-up if this keeps happening.
        </div>
      )}
      <ItemComponent key={`${card.id}:${missCount.current.get(card.id) ?? 0}`} item={card} onSubmit={onItemSubmit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
      {canSkip && !verdict && (
        <button type="button" className="school-runner__skip" data-testid="geo-skip" onClick={skip}>
          Skip this one for now
        </button>
      )}
    </div>
  );
}
