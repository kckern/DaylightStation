/**
 * Flashcard drill (spec §3, R4.3): prompt -> reveal -> self-grade. A missed
 * card requeues at the end of the deck until got — resurfacing belongs to
 * drilling, not assessment (contrast QuizRunner). Self-grades are recorded
 * verbatim server-side (mode contract, spec §5): selfGrade only, never given.
 *
 * Corrections carried over from QuizRunner's review (same latent shapes
 * would otherwise recur here):
 *  - A live card is never shown before the session exists (loading state
 *    until sessionId is set) — grade() is a no-op while sessionId is null,
 *    and an early tap would otherwise be silently swallowed with no retry.
 *  - Identity abandonment is enforced with a synchronous ref (abandonedRef),
 *    not just an onExit() request, so an in-flight or subsequent grade can't
 *    land against a session that no longer belongs to the current child.
 *  - The session opens exactly once, gated on the profile context being
 *    'ready', with identity pinned at that moment (not at first render) and
 *    guarded by sessionOpenedRef so no path can open a second session.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';

const answerText = (item) => (item.type === 'matching'
  ? item.pairs.map((p) => `${p.left} → ${p.right}`).join('\n')
  : item.answer);

export default function FlashcardRunner({ bank, onExit }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [queue, setQueue] = useState(bank.items);
  const [revealed, setRevealed] = useState(false);
  const [firstTry, setFirstTry] = useState(0);
  const [cardsSeen, setCardsSeen] = useState(0);
  const [unrecordedCount, setUnrecordedCount] = useState(0);
  const [unrecorded, setUnrecorded] = useState(false);
  const [grading, setGrading] = useState(false);
  const missedOnce = useRef(new Set());
  // Synchronous in-flight guard: a double-tap on Missed/Got-it before the
  // first POST resolves must not re-enter grade() with the same `card`
  // closure — that duplicates the POST and, worse, runs setQueue(slice(1))
  // twice against the same functional-update chain, silently dropping the
  // NEXT card without it ever being shown or graded. A ref (not state)
  // because it must block the second call within the same synchronous
  // click burst, before React would ever re-render with updated state
  // (same pattern as MultipleChoiceItem's submittedRef).
  const gradingRef = useRef(false);

  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  // null means "not pinned yet" — the abandon effect below is inert until the
  // session actually opens (see the openSession effect, which pins this).
  const initialIdentity = useRef(null);
  const sessionOpenedRef = useRef(false);
  // Checked synchronously in grade() so recording/advancing stops the instant
  // identity changes, regardless of whether the parent unmounts us before or
  // after onExit() fires — a useEffect calling onExit() only REQUESTS teardown.
  const abandonedRef = useRef(false);

  useEffect(() => {
    if (initialIdentity.current === null) return; // session not open yet; nothing pinned
    if (identityKey !== initialIdentity.current) {
      abandonedRef.current = true;
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'flashcard', reason: 'identity-changed' });
      onExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    if (status !== 'ready' || sessionOpenedRef.current) return;
    sessionOpenedRef.current = true;
    initialIdentity.current = identityKey;
    let alive = true;
    const userId = currentUser?.id ?? null;
    schoolApi.openSession({ userId, bankId: bank.id, mode: 'flashcard' }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode: 'flashcard', userId, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, identityKey]);

  const card = queue[0];

  const grade = async (got) => {
    if (!sessionId || !card || abandonedRef.current || gradingRef.current) return;
    gradingRef.current = true;
    setGrading(true);
    try {
      const wasMissedBefore = missedOnce.current.has(card.id);
      const selfGrade = got ? 'correct' : 'incorrect';
      const { ok, status: answerStatus } = await schoolApi.answer(sessionId, { itemId: card.id, selfGrade });
      if (abandonedRef.current) return; // identity changed while the request was in flight
      if (answerStatus === 410) { onExit(); return; }
      if (!ok) {
        // Unlike a quiz's server-computed correctness, the self-grade is
        // already known to the child the instant they tap Got it/Missed —
        // only the *recording* of it failed. There is nothing to wait on, so
        // never strand the child on the card (spec §8): proceed with the
        // local deck logic. Surface it immediately (per-card, consistent
        // with QuizRunner's inline banner) as well as on the end-of-session
        // summary — a whole session with the backend down must not drill
        // silently with no signal until the very end.
        schoolLog.answerError('record-failed', { sessionId, itemId: card.id, status: answerStatus });
        setUnrecorded(true);
        setUnrecordedCount((c) => c + 1);
      } else {
        setUnrecorded(false);
        schoolLog.answer('graded', { sessionId, itemId: card.id, itemType: card.type, selfGrade });
      }
      setCardsSeen((n) => n + 1);
      setRevealed(false);
      if (got) {
        if (!wasMissedBefore) setFirstTry((n) => n + 1);
        setQueue((q) => q.slice(1));
      } else {
        missedOnce.current.add(card.id); // resurface at the end until got (R4.3)
        setQueue((q) => [...q.slice(1), card]);
      }
    } finally {
      // Cleared unconditionally (including the abandoned/410 early-return
      // paths above) so a stray guard state can never strand the child —
      // those paths already stop drilling via onExit()/abandonedRef.
      gradingRef.current = false;
      setGrading(false);
    }
  };

  if (queue.length === 0) {
    return (
      <div className="school-runner school-runner--summary" data-testid="cards-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">{firstTry} / {bank.items.length}</p>
        <p className="school-runner__hint">first try</p>
        <p className="school-runner__cards-seen">{cardsSeen} cards seen</p>
        {unrecordedCount > 0 && (
          <p className="school-runner__unrecorded-summary" data-testid="unrecorded-summary">
            {unrecordedCount} grade{unrecordedCount === 1 ? '' : 's'} not recorded
          </p>
        )}
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
      </div>
    );
  }

  // A live card must never be in front of the child before the session
  // exists: grade() no-ops while sessionId is null, so a tap that lands
  // during this window would be swallowed with no retry. Loading state instead.
  if (!sessionId) {
    return (
      <div className="school-runner school-runner--cards" data-testid="cards-loading">
        <p className="school-runner__loading">Loading…</p>
      </div>
    );
  }

  return (
    <div className="school-runner school-runner--cards">
      <div className="school-runner__progress">{cardsSeen} seen · {queue.length} left</div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">Answer not recorded — check the server.</div>}
      <div className="school-card">
        <p className="school-card__prompt">{card.prompt}</p>
        {revealed && <p className="school-card__answer" style={{ whiteSpace: 'pre-line' }}>{answerText(card)}</p>}
      </div>
      {!revealed
        ? <button type="button" className="school-runner__next" onClick={() => setRevealed(true)}>Show answer</button>
        : (
          <div className="school-runner__grades">
            <button type="button" className="school-runner__missed" disabled={grading} onClick={() => grade(false)}>Missed</button>
            <button type="button" className="school-runner__got" disabled={grading} onClick={() => grade(true)}>Got it</button>
          </div>
        )}
    </div>
  );
}
