/**
 * QuizRequestBacklog — units children flagged as quiz-gated with no bank,
 * plus kid-filed retake asks (kind:'retake'). The backlog shrinks two ways
 * (wave 2, teacher.quizrequests.clear): a request shows a "bank authored"
 * badge once a bank bound to its unit exists, and any request can be
 * dismissed through the gate — but a dismissal REQUIRES a reason, which is
 * delivered to the child as a note (advocacy A5: no silent verbs about
 * children). A retake ask can also be GRANTED here, which clears it with a
 * note that says yes.
 */
import { useState } from 'react';
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import { useTeacherWrite } from "../useTeacherWrite.js";
import PanelFrame from "./PanelFrame.jsx";

export default function QuizRequestBacklog({ kids, onChanged }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const requests = usePanelFetch(() => schoolApi.quizRequests(), { panel: 'quiz-requests', notFoundAs: 'unavailable' });
  // A degraded/older endpoint must leave this auxiliary panel empty, never
  // take down the whole dashboard.  The server contract is an array.
  const items = Array.isArray(requests.data) ? requests.data : [];
  const { run, busy, errors } = useTeacherWrite({ panel: 'quiz-requests' });
  const [asking, setAsking] = useState(null); // row key whose reason box is open
  const [reason, setReason] = useState('');

  const dismiss = (r, key) => {
    run(key, ({ actorId, pin }) => schoolApi.quizRequestDismiss({
      // kind + sessionId ride along so the server dismisses EXACTLY this row
      // — a retake ask and a flag on the same bank are different sentences.
      unitId: r.unitId ?? null, bankId: r.bankId ?? null,
      kind: r.kind ?? null, sessionId: r.sessionId ?? null, userId: r.userId,
      dismissedBy: actorId, pin, reason: reason.trim(),
    }), { onSuccess: () => { setAsking(null); setReason(''); requests.retry(); onChanged?.(); } });
  };

  // Granting a retake: open another try on the most recent failed attempt of
  // that unit, then clear the ask with a sentence that says YES — it used to
  // take a trip to History and back, and the child then read a "dismissal"
  // for a request that had been granted.
  //
  // Session rows (`listForLearner`) carry no `remediation` field; an attempt
  // already given another try reads `state: 'remediation_opened'`. It is not
  // filtered out: OpenRemediation answers `already_opened` for it, and "yes,
  // you have another try" is still true — which also keeps a retried tap
  // (after a lapsed sign-in) from failing on the try the first tap opened.
  const grant = (r, key) => run(key, async ({ actorId, pin }) => {
    const sessions = await schoolApi.learnerSessions(r.userId);
    if (!sessions.ok) return sessions;
    const failed = (sessions.data?.sessions ?? [])
      .filter((s) => s.unitId === r.unitId && s.outcome?.result === 'needs_remediation')
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0];
    if (!failed) {
      return { ok: false, status: 409, data: { error: 'No failed attempt of this lesson is waiting for another try — open the lesson from History to check.' } };
    }
    const opened = await schoolApi.offerRetake(failed.sessionId, { openedBy: actorId, pin });
    if (!opened.ok) return opened;
    // 201 with `status: 'unavailable'` opened nothing (a paused lesson, say);
    // the ask stays, with the server's own reason.
    if (opened.data?.status === 'unavailable') {
      return { ok: false, status: 409, data: { error: opened.data.message ?? 'There is nothing to try again right now.' } };
    }
    return schoolApi.quizRequestDismiss({
      unitId: r.unitId ?? null, bankId: r.bankId ?? null, kind: 'retake', sessionId: r.sessionId ?? null,
      userId: r.userId, dismissedBy: actorId, pin,
      reason: 'Yes — you have another try. It will be on your next agenda.',
    });
  }, { onSuccess: () => { requests.retry(); onChanged?.(); } });

  return (
    <PanelFrame title="Quiz requests" state={requests.state} retry={requests.retry} emptyCopy="No quiz requests waiting." unavailableCopy="Quiz requests aren't enabled on this install.">
      <ul className="teacher-quizreq">
        {items.map((r, i) => {
          const key = `${r.kind ?? 'quiz'}:${r.unitId ?? r.bankId}:${r.sessionId ?? ''}:${r.userId}`;
          return (
            <li key={`${key}:${i}`} className="teacher-quizreq__row">
              {r.kind === 'retake' && <span className="teacher-quizreq__kind">retake</span>}
              {r.kind === 'flag' && <span className="teacher-quizreq__kind teacher-quizreq__kind--flag">flag</span>}
              <span>{r.unitTitle ?? r.title ?? r.bankTitle ?? 'Requested work with no published title'}</span>
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
              {r.kind === 'retake' && r.unitId && asking !== key && (
                <button type="button" disabled={busy === key} onClick={() => grant(r, key)}>Offer another try</button>
              )}
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
      {items.length > 0 && (
        <p className="teacher-panel__empty">
          A quiz request is fulfilled by authoring a bank for that unit (ask
          whoever maintains the curriculum files); the badge flips the moment
          one exists. Dismissing one sends your reason to the child.
        </p>
      )}
    </PanelFrame>
  );
}
