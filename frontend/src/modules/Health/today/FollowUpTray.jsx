import { useEffect, useRef, useState } from 'react';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { CleanupQuestions, useCleanup } from '../cleanup/CleanupQuestions.jsx';
import { ObservationsSection } from './ObservationRow.jsx';

const logger = createAppLogger('health').child('follow-ups');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Things waiting on the person that nobody just asked for: cleanup follow-up
 * questions (polled every 15 s) and kitchen-scale readings nothing has claimed.
 * Both arrive on their own schedule, so rendering them in the page flow moved
 * the whole day down mid-read. They live in ONE line that is always there — a
 * reserved slot, so a new item changes its words, never the layout — and open
 * in place only when tapped.
 *
 * One persistent <details> (never swapped for another element), so the live
 * region on its summary text survives and a new count is announced.
 */
export function FollowUpTray({ active = true, observations = [], onObservationsChanged, onChanged }) {
  const cleanup = useCleanup(active);
  // Held here, not in CleanupQuestions: a stale answer to the LAST question
  // empties the list, and the message must outlive it.
  const [feedback, setFeedback] = useState(null);
  const questions = cleanup.data?.questions?.length || 0;
  const readings = observations.length;
  const parts = [questions ? plural(questions, 'follow-up question', 'follow-up questions') : null,
    readings ? plural(readings, 'scale reading', 'scale readings') : null,
    feedback && !questions ? 'A follow-up needs a look' : null].filter(Boolean);
  const empty = parts.length === 0;

  // Emptied while open (the last question answered): close, so the NEXT item
  // arrives as a new count on the line rather than expanding the page.
  const tray = useRef(null);
  useEffect(() => { if (empty && tray.current) tray.current.open = false; }, [empty]);

  const last = useRef({ questions: 0, readings: 0 });
  useEffect(() => {
    if (last.current.questions === questions && last.current.readings === readings) return;
    last.current = { questions, readings };
    logger.debug('counts', { questions, readings });
  }, [questions, readings]);

  return <details ref={tray} className={`health-followups${empty ? ' health-followups--empty' : ''}`}
    onToggle={event => {
      const open = event.currentTarget.open;
      if (!open) setFeedback(null);
      if (!empty) logger.info(open ? 'open' : 'close', { questions, readings });
    }}>
    <summary aria-disabled={empty || undefined} tabIndex={empty ? -1 : undefined}
      onClick={event => { if (empty) event.preventDefault(); }}>
      <span aria-live="polite">{empty ? 'No follow-ups' : parts.join(' · ')}</span>
    </summary>
    {empty ? null : <div className="health-followups__body">
      <CleanupQuestions active={active} resource={cleanup} onChanged={onChanged} feedback={feedback} onFeedback={setFeedback} />
      <ObservationsSection observations={observations} onChanged={onObservationsChanged} />
    </div>}
  </details>;
}

export default FollowUpTray;
