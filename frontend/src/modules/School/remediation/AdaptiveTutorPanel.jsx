import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';

const HEARTBEAT_MS = 15_000;
const RETRY_MS = 3_000;
const TERMINAL = new Set(['mastered', 'improved', 'exhausted', 'cancelled']);
const TURN_CONTROLS = new Set(['skip', 'explain', 'challenge']);

/**
 * Generic School remediation surface. It speaks the same learner/session/
 * sequence contract as SchoolCalc; no subject or calculator knowledge lives
 * here. A retry always replays the exact retained payload.
 */
export default function AdaptiveTutorPanel({ sessionId, learnerId, onExit }) {
  const [session, setSession] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [pending, setPending] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const sessionRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!sessionId || !learnerId || inFlight.current || pendingRef.current) return;
    if (!quiet) setConnection('connecting');
    const response = await schoolApi.remediationSession(sessionId, learnerId);
    if (!mounted.current) return;
    if (response.ok && response.data?.session) {
      setSession(response.data.session);
      setConnection('connected');
      setError(null);
      return;
    }
    setConnection('disconnected');
    if (!quiet || !sessionRef.current) {
      setError('The tutor could not reconnect. Your server-side place is unchanged.');
    }
  }, [learnerId, sessionId]);

  useEffect(() => {
    refresh();
    const heartbeat = window.setInterval(() => refresh({ quiet: true }), HEARTBEAT_MS);
    return () => window.clearInterval(heartbeat);
  }, [refresh]);

  const send = useCallback(async (payload) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(payload);
    setConnection('sending');
    setError(null);
    try {
      const response = await schoolApi.remediationAction(sessionId, payload);
      if (!mounted.current) return;
      const outcome = response.data;
      if (response.ok && outcome?.session) {
        setSession(outcome.session);
        if (response.status === 202 || outcome.status === 'processing') {
          setConnection('retrying');
          setError('The request is saved. Reconnecting with the same request…');
          return;
        }
        setPending(null);
        setConnection('connected');
        setFeedback(feedbackFor(outcome));
        return;
      }
      if (response.status === 0 || response.status === 502
          || response.status === 503 || response.status === 504) {
        setConnection('disconnected');
        setError('Connection lost. The exact request is retained and will retry safely.');
        return;
      }
      setPending(null);
      setConnection('disconnected');
      setError(response.status === 409
        ? 'Tutor state changed elsewhere. Reconnect to resume the current turn.'
        : 'The tutor could not accept that action. Reconnect and try the current turn again.');
    } finally {
      inFlight.current = false;
    }
  }, [sessionId]);

  // A lost response is safe to retry because clientSequence + canonical action
  // bytes form the application idempotency key. Never synthesize a new action.
  useEffect(() => {
    if (!pending || !['retrying', 'disconnected'].includes(connection)) return undefined;
    const retry = window.setTimeout(() => send(pending), RETRY_MS);
    return () => window.clearTimeout(retry);
  }, [connection, pending, send]);

  const currentTurn = useMemo(() => (
    session?.turns?.find(({ turnId }) => turnId === session.currentTurnId) ?? null
  ), [session]);
  const busy = Boolean(pending) || connection === 'sending';

  const act = useCallback((action, choiceId = null) => {
    if (!session || busy) return;
    const needsTurn = action === 'choice' || TURN_CONTROLS.has(action);
    if (needsTurn && !currentTurn) return;
    const payload = {
      learnerId,
      clientSequence: session.cursor.nextClientSequence,
      lastServerSequence: needsTurn
        ? currentTurn.serverSequence
        : session.cursor.latestServerSequence,
      action,
      ...(needsTurn ? { turnId: currentTurn.turnId } : {}),
      ...(action === 'choice' ? { choiceId } : {}),
    };
    setFeedback(null);
    send(payload);
  }, [busy, currentTurn, learnerId, send, session]);

  useEffect(() => {
    const onKey = (event) => {
      if (!currentTurn || busy || event.altKey || event.ctrlKey || event.metaKey) return;
      const match = event.key.match(/^F([1-5])$/i) ?? event.key.match(/^([a-e])$/i);
      if (!match) return;
      const index = /^F/i.test(event.key)
        ? Number.parseInt(match[1], 10) - 1
        : match[1].toUpperCase().charCodeAt(0) - 65;
      const choice = currentTurn.choices[index];
      if (!choice) return;
      event.preventDefault();
      act('choice', choice.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, busy, currentTurn]);

  const controls = new Set(session?.learnerControls ?? []);
  const terminal = TERMINAL.has(session?.status);

  return (
    <section className="school-tutor" aria-label="Adaptive tutor">
      <header className="school-tutor__header">
        <div>
          <span className="school-tutor__eyebrow">Guided follow-up</span>
          <h2>Adaptive tutor</h2>
        </div>
        <button type="button" className="school-tutor__back" onClick={onExit}>Back to progress</button>
      </header>

      <div className={`school-tutor__connection is-${connection}`} role="status" aria-live="polite">
        <span aria-hidden />
        {connectionCopy(connection)}
      </div>

      {session && (
        <div className="school-tutor__mastery">
          <span>Mastery</span>
          <strong>{session.masteryPercent}%</strong>
          <progress max="100" value={session.masteryPercent} aria-label="Tutor mastery" />
          <small>Goal {session.targetPercent}%</small>
        </div>
      )}

      {error && <p className="school-tutor__notice">{error}</p>}

      {!session && (
        <div className="school-tutor__empty">
          <p>{connection === 'connecting' ? 'Loading your saved place…' : 'Your saved tutor session is still on the server.'}</p>
          {connection !== 'connecting' && <button type="button" onClick={() => refresh()}>Reconnect</button>}
        </div>
      )}

      {session?.status === 'offered' && (
        <article className="school-tutor__turn">
          <h3>Work through the concepts that need another look?</h3>
          <p>This is optional. Your quiz score stays unchanged, and you can pause at any time.</p>
          <button type="button" className="school-tutor__primary" disabled={busy} onClick={() => act('start')}>
            Start tutoring
          </button>
        </article>
      )}

      {feedback && (
        <aside className={`school-tutor__feedback is-${feedback.tone}`} aria-live="polite">
          <strong>{feedback.title}</strong>
          {feedback.detail && <p>{feedback.detail}</p>}
        </aside>
      )}

      {session?.status === 'active' && currentTurn && (
        <article className="school-tutor__turn">
          <p className="school-tutor__explanation">{currentTurn.body}</p>
          <h3>{currentTurn.prompt}</h3>
          <div className="school-tutor__choices" aria-label="Tutor choices">
            {currentTurn.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                disabled={busy}
                onClick={() => act('choice', choice.id)}
              >
                <span>{choice.id}. {choice.label}</span>
              </button>
            ))}
          </div>
          <div className="school-tutor__controls" aria-label="Tutor controls">
            {controls.has('explain') && <button type="button" disabled={busy} onClick={() => act('explain')}>Explain another way</button>}
            {controls.has('skip') && <button type="button" disabled={busy} onClick={() => act('skip')}>Skip this check</button>}
            {controls.has('challenge') && <button type="button" disabled={busy} onClick={() => act('challenge')}>I know this</button>}
            {controls.has('stop') && <button type="button" className="is-stop" disabled={busy} onClick={() => act('cancel')}>Stop tutoring</button>}
          </div>
        </article>
      )}

      {session?.status === 'active' && !currentTurn && !pending && (
        <div className="school-tutor__empty"><p>Waiting for the next saved turn.</p><button type="button" onClick={() => refresh()}>Reconnect</button></div>
      )}

      {pending && (
        <div className="school-tutor__pending">
          <span>The current action is retained until the server acknowledges it.</span>
          <button type="button" disabled={connection === 'sending'} onClick={() => send(pending)}>Retry now</button>
        </div>
      )}

      {terminal && <TerminalSummary session={session} />}
      <p className="school-tutor__pause-note">Leaving this screen pauses; it does not discard your place.</p>
    </section>
  );
}

function TerminalSummary({ session }) {
  const summary = session.terminalSummary;
  const title = {
    mastered: 'Mastery reached', improved: 'Progress improved',
    exhausted: 'Tutor session complete', cancelled: 'Tutor paused by you',
  }[session.status] ?? 'Tutor session complete';
  return (
    <article className="school-tutor__terminal">
      <h3>{title}</h3>
      {summary && (
        <>
          <p>{summary.initialScorePercent}% assessment → {summary.finalMasteryPercent}% current mastery</p>
          {summary.remainingConceptIds.length > 0 && <p>Review next: {summary.remainingConceptIds.join(', ')}</p>}
        </>
      )}
    </article>
  );
}

function feedbackFor(outcome) {
  if (outcome.answer) return {
    tone: outcome.answer.correct ? 'correct' : 'review',
    title: outcome.answer.correct ? 'Correct' : 'Not yet',
    detail: outcome.answer.rationale ?? null,
  };
  if (outcome.control?.control === 'explain') return { tone: 'neutral', title: 'Trying another explanation', detail: null };
  if (outcome.control?.control === 'skip') return { tone: 'neutral', title: 'Skipped without changing your score', detail: null };
  if (outcome.control?.control === 'challenge') return { tone: 'neutral', title: 'Here is a fresh challenge', detail: null };
  return null;
}

function connectionCopy(connection) {
  return {
    connecting: 'Checking connection…', connected: 'Connected · session current',
    sending: 'Sending saved action…', retrying: 'Server is working · safe retry enabled',
    disconnected: 'Disconnected · saved server state preserved',
  }[connection] ?? 'Connection unknown';
}
