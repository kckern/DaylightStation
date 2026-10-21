/**
 * DebriefsPanel — a learner's after-school debriefs, newest first, with
 * Excuse / Reject / Re-score behind the teacher gate. Every teacher call
 * carries the current teacher's id (`by`): TeacherGate checks the adult id
 * before the capability cookie, so an actor-less call is a 403.
 */
import { useState } from 'react';
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import { useTeacherWrite } from "../useTeacherWrite.js";
import { useTeacherProfileOptional } from "../TeacherProfileContext.jsx";
import PanelFrame from "./PanelFrame.jsx";

const PANEL = 'debriefs';
const PHASE = { completed: 'Done', excused: 'Excused', rejected: 'Rejected', 'not-started': 'Not started', entry: 'In progress', clarify: 'In progress', questions: 'In progress', answering: 'In progress', unreadable: 'Could not read' };

const audioSrc = (audioRef, actorId) => {
  const [owner, ...rest] = String(audioRef).split('/');
  return `/api/v1/school/debrief/teacher/${encodeURIComponent(owner)}/audio/${rest.map(encodeURIComponent).join('/')}?by=${encodeURIComponent(actorId)}`;
};

function Loaded({ learnerId, learnerName, actorId }) {
  const [reason, setReason] = useState('');
  const record = usePanelFetch(() => schoolApi.teacherDebriefs(learnerId, actorId), {
    deps: [learnerId, actorId], panel: PANEL, notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.days ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: PANEL });
  const act = (day, action) => run(`${day}:${action}`,
    ({ actorId: by, pin }) => schoolApi.teacherDebriefAction(learnerId, day, action, { by, pin, reason: action === 'rescore' ? null : (reason.trim() || null) }),
    // The reason belongs to the action just taken: clear it so it cannot ride along on the next day's.
    { onSuccess: () => { setReason(''); record.retry(); } });
  const days = record.data?.days ?? [];
  return (
    <PanelFrame title="Debriefs" state={record.state} retry={record.retry}
      emptyCopy={`No debriefs yet for ${learnerName ?? learnerId}.`}
      unavailableCopy="Debriefs are not available on this install.">
      <div className="teacher-debriefs">
        <label>Reason (for Excuse / Reject) <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {days.map((d) => (
          <article key={d.studyDay} className="teacher-debrief">
            <header><strong>{d.studyDay}</strong> · {PHASE[d.phase] ?? d.phase}{d.late ? ' · late' : ''}{d.questioner === 'fallback' ? ' · fallback questions' : ''}
              {Number.isInteger(d.substance) && <> · detail {d.substance}/10</>}</header>
            {Object.entries(d.entries ?? {}).map(([id, e]) => (
              <p key={id} className="teacher-debrief__entry"><em>{id}</em>: <span>{e.text}</span>
                {e.audioRef && <audio controls preload="none" src={audioSrc(e.audioRef, actorId)} />}</p>
            ))}
            {d.questions?.length > 0 && <ol>{d.questions.map((q) => {
              const a = d.answers?.[q.id];
              return <li key={q.id}>{q.prompt} — <strong>{a?.response ?? '—'}</strong> {a ? (a.correct === true ? '✓' : a.correct === false ? `✗ (${q.answer ?? q.expected})` : '(ungraded)') : ''}</li>;
            })}</ol>}
            {d.summary?.quiz && <p>{d.summary.quiz.right} of {d.summary.quiz.graded} right</p>}
            <div className="teacher-debrief__actions">
              <button type="button" disabled={busy != null} onClick={() => act(d.studyDay, 'excuse')}>Excuse</button>
              <button type="button" disabled={busy != null} onClick={() => act(d.studyDay, 'reject')}>Reject</button>
              {d.questioner === 'fallback' && <button type="button" disabled={busy != null} onClick={() => act(d.studyDay, 'rescore')}>Re-score</button>}
              {['excuse', 'reject', 'rescore'].map((a) => errors?.[`${d.studyDay}:${a}`]
                && <span key={a} role="alert" className="teacher-panel__error">{errors[`${d.studyDay}:${a}`]}</span>)}
            </div>
          </article>
        ))}
      </div>
    </PanelFrame>
  );
}

export default function DebriefsPanel({ learnerId, learnerName }) {
  const profile = useTeacherProfileOptional();
  const actorId = profile?.currentTeacher?.id ?? null;
  if (!actorId) return <p>Pick a teacher to read {learnerName ?? learnerId}’s debriefs.</p>;
  return <Loaded learnerId={learnerId} learnerName={learnerName} actorId={actorId} />;
}
