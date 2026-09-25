import { useEffect, useRef } from 'react';
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
 */
export function FollowUpTray({ active = true, observations = [], onObservationsChanged, onChanged }) {
  const cleanup = useCleanup(active);
  const questions = cleanup.data?.questions?.length || 0;
  const readings = observations.length;
  const parts = [questions ? plural(questions, 'follow-up question', 'follow-up questions') : null,
    readings ? plural(readings, 'scale reading', 'scale readings') : null].filter(Boolean);

  const last = useRef({ questions: 0, readings: 0 });
  useEffect(() => {
    if (last.current.questions === questions && last.current.readings === readings) return;
    last.current = { questions, readings };
    logger.debug('counts', { questions, readings });
  }, [questions, readings]);

  if (!parts.length) {
    return <div className="health-followups health-followups--empty" aria-live="polite">No follow-ups</div>;
  }
  return <details className="health-followups" aria-live="polite"
    onToggle={event => logger.info(event.currentTarget.open ? 'open' : 'close', { questions, readings })}>
    <summary>{parts.join(' · ')}</summary>
    <div className="health-followups__body">
      <CleanupQuestions active={active} resource={cleanup} onChanged={onChanged} />
      <ObservationsSection observations={observations} onChanged={onObservationsChanged} />
    </div>
  </details>;
}

export default FollowUpTray;
