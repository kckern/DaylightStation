import { useEffect, useRef, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { useCleanup } from '../cleanup/CleanupQuestions.jsx';
import { QuestionDeck } from '../cleanup/QuestionDeck.jsx';
import { ObservationsSection } from './ObservationRow.jsx';

const logger = createAppLogger('health').child('follow-ups');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Things waiting on the person that nobody just asked for: cleanup follow-up
 * questions (polled every 15 s) and kitchen-scale readings nothing has claimed.
 * They arrive on their own schedule, so the page gives them ONE line that is
 * always there — a reserved slot: a new item changes its words, never the
 * layout. Tapping it opens a sheet with the questions as a card deck (one at a
 * time, swipe or tap through) and any unclaimed scale readings.
 */
export function FollowUpTray({ active = true, observations = [], onObservationsChanged, onChanged }) {
  const cleanup = useCleanup(active);
  const [open, setOpen] = useState(false);
  // Held here: a stale answer to the LAST question empties the list, and the
  // message must outlive it.
  const [feedback, setFeedback] = useState(null);
  const questions = cleanup.data?.questions || [];
  const readings = observations.length;
  const parts = [questions.length ? plural(questions.length, 'follow-up question', 'follow-up questions') : null,
    readings ? plural(readings, 'scale reading', 'scale readings') : null,
    feedback && !questions.length ? 'A follow-up needs a look' : null].filter(Boolean);
  const empty = parts.length === 0;

  const last = useRef({ questions: 0, readings: 0 });
  useEffect(() => {
    if (last.current.questions === questions.length && last.current.readings === readings) return;
    last.current = { questions: questions.length, readings };
    logger.debug('counts', { questions: questions.length, readings });
  }, [questions.length, readings]);

  const show = (next) => {
    setOpen(next);
    if (!next) setFeedback(null);
    logger.info(next ? 'open' : 'close', { questions: questions.length, readings });
  };

  return (
    <div className={`health-followups${empty ? ' health-followups--empty' : ''}`}>
      {empty ? (
        <span className="health-followups__line"><span aria-live="polite">No follow-ups</span></span>
      ) : (
        <UnstyledButton className="health-followups__line" onClick={() => show(true)} aria-haspopup="dialog">
          <span aria-live="polite">{parts.join(' · ')}</span>
        </UnstyledButton>
      )}
      <Sheet open={open} onClose={() => show(false)} title="Follow-ups">
        {feedback ? <p className="health-followups__feedback" role="status">{feedback}</p> : null}
        {questions.length ? (
          <QuestionDeck questions={questions} onFeedback={setFeedback}
            onChanged={() => { cleanup.reload(); onChanged?.(); }} />
        ) : null}
        {readings ? <ObservationsSection observations={observations} onChanged={onObservationsChanged} /> : null}
        {!questions.length && !readings && !feedback ? <p className="health-qdeck__done">All caught up.</p> : null}
      </Sheet>
    </div>
  );
}

export default FollowUpTray;
