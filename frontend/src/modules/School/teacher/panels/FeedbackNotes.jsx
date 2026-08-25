/**
 * FeedbackNotes — the child's-eye view of resolved verdicts and notes
 * (GET /review/learner/:id answers only RESOLVED items, newest first): what
 * actually reached their agenda and receipts. Standalone notes are the
 * teacher.notes.standalone stub.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';
import { teacherDate } from '../teacherDates.js';

// Consecutive verdicts from the same session collapse into one expandable
// summary row; notes always stand alone. "engine" is a machine id, not a
// person — it never renders as an attribution.
function groupFeedback(rows) {
  const groups = [];
  for (const item of rows) {
    const key = item.kind === 'note' ? `note:${item.itemId}` : `ses:${item.sessionId}`;
    const last = groups.at(-1);
    if (last && last.key === key && last.kind !== 'note') last.items.push(item);
    else groups.push({ key, kind: item.kind ?? 'verdict', items: [item] });
  }
  return groups;
}

function summaryLine(group) {
  const correct = group.items.filter((item) => item.verdict === 'correct').length;
  const title = group.items.find((item) => item.unitTitle)?.unitTitle ?? 'Lesson';
  return `${correct} of ${group.items.length} correct · ${title}`;
}

function attribution(item) {
  const by = item.gradedBy && item.gradedBy !== 'engine' ? ` — ${item.gradedBy}` : '';
  return `${teacherDate(item.gradedAt)}${by}`;
}

export default function FeedbackNotes({ learnerId, learnerName }) {
  const [limit, setLimit] = useState(20);
  const feedback = usePanelFetch(() => schoolApi.reviewLearner(learnerId, { limit }), {
    deps: [learnerId, limit],
    panel: 'feedback-notes',
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'feedback-retract' });
  const retract = (item) => run(item.itemId, ({ actorId, pin }) => schoolApi.retract({
    kind: 'note', entryId: item.itemId, retractedBy: actorId, pin,
  }), { onSuccess: feedback.retry });
  return (
    <PanelFrame
      title="Feedback delivered"
      state={feedback.state}
      retry={feedback.retry}
      emptyCopy={`No feedback delivered to ${learnerName ?? learnerId} yet.`}
    >
      <ul className="teacher-feedback">
        {groupFeedback(Array.isArray(feedback.data) ? feedback.data : []).map((group) => (
          group.kind === 'note' || group.items.length === 1 ? group.items.map((item) => (
            <li key={`${item.sessionId ?? 'note'}:${item.itemId}`} className="teacher-feedback__row" data-verdict={item.verdict ?? 'note'}>
              <span className="teacher-feedback__verdict">{item.kind === 'note' ? 'note' : item.verdict}</span>
              <span className="teacher-feedback__unit">{item.unitTitle ?? item.title ?? (item.kind === 'note' ? '' : 'Lesson feedback')}</span>
              <span className="teacher-feedback__meta">{attribution(item)}</span>
              {item.note && <blockquote className="teacher-feedback__note">{item.note}</blockquote>}
              {item.kind === 'note' && (
                <button type="button" className="teacher-feedback__retract" disabled={busy === item.itemId} onClick={() => retract(item)}>Retract</button>
              )}
              {errors[item.itemId] && <p className="teacher-panel__error">{errors[item.itemId]}</p>}
            </li>
          )) : (
            <li key={group.key} className="teacher-feedback__group">
              <details>
                <summary>
                  <span className="teacher-feedback__unit">{summaryLine(group)}</span>
                  <span className="teacher-feedback__meta">{teacherDate(group.items[0].gradedAt)}</span>
                </summary>
                <ul>
                  {group.items.map((item) => (
                    <li key={`${item.sessionId}:${item.itemId}`} className="teacher-feedback__row" data-verdict={item.verdict}>
                      <span className="teacher-feedback__verdict">{item.verdict}</span>
                      <span className="teacher-feedback__unit">{item.prompt ?? item.unitTitle ?? ''}</span>
                      <span className="teacher-feedback__meta">{attribution(item)}</span>
                      {item.note && <blockquote className="teacher-feedback__note">{item.note}</blockquote>}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )
        ))}
      </ul>
      {Array.isArray(feedback.data) && feedback.data.length >= limit && limit < 100 && (
        // The route clamps at 100 — never ask past it (a 400 here would
        // collapse the whole panel).
        <button type="button" className="teacher-assignments__edit" onClick={() => setLimit((n) => Math.min(n + 20, 100))}>Show more</button>
      )}
    </PanelFrame>
  );
}

/**
 * NoteComposer — write a note to a learner OUTSIDE the review flow (wave 5,
 * spec D3); it reaches the same agenda/receipt/feedback surfaces the review
 * notes do. Rendered by HistoryView beside FeedbackNotes.
 */
export function NoteComposer({ learnerId, learnerName, onSent }) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'note-composer' });
  const [draft, setDraft] = useState('');
  const send = () => run('send', ({ actorId, pin }) => schoolApi.postTeacherNote({
    learnerId, note: draft, from: actorId, pin,
  }), { onSuccess: () => { setDraft(''); onSent?.(); } });
  return (
    <section className="teacher-panel">
      <h2 className="teacher-panel__title">Write a note</h2>
      <div className="teacher-enrichment__form">
        <textarea
          aria-label="Note to learner"
          maxLength={240}
          placeholder={`A note for ${learnerName ?? learnerId} — it reaches their agenda and receipts.`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="teacher-assignments__actions">
          <button type="button" disabled={busy === 'send' || !draft.trim()} onClick={send}>Send</button>
        </div>
        {errors.send && <p className="teacher-panel__error">{errors.send}</p>}
      </div>
    </section>
  );
}
