import { REOPEN_TITLE, REOPEN_BODY, REOPEN_WARMUP, REOPEN_REWATCH } from './lessonCreditCopy.js';
import './LessonDrill.scss';

/** A lesson that owes a warm-up, opened again: warm up now, or watch again and play along. */
export default function LessonReopenCard({ onWarmUp, onRewatch }) {
  return (
    <section className="lesson-reopen" data-testid="lesson-reopen">
      <h2 className="lesson-reopen__title">{REOPEN_TITLE}</h2>
      <p className="lesson-reopen__body">{REOPEN_BODY}</p>
      <div className="lesson-reopen__actions">
        <button type="button" className="lesson-reopen__primary" onClick={onWarmUp}>{REOPEN_WARMUP}</button>
        <button type="button" className="lesson-reopen__secondary" onClick={onRewatch}>{REOPEN_REWATCH}</button>
      </div>
    </section>
  );
}
