/**
 * ProgramDayBypassPanel — "today's piano lesson shouldn't be required": a
 * grown-up excusing ONE learner's program obligation for ONE study day.
 *
 * The kiosk hides its whole menu behind an unfinished assigned lesson, so a
 * recital, an illness or a trip needs an escape hatch that is not "go tap the
 * tablet". This is it, and it lives here rather than in an on-kiosk operator
 * drawer for the same reason every other override does: parent-authored,
 * attributed, auditable, reversible.
 *
 * It shows the live gate read beside the form, so a parent sees exactly which
 * lesson they are excusing — or that the day is already done and nothing needs
 * excusing at all — instead of guessing. Same panel shape as AttestationPanel
 * (its nearest sibling in Student → Operations); the write goes through
 * `useTeacherWrite` like every other console mutation.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherDate } from '../teacherDates.js';

/** What the live gate read means, in a parent's words. */
function statusLine(gate) {
  if (gate.state !== 'ok' || !gate.data) return null;
  if (gate.data.reason === 'not-enrolled') return 'No piano course is assigned to this student.';
  if (gate.data.gated) return `Owed today: ${gate.data.lesson?.title ?? 'a lesson'}`;
  if (gate.data.reason === 'bypassed') return 'Already excused today.';
  return 'Already done today.';
}

export default function ProgramDayBypassPanel({ learnerId, learnerName }) {
  const log = usePanelFetch(() => schoolApi.programDayBypasses(learnerId), {
    deps: [learnerId], panel: 'program-day-bypass', notFoundAs: 'unavailable',
  });
  const gate = usePanelFetch(() => schoolApi.pianoLessonGate(learnerId), {
    deps: [learnerId], panel: 'program-day-bypass-gate', notFoundAs: 'unavailable',
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'program-day-bypass' });
  const [reason, setReason] = useState('');
  const [retractReason, setRetractReason] = useState('');

  const active = (log.data?.active ?? []).find((row) => row.learnerId === learnerId) ?? null;
  const refreshBoth = () => { log.retry(); gate.retry(); };

  const grant = () => run('grant', ({ actorId, pin }) => schoolApi.grantProgramDayBypass({
    learnerId, programId: 'piano-course', reason, decidedBy: actorId, pin,
  }), { onSuccess: () => { setReason(''); refreshBoth(); } });

  const retract = () => run('retract', ({ actorId, pin }) => schoolApi.retractProgramDayBypass(
    active.bypassId, { reason: retractReason, retractedBy: actorId, pin },
  ), { onSuccess: () => { setRetractReason(''); refreshBoth(); } });

  return (
    <PanelFrame
      title="Today's piano lesson"
      state={log.state}
      retry={log.retry}
      unavailableCopy="Program excusals are not available on this install."
      alwaysRender
    >
      {statusLine(gate) && <p className="teacher-panel__status">{statusLine(gate)}</p>}
      {active ? (
        // The `.teacher-enrichment` wrapper is load-bearing, not decoration:
        // `.teacher-enrichment button` is a DESCENDANT rule, so a row outside
        // it renders an unstyled browser button beside AttestationPanel's
        // styled one. Same ul/li shape as that panel for the same reason.
        <ul className="teacher-enrichment">
          <li className="teacher-enrichment__row">
            <span className="teacher-enrichment__title">
              Excused by {active.decidedBy}
            </span>
            <span className="teacher-enrichment__dates">
              {active.decidedAt ? teacherDate(active.decidedAt) : active.studyDate}
            </span>
            <span className="teacher-enrichment__note">{active.reason}</span>
            <textarea
              aria-label="Retract reason"
              placeholder="Why retract? (required)"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
            />
            <button
              type="button"
              disabled={busy === 'retract' || !retractReason.trim()}
              onClick={retract}
            >
              Retract
            </button>
            {errors.retract && <p className="teacher-panel__error">{errors.retract}</p>}
          </li>
        </ul>
      ) : (
        <div className="teacher-enrichment__form">
          <textarea
            aria-label="Reason"
            placeholder={`Why is ${learnerName ?? learnerId} off the hook today — recital, illness, travel? (required)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="teacher-assignments__actions">
            <button
              type="button"
              disabled={busy === 'grant' || !reason.trim()}
              onClick={grant}
            >
              Excuse today&rsquo;s piano lesson
            </button>
          </div>
          {errors.grant && <p className="teacher-panel__error">{errors.grant}</p>}
        </div>
      )}
    </PanelFrame>
  );
}
