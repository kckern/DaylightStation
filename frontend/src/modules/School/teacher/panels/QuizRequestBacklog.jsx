/**
 * QuizRequestBacklog — units children flagged as quiz-gated with no bank
 * (the authoring backlog; clearing it is the teacher.quizrequests.clear stub).
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

export default function QuizRequestBacklog({ kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const requests = usePanelFetch(() => schoolApi.quizRequests(), { panel: 'quiz-requests' });
  return (
    <PanelFrame title="Quiz requests" state={requests.state} retry={requests.retry} emptyCopy="No quiz requests waiting.">
      <ul className="teacher-quizreq">
        {(requests.data ?? []).map((r, i) => (
          <li key={`${r.unitId}:${r.userId}:${i}`} className="teacher-quizreq__row">
            <span>{r.unitTitle ?? r.unitId}</span>
            <span className="teacher-quizreq__meta">{r.materialTitle ?? ''} — asked by {nameFor(r.userId)}</span>
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
