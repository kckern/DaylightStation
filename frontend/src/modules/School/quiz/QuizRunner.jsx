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

/**
 * Mint the durable tutor offer as soon as the failed summary appears. The
 * browser sends only session identity; the server re-reads the immutable bank,
 * durable answers, exact Catalog lesson, and authored remediation policy.
 */
function TutorOffer({ userId, sessionId, onOpen }) {
  const [state, setState] = useState({ kind: 'loading', sessionId: null });
  useEffect(() => {
    let alive = true;
    schoolApi.remediationOffer(sessionId, userId).then(({ ok, data }) => {
      if (!alive) return;
      const offeredId = data?.offer?.sessionId ?? null;
      if (ok && offeredId) setState({ kind: 'ready', sessionId: offeredId });
      else if (ok && ['not_configured', 'not_triggered'].includes(data?.status)) {
        setState({ kind: 'unavailable', sessionId: null });
      } else setState({ kind: 'failed', sessionId: null });
    });
    return () => { alive = false; };
  }, [sessionId, userId]);

  if (state.kind === 'loading') return <p className="school-runner__tutor-status">Checking for tutor help…</p>;
  if (state.kind === 'ready') return (
    <button type="button" className="school-runner__tutor-btn" data-testid="open-tutor"
      onClick={() => onOpen(state.sessionId)}>
      Get tutor help
    </button>
  );
  if (state.kind === 'failed') return <p className="school-runner__tutor-status">Tutor help couldn&rsquo;t open right now.</p>;
  return null;
}

export default function QuizRunner({ bank, mode = 'quiz', learning = null, fresh = false, onExit, onRestart = null, onReview = null, onTutor = null }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  // Mid-quiz resume (Task 17): question number the run picked up at (1-based),
  // or null when the run started at the top. Drives the resume chip.
  const [resumedAt, setResumedAt] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [unrecorded, setUnrecorded] = useState(false);
  const [unrecordedCount, setUnrecordedCount] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const [score, setScore] = useState(0);
  // Per-question outcomes for the summary dots (design audit #5): true /
  // false / null (unrecorded), in question order.
  const [outcomes, setOutcomes] = useState([]);
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
      userId, bankId: bank.id, mode, ...(learning ? { learning } : {}), ...(fresh ? { fresh: true } : {}),
    }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) {
        // A refused open must never be a silent bounce (student-advocacy #8).
        setOpenFailed(true);
        return;
      }
      // Mid-quiz resume (Task 17): the server may answer with the answers a
      // dropped sitting already banked — pick up there, not at q1.
      const answered = data.resume?.answeredItemIds?.length ?? 0;
      if (answered > 0 && answered < bank.items.length) {
        setIndex(answered);
        setScore(data.resume.score);
        setOutcomes(data.resume.outcomes);
        setResumedAt(answered + 1);
      }
      setSessionId(data.sessionId);
      schoolLog.session('start', {
        sessionId: data.sessionId, bankId: bank.id, mode, userId, itemCount: bank.items.length,
        ...(answered > 0 ? { resumedAnswers: answered } : {}),
      });
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
    // A 410 means the session timed out server-side (spec §8) — never a
    // silent bounce (student-advocacy #8): the child gets a sign, and only
    // an explicit Back/Start-again tap actually exits.
    if (answerStatus === 410) { setSessionLost(true); return; }
    if (!ok) {
      // Grading state unknowable; the attempt is NOT on disk. Never silent (spec §8).
      // The true grade is UNKNOWN, not wrong — the verdict must not claim one.
      schoolLog.answerError('record-failed', { sessionId, itemId: item.id, status: answerStatus });
      setUnrecorded(true);
      setUnrecordedCount((c) => c + 1);
      setOutcomes((o) => [...o, null]);
      setVerdict({ unrecorded: true });
      return;
    }
    schoolLog.answer('graded', { sessionId, itemId: item.id, itemType: item.type, correct: data.correct });
    if (data.correct) setScore((s) => s + 1);
    setOutcomes((o) => [...o, data.correct]);
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
        <p className="school-runner__score school-runner__score--display">{score} / {gradedCount}</p>
        {/* One dot per question, in order — the recap at a glance (audit #5). */}
        <div className="school-runner__dots" data-testid="quiz-dots" aria-label="Question results">
          {outcomes.map((ok, i) => (
            // eslint-disable-next-line react/no-array-index-key -- question order is the identity
            <span key={i} className={`school-runner__dot ${ok === null ? 'is-unknown' : ok ? 'is-right' : 'is-missed'}`} />
          ))}
        </div>
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
        {passed === false && learning?.unitId && currentUser?.id && onTutor && (
          <TutorOffer userId={currentUser.id} sessionId={sessionId} onOpen={onTutor} />
        )}
        {/* Student-advocacy W7b: a fail is also a way back to the lesson, not
            just a retake ask. Gated on `learning?.unitId` — the context only a
            catalog-launched quiz module carries (see LearningCatalogBrowser) —
            and on `onReview` actually being wired, since a bank-practice run
            or the materials gate quiz (SchoolMaterialPlayer) has neither. */}
        {passed === false && learning?.unitId && onReview && (
          <button
            type="button"
            className="school-runner__review-lesson-btn"
            data-testid="review-lesson"
            onClick={() => onReview(learning)}
          >
            Review this lesson
          </button>
        )}
        {currentUser?.id && (
          <FlagAsk userId={currentUser.id} bankId={bank.id} sessionId={sessionId} title={bank.title} />
        )}
        {unrecordedCount > 0 && (
          <p className="school-runner__unrecorded-summary" data-testid="unrecorded-summary">
            {unrecordedCount} answer{unrecordedCount === 1 ? '' : 's'} not recorded — not counted as wrong
          </p>
        )}
        {learning?.moduleId ? (
          <LearningReflectionPrompt
            activity={{ id: bank.id, sessionId }}
            learning={learning}
            onDone={onExit}
            continueLabel="Done"
          />
        ) : (
          <div className="school-runner__summary-actions">
            {onRestart && (
              // A deliberate restart: fresh wipes the persisted sitting so the
              // new run starts at q1 instead of resuming this finished one.
              <button type="button" className="school-runner__again" onClick={() => onRestart({ fresh: true })}>Try again</button>
            )}
            <button type="button" className="school-runner__done" onClick={onExit}>Done</button>
          </div>
        )}
      </div>
    );
  }
  // A lost (410) session must show a sign, not a silent bounce — same
  // student-advocacy contract as openFailed below, checked ahead of the
  // loading gate for the same reason.
  if (sessionLost) {
    return (
      <div className="school-runner school-runner--error" data-testid="session-lost">
        <h2>{bank.title}</h2>
        <p className="school-runner__unrecorded-summary">Your quiz took a long break and timed out. Your finished answers are saved — start again to keep going.</p>
        <div className="school-runner__summary-actions">
          {onRestart && (
            // NOT fresh: this card promises "your finished answers are saved —
            // start again to keep going", and the sitting is what keeps that
            // promise — the reopened run resumes where the timeout cut it off.
            <button type="button" className="school-runner__again" onClick={() => onRestart({ fresh: false })}>Start again</button>
          )}
          <button type="button" className="school-runner__done" onClick={onExit}>Back</button>
        </div>
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
      <div className="school-runner__progress">
        <span>{index + 1} / {bank.items.length}</span>
        {/* One quiet line, not a modal (Task 17): the kid should know the
            earlier answers counted without the fact upstaging the question. */}
        {resumedAt !== null && (
          <span className="school-runner__resume-chip" data-testid="resume-chip">
            Picked up where you left off — question {resumedAt}
          </span>
        )}
        {/* A corner chip, not a headline (audit #5): the disclaimer must not
            outrank the question on every screen. */}
        {unsaved && <span className="school-runner__guest-chip" data-testid="guest-banner">guest — not saved</span>}
      </div>
      {unrecorded && <div className="school-runner__unrecorded" data-testid="unrecorded">That answer didn’t save — it won’t count as wrong. Tell a grown-up if this keeps happening.</div>}
      <ItemComponent key={item.id} item={item} onSubmit={submit} verdict={verdict} />
      {verdict && <button type="button" className="school-runner__next" onClick={next}>Next</button>}
    </div>
  );
}
