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
  const { currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  // Identity pinned at mount; any change (lapse, switch, guest flip) abandons.
  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  const initialIdentity = useRef(identityKey);
  useEffect(() => {
    if (identityKey !== initialIdentity.current) {
      schoolLog.session('end', { sessionId, bankId: bank.id, mode: 'quiz', reason: 'identity-changed' });
      onExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    let alive = true;
    schoolApi.openSession({ userId: currentUser?.id ?? null, bankId: bank.id, mode: 'quiz' }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode: 'quiz', userId: currentUser?.id ?? null, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = bank.items[index];

  const submit = async (given) => {
    if (!sessionId || verdict) return;
    const { ok, status, data } = await schoolApi.answer(sessionId, { itemId: item.id, given });
    if (status === 410) { onExit(); return; }
    if (!ok) {
      // Grading state unknowable; the attempt is NOT on disk. Never silent (spec §8).
      schoolLog.answerError('record-failed', { sessionId, itemId: item.id, status });
      setUnrecorded(true);
      setVerdict({ correct: false, expected: null, unrecorded: true });
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
    return (
      <div className="school-runner school-runner--summary" data-testid="quiz-summary">
        <h2>{bank.title}</h2>
        <p className="school-runner__score">{score} / {bank.items.length}</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
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
