/**
 * ReviewQueueView — the pending marks awaiting a grown-up, grouped by
 * learner, with INLINE resolution (wave 2, teacher.review.resolve): a
 * verdict plus an optional note (≤120 chars — the delivery cap receipts and
 * agendas already enforce). Server-authoritative: a resolve refreshes the
 * list; a refusal marks ONLY its own item.
 *
 * THE THIRD BUTTON. A torn scan, or a question that needs the child in the
 * room, is not a right answer and not a wrong one. "Can't mark this" sends
 * the `void` verdict: the question leaves the score's denominator instead of
 * counting against the kid, and the item stops holding the session open. It
 * is deliberately NOT labelled with the schema's word — this console talks to
 * a parent, the way `interventions.js` names every repair tool in the
 * family's language rather than the system's.
 *
 * It arms before it acts, exactly like `QuizRequestBacklog`'s dismissal: the
 * note stops being optional the moment the verdict is `void`, so tapping the
 * button opens the sentence the child will read rather than firing a write
 * that the server would (rightly) refuse for having nothing to say.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { waitAge } from './waitAge.js';

const REASON_COPY = {
  ambiguous: 'the scanner could not tell which bubble was meant',
  blank: 'the row was left blank',
  free_response: 'a written answer needs a human mark',
};

export default function ReviewQueueView({ items, kids, onResolved }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id ?? 'Unknown';
  const { run, busy, errors } = useTeacherWrite({ panel: 'review-queue' });
  const [notes, setNotes] = useState({});
  // The one row whose "can't mark this" is armed and waiting on its reason.
  const [voiding, setVoiding] = useState(null);

  const byLearner = new Map();
  for (const item of items) {
    const key = item.learnerId ?? 'unknown';
    if (!byLearner.has(key)) byLearner.set(key, []);
    byLearner.get(key).push(item);
  }

  const resolve = (item, verdict) => {
    const key = `${item.sessionId}:${item.itemId}`;
    run(key, ({ actorId, pin }) => schoolApi.resolveReview(item.sessionId, item.itemId, {
      verdict, note: (notes[key] ?? '').trim() || null, gradedBy: actorId, pin,
    }), {
      onSuccess: (data) => {
        // Disarm on the way out, so a refreshed list never reopens a reason
        // box for a row that has already been dealt with.
        setVoiding((armed) => (armed === key ? null : armed));
        onResolved?.(data);
      },
    });
  };

  return (
    <div className="teacher-review">
      {[...byLearner.entries()].map(([learnerId, list]) => (
        <div key={learnerId} className="teacher-review__group">
          <h3 className="teacher-review__learner">{nameFor(learnerId)}</h3>
          <ul>
            {list.map((item) => {
              const key = `${item.sessionId}:${item.itemId}`;
              const arming = voiding === key;
              const noteWritten = Boolean((notes[key] ?? '').trim());
              return (
                <li key={key} className="teacher-review__item">
                  {item.questionNumber != null && <span className="teacher-review__qnum">Q{item.questionNumber}</span>}
                  <span className="teacher-review__prompt">{item.prompt ?? 'Question text unavailable'}</span>
                  {waitAge(item.enqueuedAt) && (
                    <span className="teacher-review__age">waiting {waitAge(item.enqueuedAt)}</span>
                  )}
                  {item.reason && (
                    <span className="teacher-review__reason">{REASON_COPY[item.reason] ?? item.reason}</span>
                  )}
                  {item.given != null && <blockquote className="teacher-review__given">{String(item.given)}</blockquote>}
                  {item.rubric && (
                    <p className="teacher-review__rubric">Marking guide: {item.rubric}</p>
                  )}
                  <div className="teacher-review__controls">
                    <input
                      type="text"
                      maxLength={120}
                      placeholder={arming
                        ? `Why can't it be marked? ${nameFor(learnerId)} will read this.`
                        : 'Note for the child (optional)'}
                      value={notes[key] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
                      aria-label={`Note for ${item.itemId}`}
                    />
                    {arming ? (
                      <>
                        <button
                          type="button"
                          disabled={busy === key || !noteWritten}
                          onClick={() => resolve(item, 'void')}
                        >
                          Can&rsquo;t mark it &mdash; tell them
                        </button>
                        <button type="button" onClick={() => setVoiding(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={busy === key} onClick={() => resolve(item, 'correct')}>Correct</button>
                        <button type="button" disabled={busy === key} onClick={() => resolve(item, 'incorrect')}>Incorrect</button>
                        <button type="button" disabled={busy === key} onClick={() => setVoiding(key)}>Can&rsquo;t mark this</button>
                      </>
                    )}
                  </div>
                  {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
