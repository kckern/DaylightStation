/**
 * QuizRequestBacklog — units children flagged as quiz-gated with no bank.
 * The backlog shrinks two ways (wave 2, teacher.quizrequests.clear): a
 * request shows a "bank authored" badge once a bank bound to its unit
 * exists, and any request can be dismissed through the gate.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';

export default function QuizRequestBacklog({ kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const requests = usePanelFetch(() => schoolApi.quizRequests(), { panel: 'quiz-requests' });
  const { run, busy, errors } = useTeacherWrite({ panel: 'quiz-requests' });

  const dismiss = (r) => {
    const key = `${r.unitId}:${r.userId}`;
    run(key, ({ actorId, pin }) => schoolApi.quizRequestDismiss({
      unitId: r.unitId, userId: r.userId, dismissedBy: actorId, pin,
    }), { onSuccess: requests.retry });
  };

  return (
    <PanelFrame title="Quiz requests" state={requests.state} retry={requests.retry} emptyCopy="No quiz requests waiting.">
      <ul className="teacher-quizreq">
        {(requests.data ?? []).map((r, i) => {
          const key = `${r.unitId}:${r.userId}`;
          return (
            <li key={`${key}:${i}`} className="teacher-quizreq__row">
              <span>{r.unitTitle ?? r.unitId}</span>
              <span className="teacher-quizreq__meta">{r.materialTitle ?? ''} — asked by {nameFor(r.userId)}</span>
              {r.fulfilled && <span className="teacher-quizreq__done">bank authored</span>}
              <button type="button" disabled={busy === key} onClick={() => dismiss(r)}>Dismiss</button>
              {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}
