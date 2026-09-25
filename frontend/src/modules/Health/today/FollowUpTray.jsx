import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionIcon, Menu, VisuallyHidden } from '@mantine/core';
import { IconBell, IconScale } from '@tabler/icons-react';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { useCleanup } from '../cleanup/CleanupQuestions.jsx';
import { QuestionDeck, subjectOf } from '../cleanup/QuestionDeck.jsx';
import { ObservationsSection } from './ObservationRow.jsx';

const logger = createAppLogger('health').child('follow-ups');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// The dropdown names this many questions; the rest are "N more".
const LISTED = 5;

/**
 * Things waiting on the person that nobody just asked for: cleanup follow-up
 * questions (polled every 15 s) and kitchen-scale readings nothing has claimed.
 * They arrive on their own schedule, so they take NO space on the page. They
 * show as a bell in the app header (`target`, a fixed-size slot next to
 * settings), with a red count floating over it when something is waiting. An
 * arrival changes the badge, never the layout. The bell drops down a short list
 * of what is waiting; picking an item opens its flow in a sheet (the question
 * card deck, starting at that question, or the unclaimed scale readings).
 */
export function FollowUpTray({ active = true, target = null, observations = [], onObservationsChanged, onChanged }) {
  const cleanup = useCleanup(active);
  const [sheet, setSheet] = useState(null); // null | { startId }
  // Held here: a stale answer to the LAST question empties the list, and the
  // message must outlive it.
  const [feedback, setFeedback] = useState(null);
  const questions = cleanup.data?.questions || [];
  const readings = observations.length;
  const parts = [questions.length ? plural(questions.length, 'follow-up question', 'follow-up questions') : null,
    readings ? plural(readings, 'scale reading', 'scale readings') : null,
    feedback && !questions.length ? 'A follow-up needs a look' : null].filter(Boolean);
  const empty = parts.length === 0;
  const summary = empty ? 'No follow-ups' : parts.join(' · ');
  const count = questions.length + readings;

  const last = useRef({ questions: 0, readings: 0 });
  useEffect(() => {
    if (last.current.questions === questions.length && last.current.readings === readings) return;
    last.current = { questions: questions.length, readings };
    logger.debug('counts', { questions: questions.length, readings });
  }, [questions.length, readings]);

  const openSheet = (startId = null) => {
    setSheet({ startId });
    logger.info('open', { questions: questions.length, readings, startId });
  };
  const closeSheet = () => {
    setSheet(null);
    setFeedback(null);
    logger.info('close', { questions: questions.length, readings });
  };

  const bell = (
    <span className={`health-followups${empty ? ' health-followups--empty' : ''}`}>
      {/* No focus trap: its aria-hider would race the sheet a pick opens and
          leave the page (the sheet included) aria-hidden. Arrow keys and
          Escape still work. */}
      <Menu position="bottom-end" width={300} shadow="md" withinPortal trapFocus={false}
        onOpen={() => logger.debug('menu.open', { questions: questions.length, readings })}>
        <Menu.Target>
          <ActionIcon variant="subtle" size="lg" className="health-followups__button" aria-label={summary}>
            <IconBell size={20} stroke={1.6} aria-hidden="true" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown className="health-followups__menu">
          {empty ? <Menu.Label>Nothing waiting. All caught up.</Menu.Label> : null}
          {questions.slice(0, LISTED).map((question) => (
            <Menu.Item key={question.id} onClick={() => openSheet(question.id)}>
              <span className="health-followups__item-subject">{subjectOf(question)}</span>
              <span className="health-followups__item-text">{question.question}</span>
            </Menu.Item>
          ))}
          {questions.length > LISTED ? (
            <Menu.Item onClick={() => openSheet(questions[LISTED].id)}>{`${questions.length - LISTED} more questions`}</Menu.Item>
          ) : null}
          {readings ? (
            <Menu.Item leftSection={<IconScale size={16} aria-hidden="true" />} onClick={() => openSheet()}>
              {`${plural(readings, 'scale reading', 'scale readings')} to match`}
            </Menu.Item>
          ) : null}
          {feedback && !questions.length ? <Menu.Item onClick={() => openSheet()}>A follow-up needs a look</Menu.Item> : null}
        </Menu.Dropdown>
      </Menu>
      {/* Floats over the bell: its arrival moves nothing. */}
      {empty ? null : <span className="health-followups__badge" aria-hidden="true">{count || '!'}</span>}
      {/* ONE persistent live region, updated (and announced), never replaced. */}
      <VisuallyHidden aria-live="polite">{summary}</VisuallyHidden>
    </span>
  );

  return (
    <>
      {target ? createPortal(bell, target) : bell}
      <Sheet open={Boolean(sheet)} onClose={closeSheet} title="Follow-ups">
        {feedback ? <p className="health-followups__feedback" role="status">{feedback}</p> : null}
        {questions.length ? (
          <QuestionDeck key={sheet?.startId || 'first'} questions={questions} startId={sheet?.startId}
            onFeedback={setFeedback} onChanged={() => { cleanup.reload(); onChanged?.(); }} />
        ) : null}
        {readings ? <ObservationsSection observations={observations} onChanged={onObservationsChanged} /> : null}
        {!questions.length && !readings && !feedback ? <p className="health-qdeck__done">All caught up.</p> : null}
      </Sheet>
    </>
  );
}

export default FollowUpTray;
