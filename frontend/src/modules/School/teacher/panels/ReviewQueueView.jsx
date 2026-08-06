/**
 * ReviewQueueView — the pending marks awaiting a grown-up, grouped by
 * learner, with INLINE resolution (wave 2, teacher.review.resolve): a
 * verdict plus an optional note (≤120 chars — the delivery cap receipts and
 * agendas already enforce). Server-authoritative: a resolve refreshes the
 * list; a refusal marks ONLY its own item.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';

export default function ReviewQueueView({ items, kids, onResolved }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id ?? 'Unknown';
  const { run, busy, errors } = useTeacherWrite({ panel: 'review-queue' });
  const [notes, setNotes] = useState({});

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
    }), { onSuccess: onResolved });
  };

  return (
    <div className="teacher-review">
      {[...byLearner.entries()].map(([learnerId, list]) => (
        <div key={learnerId} className="teacher-review__group">
          <h3 className="teacher-review__learner">{nameFor(learnerId)}</h3>
          <ul>
            {list.map((item) => {
              const key = `${item.sessionId}:${item.itemId}`;
              return (
                <li key={key} className="teacher-review__item">
                  {item.questionNumber != null && <span className="teacher-review__qnum">Q{item.questionNumber}</span>}
                  <span className="teacher-review__prompt">{item.prompt ?? item.itemId}</span>
                  {item.given != null && <blockquote className="teacher-review__given">{String(item.given)}</blockquote>}
                  <div className="teacher-review__controls">
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="Note for the child (optional)"
                      value={notes[key] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
                      aria-label={`Note for ${item.itemId}`}
                    />
                    <button type="button" disabled={busy === key} onClick={() => resolve(item, 'correct')}>Correct</button>
                    <button type="button" disabled={busy === key} onClick={() => resolve(item, 'incorrect')}>Incorrect</button>
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
