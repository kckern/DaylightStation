import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Textarea, UnstyledButton } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { useQuestionAnswer } from './CleanupQuestions.jsx';

const SWIPE_PX = 60;

/** The foods a question is about, as the card's heading. */
const subjectOf = (question) => {
  // entryNames is keyed by both a row's id and its uuid: dedupe the names.
  const names = [...new Set(Object.values(question.entryNames || {}).filter(Boolean))];
  return names.length ? names.join(' · ') : 'Your food log';
};

function QuestionCard({ question, index, total, onAnswered, onPrev, onNext, onFeedback }) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const { answer, busy, error, disabled } = useQuestionAnswer({ question, onChanged: () => {}, onFeedback });
  const start = useRef(null);
  const card = useRef(null);
  // Each card is a fresh element: take focus so the arrow keys keep working.
  useEffect(() => { card.current?.focus({ preventScroll: true }); }, []);
  const send = async (payload) => { if (await answer(payload)) onAnswered(question.id); };

  return (
    <article ref={card} className="health-qcard" data-testid="question-card" tabIndex={0} aria-label={`Question ${index + 1} of ${total}`}
      onKeyDown={(event) => {
        if (event.target.tagName === 'TEXTAREA') return;
        if (event.key === 'ArrowRight') { event.preventDefault(); onNext(); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); onPrev(); }
      }}
      // Swipe only from the card itself — never a drag that starts in the
      // text box (selecting text) or on a button (a missed click).
      onPointerDown={(event) => { start.current = event.target.closest?.('textarea, input, button') ? null : event.clientX; }}
      onPointerUp={(event) => {
        if (start.current == null) return;
        const dx = event.clientX - start.current;
        start.current = null;
        if (dx <= -SWIPE_PX) onNext();
        else if (dx >= SWIPE_PX) onPrev();
      }}>
      <header className="health-qcard__head">
        <span className="health-qcard__subject">{subjectOf(question)}</span>
        <span className="health-qcard__count">{index + 1} of {total}</span>
      </header>
      <p className="health-qcard__question">{question.question}</p>
      <div className="health-qcard__choices">
        {(question.choices || []).map((choice) => (
          <UnstyledButton key={choice.id} className="health-qcard__choice" disabled={disabled}
            onClick={() => send({ choiceId: choice.id })}>
            <span className="health-qcard__choice-label">{choice.label}</span>
            {choice.repair?.reason ? <span className="health-qcard__choice-why">{choice.repair.reason}</span> : null}
          </UnstyledButton>
        ))}
      </div>
      {other ? (
        <div className="health-qcard__other">
          <Textarea label="Your answer" value={text} onChange={(event) => setText(event.target.value)}
            maxLength={4000} disabled={disabled} autosize minRows={2} />
          <Button size="xs" disabled={disabled || !text.trim()} loading={busy} onClick={() => send({ text: text.trim() })}>Send</Button>
        </div>
      ) : null}
      {question.status === 'answering' ? <p className="health-qcard__note" role="status">Processing your answer…</p> : null}
      {error ? <p className="health-qcard__error" role="alert">{error}</p> : null}
      <footer className="health-qcard__foot">
        <Button size="compact-sm" variant="subtle" disabled={index === 0} onClick={onPrev}>‹ Back</Button>
        <Button size="compact-sm" variant="subtle" disabled={disabled} onClick={() => send({ dismiss: true })}>Leave as is</Button>
        {other ? null : <Button size="compact-sm" variant="subtle" onClick={() => setOther(true)}>Other answer…</Button>}
        <Button size="compact-sm" variant="subtle" disabled={index >= total - 1} onClick={onNext}>Skip ›</Button>
      </footer>
      <p className="health-qcard__hint">Optional — your current estimate already counts, and settles on its own after 72 hours.</p>
    </article>
  );
}

/**
 * Cleanup follow-up questions as a deck: ONE card at a time, headed by the
 * food it is about, with the choices as big buttons. Swipe, arrow keys or
 * Back/Skip move between cards; answering moves on by itself. Free text is
 * there ("Other answer…") but out of the way.
 */
export function QuestionDeck({ questions = [], onChanged = () => {}, onFeedback = () => {} }) {
  const logger = useMemo(() => createAppLogger('health').child('question-deck'), []);
  const [answered, setAnswered] = useState(() => new Set());
  const [index, setIndex] = useState(0);
  const visible = questions.filter((question) => !answered.has(question.id));
  const at = Math.min(index, Math.max(0, visible.length - 1));

  if (!visible.length) {
    return <p className="health-qdeck__done" role="status">All caught up — no questions waiting.</p>;
  }
  const move = (delta) => setIndex(Math.max(0, Math.min(visible.length - 1, at + delta)));
  return (
    <div className="health-qdeck">
      <QuestionCard key={visible[at].id} question={visible[at]} index={at} total={visible.length}
        onPrev={() => move(-1)} onNext={() => move(1)} onFeedback={onFeedback}
        onAnswered={(id) => {
          logger.info('question.answered', { id, remaining: visible.length - 1 });
          setAnswered((prev) => new Set(prev).add(id));
          onChanged();
        }} />
    </div>
  );
}

export default QuestionDeck;
