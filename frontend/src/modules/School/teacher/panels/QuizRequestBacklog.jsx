/**
 * QuizRequestBacklog — units children flagged as quiz-gated with no bank,
 * plus kid-filed retake asks (kind:'retake'). The backlog shrinks two ways
 * (wave 2, teacher.quizrequests.clear): a request shows a "bank authored"
 * badge once a bank bound to its unit exists, and any request can be
 * dismissed through the gate — but a dismissal REQUIRES a reason, which is
 * delivered to the child as a note (advocacy A5: no silent verbs about
 * children).
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';

export default function QuizRequestBacklog({ kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const requests = usePanelFetch(() => schoolApi.quizRequests(), { panel: 'quiz-requests' });
  const { run, busy, errors } = useTeacherWrite({ panel: 'quiz-requests' });
  const [asking, setAsking] = useState(null); // row key whose reason box is open
  const [reason, setReason] = useState('');

  const dismiss = (r, key) => {
    run(key, ({ actorId, pin }) => schoolApi.quizRequestDismiss({
      unitId: r.unitId ?? null, bankId: r.bankId ?? null, userId: r.userId,
      dismissedBy: actorId, pin, reason: reason.trim(),
    }), { onSuccess: () => { setAsking(null); setReason(''); requests.retry(); } });
  };

  return (
    <PanelFrame title="Quiz requests" state={requests.state} retry={requests.retry} emptyCopy="No quiz requests waiting.">
      <ul className="teacher-quizreq">
        {(requests.data ?? []).map((r, i) => {
          const key = `${r.unitId ?? r.bankId}:${r.userId}`;
          return (
            <li key={`${key}:${i}`} className="teacher-quizreq__row">
              {r.kind === 'retake' && <span className="teacher-quizreq__kind">retake</span>}
              {r.kind === 'flag' && <span className="teacher-quizreq__kind teacher-quizreq__kind--flag">flag</span>}
              <span>{r.unitTitle ?? r.title ?? r.unitId ?? r.bankId}</span>
              <span className="teacher-quizreq__meta">
                {r.kind === 'retake'
                  ? `wants another try — asked by ${nameFor(r.userId)}`
                  : r.kind === 'flag'
                    ? `says something seems wrong — ${nameFor(r.userId)}`
                    : `${r.materialTitle ?? ''} — asked by ${nameFor(r.userId)}`}
              </span>
              {r.kind === 'flag' && r.note && (
                <span className="teacher-quizreq__note">&ldquo;{r.note}&rdquo;</span>
              )}
              {r.fulfilled && <span className="teacher-quizreq__done">bank authored</span>}
              {asking === key ? (
                <span className="teacher-quizreq__reason">
                  <input
                    type="text"
                    value={reason}
                    placeholder={`Why? ${nameFor(r.userId)} will see this.`}
                    aria-label="Dismissal reason"
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={240}
                  />
                  <button type="button" disabled={busy === key || !reason.trim()} onClick={() => dismiss(r, key)}>
                    Dismiss &amp; tell them
                  </button>
                  <button type="button" onClick={() => { setAsking(null); setReason(''); }}>Cancel</button>
                </span>
              ) : (
                <button type="button" disabled={busy === key} onClick={() => { setAsking(key); setReason(''); }}>
                  Dismiss…
                </button>
              )}
              {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
            </li>
          );
        })}
      </ul>
      {(requests.data ?? []).length > 0 && (
        <p className="teacher-panel__empty">
          Fulfilling a request means authoring a quiz bank YAML bound to that
          unit (data/content/quizzes/, `unit:` backlink) — the badge flips the
          moment one exists. Dismissing one sends your reason to the child.
        </p>
      )}
    </PanelFrame>
  );
}
