/**
 * One-pass quiz (spec §3): each item asked exactly once, POST per answer,
 * verdict shown, summary at the end. Deliberately NO resurfacing — a quiz is
 * an assessment; re-asking missed items would converge every score to 100%
 * and gut the R2.5 completion signal. Identity change mid-run abandons the
 * session (spec §6): the session is pinned server-side to whoever opened it.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import MultipleChoiceItem from './items/MultipleChoiceItem.jsx';
import ShortAnswerItem from './items/ShortAnswerItem.jsx';
import ClozeItem from './items/ClozeItem.jsx';
import MatchingItem from './items/MatchingItem.jsx';

const ITEM_COMPONENTS = {
  multiple_choice: MultipleChoiceItem,
  short_answer: ShortAnswerItem,
  cloze: ClozeItem,
  matching: MatchingItem,
};

export default function QuizRunner({ bank, onExit }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [unrecordedCount, setUnrecordedCount] = useState(0);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  // Identity is pinned the moment the session actually opens (not at first
  // render — the profile context may still be resolving the roster then).
  // null means "not pinned yet"; the abandon effect below is inert until then.
  const initialIdentity = useRef(null);
  const sessionOpenedRef = useRef(false);
  // Checked synchronously in submit() so recording stops the instant identity
  // changes, regardless of whether the parent unmounts us before or after
  // onExit() fires — a `useEffect` calling onExit() only REQUESTS teardown.
  const abandonedRef = useRef(false);

  useEffect(() => {
    if (initialIdentity.current === null) return; // session not open yet; nothing pinned
    if (identityKey !== initialIdentity.current) {
      abandonedRef.current = true;
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'quiz', reason: 'identity-changed' });
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
    schoolApi.openSession({ userId, bankId: bank.id, mode: 'quiz' }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode: 'quiz', userId, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, identityKey]);

  const item = bank.items[index];

  const submit = async (given) => {
    if (!sessionId || verdict || abandonedRef.current) return;
    const { ok, status: answerStatus, data } = await schoolApi.answer(sessionId, { itemId: item.id, given });
    if (abandonedRef.current) return; // identity changed while the request was in flight
    if (answerStatus === 410) { onExit(); return; }
    if (!ok) {
      // Grading state unknowable; the attempt is NOT on disk. Never silent (spec §8).
      // The true grade is UNKNOWN, not wrong — the verdict must not claim one.
      schoolLog.answerError('record-failed', { sessionId, itemId: item.id, status: answerStatus });
      setUnrecorded(true);
      setUnrecordedCount((c) => c + 1);
      setVerdict({ unrecorded: true });
      return;
    }
    schoolLog.answer('graded', { sessionId, itemId: item.id, itemType: item.type, correct: data.correct });
    if (data.correct) setScore((s) => s + 1);
    setVerdict(data);
  };

  const next = () => {
    setVerdict(null);
    setUnrecorded(false);
    if (index + 1 >= bank.items.length) {
      setDone(true);
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'quiz', score, total: bank.items.length });
    } else {
      setIndex((i) => i + 1);
    }
  };

  if (done) {
    const gradedCount = bank.items.length - unrecordedCount;
    return (
      <div className="school-runner school-runner--summary" data-testid="quiz-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">{score} / {gradedCount}</p>
        {unrecordedCount > 0 && (
          <p className="school-runner__unrecorded-summary" data-testid="unrecorded-summary">
            {unrecordedCount} answer{unrecordedCount === 1 ? '' : 's'} not recorded — not counted as wrong
          </p>
        )}
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
      </div>
    );
  }
  // A live item must never be in front of the child before the session
  // exists: submit() no-ops while sessionId is null, and each item component
  // latches its own submittedRef on the first tap, so a tap that lands during
  // this window would be swallowed with no retry. Show a loading state instead.
  if (!sessionId) {
    return (
      <div className="school-runner school-runner--quiz" data-testid="quiz-loading">
        <p className="school-runner__loading">Loading…</p>
      </div>
    );
  }
  if (!item) return null;
  const ItemComponent = ITEM_COMPONENTS[item.type];
  return (
    <div className="school-runner school-runner--quiz">
      <div className="school-runner__progress">{index + 1} / {bank.items.length}</div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">Answer not recorded — check the server.</div>}
      <ItemComponent key={item.id} item={item} onSubmit={submit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
    </div>
  );
}
