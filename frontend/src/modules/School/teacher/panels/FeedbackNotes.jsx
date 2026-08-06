/**
 * FeedbackNotes — the child's-eye view of resolved verdicts and notes
 * (GET /review/learner/:id answers only RESOLVED items, newest first): what
 * actually reached their agenda and receipts. Standalone notes are the
 * teacher.notes.standalone stub.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

export default function FeedbackNotes({ learnerId, learnerName }) {
  const feedback = usePanelFetch(() => schoolApi.reviewLearner(learnerId), {
    deps: [learnerId],
    panel: 'feedback-notes',
  });
  return (
    <PanelFrame
      title="Feedback delivered"
      state={feedback.state}
      retry={feedback.retry}
      emptyCopy={`No feedback delivered to ${learnerName ?? learnerId} yet.`}
    >
      <ul className="teacher-feedback">
        {(Array.isArray(feedback.data) ? feedback.data : []).map((item) => (
          <li key={`${item.sessionId}:${item.itemId}`} className="teacher-feedback__row" data-verdict={item.verdict}>
            <span className="teacher-feedback__verdict">{item.verdict}</span>
            <span className="teacher-feedback__unit">{item.unitId ?? item.sessionId}</span>
            {item.note && <blockquote className="teacher-feedback__note">{item.note}</blockquote>}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
