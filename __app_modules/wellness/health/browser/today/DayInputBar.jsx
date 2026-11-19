import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, TextInput } from '@mantine/core';
import { createAppLogger } from '../../../../../frontend/src/lib/ui/createAppLogger.js';
import { useFoodMutation } from '../operations/useFoodMutation.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { MoveDayControl } from './MoveDayControl.jsx';
import { MoveResult } from './mealDrag.jsx';
import { BUCKETS, UNGROUPED } from './mealBuckets.js';
import { dayLabel } from './moveDays.js';
import { entryId, entryLabel } from './entryCommands.js';

const logger = createAppLogger('health').child('day-input');
const DAY_INPUT_PATH = 'api/v1/health/nutrition/day-input';
const FALLBACK_ERROR = 'That did not go through. Try again.';
// A date field reports year 0002 while the person is still typing 2026.
const EARLIEST_ANSWER = '2000-01-01';

const newOperationId = () => crypto.randomUUID();
/** The server answered and said no, so sending the same thing again cannot help. */
const isRefusal = err => err?.status >= 400 && err.status < 500 && ![408, 425, 429].includes(err.status);
const errorText = err => {
  if (err?.body?.error) return err.body.error;
  const message = err?.message || '';
  return message && !/^(HTTP \d|Network error|Unreadable response)/.test(message) ? message : FALLBACK_ERROR;
};
/** What can be sent again after a failure, or null. A saved recording replaces the upload, which stays in memory. */
function retryAfter(err, request) {
  const audioRef = err?.body?.audioRef;
  if (err?.body?.code === 'DAY_INPUT_TOO_LONG') return null;
  if (audioRef && request.type === 'voice') {
    const { content, ...rest } = request;
    return { ...rest, audioRef, recording: content ?? request.recording };
  }
  return isRefusal(err) ? null : request;
}
// Key order is fixed: a retry must be recognised as the same request.
const requestBody = ({ type, content, audioRef, date, resolved, operationId }) => ({
  type, ...(audioRef ? { audioRef } : { content }), date, ...(resolved ? { resolved } : {}), operationId,
});
const mealName = row => BUCKETS.find(bucket => bucket.id === row.mealTime)?.label || UNGROUPED.label;

const MoveDayIcon = () => <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
  <rect x="2" y="3.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
  <path d="M2 7h14M5.5 11.25h6M9.5 9.25l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
</svg>;

/**
 * Every top-level food of the day, ticked. A dish carries the parts stranded in
 * other meals, so while it is ticked such a part reads "Moves with <dish>" and
 * cannot be unticked. Once the dish is unticked the part stays unless ticked
 * itself. What shows as moving is exactly what moves.
 */
function MoveDaySheet({ date, today, entries, onMove, onClose }) {
  const [unticked, setUnticked] = useState(() => new Set());
  const [strandedTicks, setStrandedTicks] = useState(() => new Set());
  const [note, setNote] = useState(null);
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(null); // { run, iso } while the last move's outcome is unknown
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalRoot, setModalRoot] = useState(null);
  const refusal = useRef(null);
  const findModalRoot = useCallback(node => { if (node) setModalRoot(node.closest('.mantine-Modal-root')); }, []);
  const dishes = new Map(entries.filter(row => row.kind === 'group').flatMap(row => [row.uuid, row.id].filter(Boolean).map(id => [String(id), row])));
  const dishOf = row => { const dish = row.parentId ? dishes.get(String(row.parentId)) : null; return dish !== row ? dish : null; };
  const isTicked = row => (dishOf(row) ? strandedTicks.has(entryId(row)) : !unticked.has(entryId(row)));
  const carriedBy = row => { const dish = dishOf(row); return dish && isTicked(dish) ? dish : null; };
  const picked = entries.filter(row => !carriedBy(row) && isTicked(row));
  const toggle = row => (dishOf(row) ? setStrandedTicks : setUnticked)(previous => {
    const next = new Set(previous), id = entryId(row);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Only a finished move closes the sheet. Anything else leaves the choices as they are.
  const attempt = async (iso, run) => {
    setNote(null); setWorking(true); refusal.current = null;
    const outcome = await run();
    setWorking(false);
    logger.info('day-input.move-day.result', { date, to: iso, count: picked.length, outcome });
    if (outcome === MoveResult.MOVED) onClose();
    else if (outcome === MoveResult.UNCHANGED) setNote(`Those foods are already on ${dayLabel(iso, today)}.`);
    else if (outcome === MoveResult.UNKNOWN) setNote('We could not confirm that move. Try again to finish it; nothing will move twice.');
    else setNote(refusal.current || 'Those foods were not moved. Your choices are still here.');
  };
  const move = iso => attempt(iso, () => onMove(picked, iso, {
    onRetryable: run => setRetry(run ? { run, iso } : null),
    onRefused: reason => { refusal.current = reason; },
  }));
  const locked = working || Boolean(retry);
  return <Modal opened onClose={onClose} title="Move this day's food" centered returnFocus={false} closeOnEscape={!menuOpen}>
    <div className="health-day-move" ref={findModalRoot}>
      <div className="health-day-move__list">
        {entries.map(row => {
          const id = entryId(row), carrier = carriedBy(row);
          return <label key={id} className="health-day-move__row">
            <input type="checkbox" aria-label={entryLabel(row)} aria-describedby={`health-day-move-${id}`} disabled={locked || Boolean(carrier)}
              checked={Boolean(carrier) || isTicked(row)} onChange={() => toggle(row)} />
            <span className="health-day-move__name" aria-hidden="true">{entryLabel(row)}</span>
            <span className="health-day-move__meal" id={`health-day-move-${id}`}>{carrier ? `Moves with ${entryLabel(carrier)}` : mealName(row)}</span>
          </label>;
        })}
      </div>
      {note ? <p role="status" className="health-day-move__note">{note}</p> : null}
      {retry ? <Button size="compact-sm" variant="light" loading={working} onClick={() => attempt(retry.iso, retry.run)}>Try again</Button>
        : picked.length ? <MoveDayControl date={date} today={today} count={picked.length} onMove={move} portalTarget={modalRoot} onMenuChange={setMenuOpen} /> : null}
    </div>
  </Modal>;
}

/**
 * One place to log a whole day or correct what is already on it. Each request
 * keeps the day it was made on, whatever the page shows by the time it answers.
 * The bar is one row of fixed height: questions and errors open over the page
 * below it, so nothing here moves the meals. A recording waits while anything is
 * unsettled, so it never replaces a question or a failure.
 */
export function DayInputBar({ date, today, entries, active = true, onResult, onMoveDay }) {
  const foodAPI = useFoodMutation(entries);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null); // 'text' | 'voice' | null
  const [failure, setFailure] = useState(null); // { message, date, retry }
  const [question, setQuestion] = useState(null); // the server's question + the request it is about
  const [waiting, setWaiting] = useState([]); // recordings not sent yet, oldest first
  const [micError, setMicError] = useState(null);
  const [moving, setMoving] = useState(false);
  const flight = useRef(null);
  // The typed request whose outcome is unknown. It outlives the visible error, so
  // sending the same words again resumes it even after Dismiss.
  const unknownOutcome = useRef(null);
  const root = useRef(null);
  const form = useRef(null);
  const field = useRef(null);
  const moveButton = useRef(null);
  const questionPanel = useRef(null);
  const sheetWasOpen = useRef(false);
  // A reply can land after the page moved on, so it goes to the current handler.
  const reportResult = useRef(onResult);
  reportResult.current = onResult;
  const waitingCount = useRef(0);
  waitingCount.current = waiting.length;

  useEffect(() => {
    logger.debug('day-input.mounted');
    return () => {
      logger.debug('day-input.unmounted');
      if (waitingCount.current) logger.warn('day-input.recording-dropped', { count: waitingCount.current });
    };
  }, []);
  useEffect(() => {
    if (sheetWasOpen.current && !moving) (moveButton.current || field.current)?.focus();
    sheetWasOpen.current = moving;
  }, [moving]);
  const focusIsOurs = container => {
    const focused = document.activeElement;
    return !focused || focused === document.body || Boolean(container.current?.contains(focused));
  };
  useEffect(() => {
    if (question && focusIsOurs(root)) questionPanel.current?.querySelector('button:not(:disabled), input:not(:disabled)')?.focus();
  }, [question]);

  const deliver = async request => {
    try {
      const result = await foodAPI(DAY_INPUT_PATH, requestBody(request), 'POST');
      if (unknownOutcome.current?.operationId === request.operationId) unknownOutcome.current = null;
      logger.info('day-input.result', { date: request.date, outcome: result?.outcome, kind: result?.kind });
      if (result?.clarification) {
        logger.info('day-input.clarification', { date: request.date, kind: result.clarification.kind });
        setQuestion({ ...result.clarification, choices: result.clarification.choices || [],
          request: { ...request, said: result.instructionText || request.said || null } });
        return;
      }
      // Words that did nothing stay, to be edited. Words changed since sending stay too.
      if (result?.outcome === 'committed' && request.typed) setText(current => (current.trim() === request.typed ? '' : current));
      reportResult.current?.(result, { date: request.date });
      if (request.typed && focusIsOurs(form)) field.current?.focus();
    } catch (err) {
      // Nothing is left to resume, and a saved recording changes the body under this ID.
      if (isRefusal(err) || err?.body?.audioRef) foodAPI.release(request.operationId);
      if (err?.body?.code === 'AUDIO_NOT_FOUND' && request.audioRef && request.recording) {
        logger.info('day-input.recording-fallback', { date: request.date });
        const { audioRef, recording, ...rest } = request;
        await deliver({ ...rest, content: recording });
        return;
      }
      const retry = retryAfter(err, request);
      const resumable = !isRefusal(err) && request.type === 'text' && !request.resolved;
      if (resumable) unknownOutcome.current = request;
      else if (unknownOutcome.current?.operationId === request.operationId) unknownOutcome.current = null;
      logger.warn('day-input.failed', { type: request.type, date: request.date, status: err?.status, code: err?.body?.code, retryable: Boolean(retry), error: err?.message });
      setFailure({ message: errorText(err), date: request.date, retry });
    }
  };
  const attempt = async request => {
    try { await deliver(request); }
    finally { flight.current = null; setBusy(null); }
  };
  const send = request => {
    setBusy(request.type); setFailure(null); setQuestion(null);
    logger.info('day-input.submit', { type: request.type, date: request.date, answer: Boolean(request.resolved), saved: Boolean(request.audioRef) });
    flight.current = attempt(request);
  };
  // The next recording goes once nothing is running and nothing awaits an answer.
  useEffect(() => {
    if (!waiting.length || busy || flight.current || question || failure) return;
    const [next, ...rest] = waiting;
    setWaiting(rest);
    send(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, busy, question, failure]);
  const submitText = () => {
    const words = text.trim();
    if (!words || flight.current) return;
    const prior = unknownOutcome.current;
    if (prior?.content === words && prior.date === date) { send(prior); return; }
    unknownOutcome.current = null;
    send({ type: 'text', content: words, said: words, typed: words, date, operationId: newOperationId() });
  };
  // The same words again with the answer, or the recording when no words came back.
  const answer = picked => {
    if (flight.current || !question) return;
    const { said, typed, type, content, audioRef, recording, date: askedOn, resolved } = question.request;
    const source = said ? { type: 'text', content: said } : { type, ...(audioRef ? { audioRef, recording } : { content }) };
    send({ ...source, said, typed, date: askedOn, resolved: { ...resolved, ...picked }, operationId: newOperationId() });
  };
  const answerDay = value => {
    if (value && value >= EARLIEST_ANSWER && value <= today) answer({ toDate: value });
  };
  const backToField = clear => { clear(null); field.current?.focus(); };
  const elsewhere = day => (day === date ? '' : `${dayLabel(day, today)}: `);
  const working = busy === 'voice' ? 'Working on your recording…' : 'Working on it…';
  const waitingText = !waiting.length ? ''
    : `${waiting.length === 1 ? 'Your recording is waiting' : `${waiting.length} recordings are waiting`} and will send once this is settled.`;
  const statusText = [busy ? working : question?.question, waitingText].filter(Boolean).join(' ');

  return <div ref={root} className="health-day-input">
    <form ref={form} className="health-day-input__row" onSubmit={event => { event.preventDefault(); submitText(); }}>
      <TextInput ref={field} className="health-day-input__field" aria-label="Log food or change this day" autoComplete="off" enterKeyHint="send"
        placeholder={busy ? working : 'Log a whole day, or say what to change…'}
        value={text} onChange={event => setText(event.currentTarget.value)} readOnly={Boolean(busy)} />
      <VoiceCapture active={active} busy={Boolean(busy)} labelPrefix="Speak foods or changes" className="health-day-input__mic" onError={setMicError}
        onCapture={content => setWaiting(previous => [...previous, { type: 'voice', content, date, operationId: newOperationId() }])} />
      <Button type="submit" size="compact-sm" className="health-day-input__send" loading={Boolean(busy)} disabled={!text.trim()}>Send</Button>
      {entries.length ? <Button ref={moveButton} size="compact-sm" variant="subtle" className="health-day-input__move" aria-label="Move this day's food" title="Move this day's food"
        leftSection={<MoveDayIcon />} onClick={() => { logger.info('day-input.move-day.open', { date, count: entries.length }); setMoving(true); }}>
        <span className="health-day-input__move-text">Move this day's food</span>
      </Button> : null}
      <span role="status" className="health-day-input__status">{statusText}</span>
    </form>
    {question || failure || micError || waiting.length ? <div className="health-day-input__overlay">
      {question ? <div ref={questionPanel} className="health-day-input__panel">
        <span>{elsewhere(question.request.date)}{question.question}</span>
        <div className="health-day-input__actions">
          {question.choices.map(choice => <Button key={choice.id} size="compact-sm" variant="light" disabled={Boolean(busy)}
            onClick={() => answer(question.kind === 'day' ? { toDate: choice.id } : { foodId: choice.id })}>{choice.label}</Button>)}
          {question.kind === 'day' ? <input type="date" aria-label={question.question} max={today} disabled={Boolean(busy)}
            onChange={event => answerDay(event.target.value)} /> : null}
          <Button size="compact-sm" variant="subtle" onClick={() => backToField(setQuestion)}>Cancel</Button>
        </div>
      </div> : null}
      {failure ? <div className="health-day-input__panel">
        <span role="alert" className="health-capture-error">{elsewhere(failure.date)}{failure.message}</span>
        <div className="health-day-input__actions">
          {failure.retry ? <Button size="compact-sm" variant="light" disabled={Boolean(busy)} onClick={() => { if (!flight.current) send(failure.retry); }}>Try again</Button> : null}
          <Button size="compact-sm" variant="subtle" onClick={() => backToField(setFailure)}>Dismiss</Button>
        </div>
      </div> : null}
      {waitingText ? <p className="health-day-input__waiting">{waitingText}</p> : null}
      {micError ? <div className="health-day-input__panel">
        <span role="alert" className="health-capture-error">{micError}</span>
        <div className="health-day-input__actions"><Button size="compact-sm" variant="subtle" onClick={() => backToField(setMicError)}>Dismiss</Button></div>
      </div> : null}
    </div> : null}
    {moving ? <MoveDaySheet date={date} today={today} entries={entries} onMove={onMoveDay} onClose={() => setMoving(false)} /> : null}
  </div>;
}
export default DayInputBar;
