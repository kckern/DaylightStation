import { useEffect, useMemo, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import MultipleChoiceItem from '../quiz/items/MultipleChoiceItem.jsx';
import ShortAnswerItem from '../quiz/items/ShortAnswerItem.jsx';
import ClozeItem from '../quiz/items/ClozeItem.jsx';
import MatchingItem from '../quiz/items/MatchingItem.jsx';
import LearningReflectionPrompt from '../progress/LearningReflectionPrompt.jsx';

const ITEM_COMPONENTS = {
  multiple_choice: MultipleChoiceItem,
  short_answer: ShortAnswerItem,
  cloze: ClozeItem,
  matching: MatchingItem,
};

/**
 * Subject-neutral embedded formative check.
 *
 * The first response is the score-bearing check. Explanations and bounded
 * retries can improve understanding, but never rewrite that initial score.
 * Feedback acknowledgement and continuation are separate evidence calls.
 */
export default function LearningProbeRunner({ module, learning = {}, onExit }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const bank = module?.bank;
  const [sessionId, setSessionId] = useState(null);
  const [index, setIndex] = useState(0);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [renderNonce, setRenderNonce] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [initialCorrect, setInitialCorrect] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [improvedCount, setImprovedCount] = useState(0);
  const [recordError, setRecordError] = useState(null);
  const [savingInteraction, setSavingInteraction] = useState(false);
  const [done, setDone] = useState(false);
  const opened = useRef(false);
  const identity = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  const pinnedIdentity = useRef(null);
  const abandoned = useRef(false);

  const learningContext = useMemo(() => ({
    ...learning,
    ...(module?.moduleId ? { moduleId: module.moduleId } : {}),
    conceptIds: [...new Set([...(learning.conceptIds ?? []), ...(module?.conceptIds ?? [])])],
  }), [learning, module?.conceptIds, module?.moduleId]);

  useEffect(() => {
    if (pinnedIdentity.current === null || identity === pinnedIdentity.current) return;
    abandoned.current = true;
    onExit();
  }, [identity, onExit]);

  useEffect(() => {
    if (status !== 'ready' || opened.current || !bank) return;
    opened.current = true;
    pinnedIdentity.current = identity;
    let alive = true;
    schoolApi.openSession({
      userId: currentUser?.id ?? null,
      bankId: bank.id,
      mode: 'learning_probe',
      learning: learningContext,
    }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', {
        sessionId: data.sessionId, bankId: bank.id, mode: 'learning_probe',
        userId: currentUser?.id ?? null, itemCount: bank.items.length,
      });
    });
    return () => { alive = false; };
  }, [bank, currentUser?.id, identity, learningContext, onExit, status]);

  const item = bank?.items?.[index];
  const ItemComponent = ITEM_COMPONENTS[item?.type];
  const canRetry = Boolean(verdict && !verdict.unrecorded && !verdict.correct
    && module.feedback?.onIncorrect === 'explain_then_retry'
    && attemptNumber < module.feedback.maxAttemptsPerItem);
  // Out of tries is a normal end, not a silent one: name it kindly instead
  // of just downgrading the button copy (advocacy papercut).
  const outOfTries = Boolean(verdict && !verdict.unrecorded && !verdict.correct
    && module.feedback?.onIncorrect === 'explain_then_retry'
    && attemptNumber >= module.feedback.maxAttemptsPerItem);

  const submit = async (given) => {
    if (!sessionId || verdict || abandoned.current || !item) return;
    setRecordError(null);
    const responseId = `${sessionId}:${index}:${attemptNumber}`;
    const response = await schoolApi.answer(sessionId, {
      itemId: item.id, given, probeAttemptNumber: attemptNumber, responseId,
    });
    if (abandoned.current) return;
    if (response.status === 410) { onExit(); return; }
    if (!response.ok) {
      setVerdict({ unrecorded: true });
      setRecordError('That answer didn’t save. Tap “Retry same answer” to send it again.');
      return;
    }
    if (attemptNumber === 1 && response.data.correct) setInitialCorrect((value) => value + 1);
    if (attemptNumber > 1) {
      setRetryCount((value) => value + 1);
      if (response.data.correct) setImprovedCount((value) => value + 1);
    }
    setVerdict(response.data);
  };

  const retryUnrecorded = () => {
    setVerdict(null);
    setRecordError(null);
    setRenderNonce((value) => value + 1);
  };

  const continueAfterFeedback = async (continuation) => {
    if (!verdict || verdict.unrecorded || savingInteraction || abandoned.current) return;
    setSavingInteraction(true);
    setRecordError(null);
    const recorded = await recordInteractions({
      sessionId, index, attemptNumber, continuation,
      learnerId: currentUser?.id ?? null,
      item, module, learning: learningContext,
    });
    setSavingInteraction(false);
    if (!recorded) {
      setRecordError('That didn’t go through. Tap again to keep going.');
      return;
    }
    if (continuation === 'retry') {
      setAttemptNumber((value) => value + 1);
      setVerdict(null);
      setRenderNonce((value) => value + 1);
      return;
    }
    if (index + 1 >= bank.items.length) {
      setDone(true);
      return;
    }
    setIndex((value) => value + 1);
    setAttemptNumber(1);
    setVerdict(null);
    setRenderNonce((value) => value + 1);
  };

  if (done) {
    return (
      <section className="school-runner school-probe school-runner--summary" data-testid="probe-summary">
        <p className="school-probe__eyebrow">Learning check complete</p>
        <h2>{module.title ?? bank.title}</h2>
        <p className="school-runner__score">Initial check: {initialCorrect} / {bank.items.length}</p>
        <p className="school-probe__improvement">
          {retryCount > 0
            ? `${improvedCount} of ${retryCount} retry responses were correct after feedback.`
            : 'No retry was needed.'}
        </p>
        <LearningReflectionPrompt
          activity={{ id: module.bankId, sessionId }}
          learning={learningContext}
          onDone={onExit}
        />
      </section>
    );
  }
  if (!sessionId) return <div className="school-runner"><p className="school-runner__loading">Loading check…</p></div>;
  if (!item || !ItemComponent) {
    return (
      <div className="school-runner school-probe">
        <p>This one won&rsquo;t work on this screen. Tell a grown-up what happened.</p>
        <button type="button" className="school-runner__done" onClick={onExit}>Return</button>
      </div>
    );
  }

  const displayItem = { ...item, id: `${item.id}:${attemptNumber}:${renderNonce}` };
  return (
    <section className="school-runner school-probe" aria-label="Learning check">
      <header className="school-probe__header">
        <div>
          <span>{module.phase ?? 'check'}</span>
          <strong>{module.title ?? bank.title}</strong>
        </div>
        <span>{index + 1}/{bank.items.length} · attempt {attemptNumber}</span>
      </header>
      {recordError && <p className="school-runner__unrecorded" role="alert">{recordError}</p>}
      <ItemComponent
        key={displayItem.id}
        item={displayItem}
        onSubmit={submit}
        verdict={verdict?.unrecorded ? null : verdict}
      />
      {verdict?.unrecorded && (
        <button type="button" className="school-runner__next" onClick={retryUnrecorded}>Retry same answer</button>
      )}
      {verdict && !verdict.unrecorded && (
        <div className={`school-probe__feedback${verdict.correct ? ' is-correct' : ' is-corrective'}`}>
          <strong>{feedbackLead(item, verdict.correct)}</strong>
          <p>{item.feedback?.explanation}</p>
          {outOfTries && (
            <p className="school-probe__out-of-tries" data-testid="probe-out-of-tries">
              That&rsquo;s all the tries for this one — the answer above is the one to remember.
            </p>
          )}
          <div className="school-probe__actions">
            {canRetry && (
              <button type="button" disabled={savingInteraction} onClick={() => continueAfterFeedback('retry')}>
                Try again
              </button>
            )}
            <button type="button" disabled={savingInteraction} onClick={() => continueAfterFeedback('continue')}>
              {canRetry ? 'Continue without retry' : 'Continue'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

async function recordInteractions({
  sessionId, index, attemptNumber, continuation, learnerId, item, module, learning,
}) {
  if (!learnerId) return true;
  const common = {
    learnerId, attemptNumber,
    activity: { id: module.bankId, sessionId, itemId: item.id },
    learning,
  };
  const feedback = await schoolApi.recordProbeInteraction({
    ...common,
    observationId: `${sessionId}:${index}:${attemptNumber}:feedback`,
    event: 'feedback_viewed',
  });
  if (!feedback.ok) return false;
  const next = await schoolApi.recordProbeInteraction({
    ...common,
    observationId: `${sessionId}:${index}:${attemptNumber}:continuation`,
    event: 'continuation', continuation,
  });
  return next.ok;
}

function feedbackLead(item, correct) {
  if (correct) return item.feedback?.correct ?? 'Correct.';
  return item.feedback?.incorrect ?? 'Not yet.';
}
