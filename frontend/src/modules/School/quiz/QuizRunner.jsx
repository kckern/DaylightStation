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
import LearningReflectionPrompt from '../progress/LearningReflectionPrompt.jsx';

const ITEM_COMPONENTS = {
  multiple_choice: MultipleChoiceItem,
  short_answer: ShortAnswerItem,
  cloze: ClozeItem,
  matching: MatchingItem,
};

/**
 * A kid's own voice on a fail (student-advocacy A2): one tap files a retake
 * ask on the teacher's backlog — no gate, no dead end.
 */
function RetakeAsk({ userId, bankId, title }) {
  const [state, setState] = useState('idle'); // idle | asked | failed
  const ask = async () => {
    const { ok } = await schoolApi.requestRetake({ userId, bankId, title });
    setState(ok ? 'asked' : 'failed');
  };
  if (state === 'asked') return <p className="school-runner__retake" data-testid="retake-asked">Asked! A grown-up will set up another try.</p>;
  return (
    <>
      <button type="button" className="school-runner__retake-btn" data-testid="retake-ask" onClick={ask}>Ask for a retake</button>
      {state === 'failed' && <p className="school-runner__unrecorded-summary">That didn’t send — try again.</p>}
    </>
  );
}

/**
 * The kid's "this seems wrong" channel (advocacy wave 7): one tap files a
 * kind:'flag' row into the teacher backlog — mis-keyed answers and broken
 * screens get a voice without the child needing a grown-up standing there.
 */
function FlagAsk({ userId, bankId, sessionId, title }) {
  const [state, setState] = useState('idle'); // idle | sent | failed
  const flag = async () => {
    const { ok } = await schoolApi.flagConcern({ userId, bankId, sessionId, title });
    setState(ok ? 'sent' : 'failed');
  };
  if (state === 'sent') return <p className="school-runner__flag" data-testid="flag-sent">Told them — a grown-up will take a look.</p>;
  return (
    <>
      <button type="button" className="school-runner__flag-btn" data-testid="flag-ask" onClick={flag}>
        Something seem wrong? Tell a grown-up
      </button>
      {state === 'failed' && <p className="school-runner__unrecorded-summary">That didn’t send — try again.</p>}
    </>
  );
}

export default function QuizRunner({ bank, mode = 'quiz', learning = null, onExit }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [unrecordedCount, setUnrecordedCount] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
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
      schoolLog.session('end', { sessionId, bankId: bank.id, mode, reason: 'identity-changed' });
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
    schoolApi.openSession({
      userId, bankId: bank.id, mode, ...(learning ? { learning } : {}),
    }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) {
        // A refused open must never be a silent bounce (student-advocacy #8).
        setOpenFailed(true);
        return;
      }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode, userId, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, identityKey]);

  const item = bank.items[index];
  const unsaved = (currentUser?.id ?? null) === null;

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
    if (abandonedRef.current) return; // prevent advancing after identity change
    setVerdict(null);
    setUnrecorded(false);
    if (index + 1 >= bank.items.length) {
      setDone(true);
      schoolLog.session('end', { sessionId, bankId: bank.id, mode, score, total: bank.items.length });
    } else {
      setIndex((i) => i + 1);
    }
  };

  if (done) {
    const gradedCount = bank.items.length - unrecordedCount;
    const percent = gradedCount > 0 ? Math.round((score / gradedCount) * 100) : 0;
    const passingPercent = typeof learning?.passingPercent === 'number' ? learning.passingPercent : null;
    const passed = passingPercent !== null ? percent >= passingPercent : null;
    // A moment, always (student-advocacy #10): the end of honest work gets a
    // warm sentence tiered by result, never the same grey fraction.
    const cheer = percent === 100 ? 'Perfect! Every single one.'
      : percent >= 80 ? 'Nice work — that was a strong run.'
        : percent >= 50 ? 'Good effort. A few to look at again.'
          : 'Tough one. That’s how the hard stuff starts.';
    return (
      <div className="school-runner school-runner--summary" data-testid="quiz-summary" data-passed={passed === null ? undefined : String(passed)}>
        <h2>{bank.title}</h2>
        <p className="school-runner__cheer" data-testid="quiz-cheer">{cheer}</p>
        <p className="school-runner__score">{score} / {gradedCount}</p>
        {passingPercent !== null && (
          <p className="school-runner__passbar" data-testid="quiz-passbar">
            {passed
              ? `Passed — ${percent}%, and passing is ${passingPercent}%.`
              : `${percent}% — passing is ${passingPercent}%. You can try again.`}
          </p>
        )}
        {passed === false && currentUser?.id && (
          <RetakeAsk userId={currentUser.id} bankId={bank.id} title={bank.title} />
        )}
        {currentUser?.id && (
          <FlagAsk userId={currentUser.id} bankId={bank.id} sessionId={sessionId} title={bank.title} />
        )}
        {unrecordedCount > 0 && (
          <p className="school-runner__unrecorded-summary" data-testid="unrecorded-summary">
            {unrecordedCount} answer{unrecordedCount === 1 ? '' : 's'} not recorded — not counted as wrong
          </p>
        )}
        {learning ? (
          <LearningReflectionPrompt
            activity={{ id: bank.id, sessionId }}
            learning={learning}
            onDone={onExit}
            continueLabel="Done"
          />
        ) : <button type="button" className="school-runner__done" onClick={onExit}>Done</button>}
      </div>
    );
  }
  // openFailed leaves sessionId null forever, so it must be checked BEFORE
  // the loading gate — otherwise the child stares at "Loading…" for good.
  if (openFailed) {
    return (
      <div className="school-runner school-runner--error" data-testid="quiz-open-failed">
        <h2>{bank.title}</h2>
        <p className="school-runner__unrecorded-summary">That one wouldn’t open. Tell a grown-up, or try again in a minute.</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Back</button>
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
      {unsaved && (
        <div className="school-runner__guest" data-testid="guest-banner">
          Playing as guest — this won’t be saved.
        </div>
      )}
      <div className="school-runner__progress">{index + 1} / {bank.items.length}</div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">That answer didn’t save — it won’t count as wrong. Tell a grown-up if this keeps happening.</div>}
      <ItemComponent key={item.id} item={item} onSubmit={submit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
    </div>
  );
}
