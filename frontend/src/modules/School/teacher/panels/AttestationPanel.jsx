/**
 * AttestationPanel — "I verify this was done" (wave 5, spec D2): record a
 * gated override when the tech failed a child who did the work, and read
 * the attestation log. An attested unit unlocks its successor (planner +
 * milestones honor it); the report card never reads it — its own evidence
 * kind, always with a reason.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { curriculumTitles } from '../curriculumTitles.js';
import { teacherDate } from '../teacherDates.js';

export default function AttestationPanel({ learnerId, learnerName }) {
  const log = usePanelFetch(() => schoolApi.attestations(learnerId), {
    deps: [learnerId],
    panel: 'attestations',
    isEmpty: (d) => !(d?.entries ?? []).length,
  });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'attestation-catalog',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'attestations' });
  const retract = (a) => run(`retract:${a.id}`, ({ actorId, pin }) => schoolApi.retract({
    kind: 'attestation', entryId: a.id, retractedBy: actorId, pin,
  }), { onSuccess: log.retry });
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [reason, setReason] = useState('');

  const units = catalog.data?.units ?? [];
  const titles = curriculumTitles(units);
  const save = () => run('save', ({ actorId, pin }) => schoolApi.postAttestation({
    learnerId, unitId, reason, attestedBy: actorId, pin,
  }), { onSuccess: () => { setOpen(false); setReason(''); log.retry(); } });

  return (
    <PanelFrame title="Attestations" state={log.state} retry={log.retry} alwaysRender>
      {(log.state === 'ok' || log.state === 'empty') && (
        <>
          {log.state === 'empty' ? (
            <p className="teacher-panel__empty">No overrides recorded for {learnerName ?? learnerId}.</p>
          ) : (
            <ul className="teacher-enrichment">
              {[...log.data.entries].reverse().map((a) => (
                <li key={a.id} className="teacher-enrichment__row">
                  <span className="teacher-enrichment__title">{titles.lesson(a.unitId)}</span>
                  <span className="teacher-enrichment__dates">{teacherDate(a.at)} — {a.attestedBy}</span>
                  <span className="teacher-enrichment__note">{a.reason}</span>
                  <button type="button" disabled={busy === `retract:${a.id}`} onClick={() => retract(a)}>Retract</button>
                  {errors[`retract:${a.id}`] && <p className="teacher-panel__error">{errors[`retract:${a.id}`]}</p>}
                </li>
              ))}
            </ul>
          )}
          {!open && catalog.state === 'ok' && (
            <button type="button" className="teacher-assignments__edit" onClick={() => setOpen(true)}>Attest a unit</button>
          )}
          {open && (
            <div className="teacher-enrichment__form">
              <select aria-label="Unit to attest" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Pick a unit…</option>
                {units.map((u) => <option key={u.unitId} value={u.unitId}>{titles.lesson(u.unitId)}</option>)}
              </select>
              <textarea
                aria-label="Reason"
                placeholder="Why the override — what actually happened? (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="teacher-assignments__actions">
                <button type="button" disabled={busy === 'save' || !unitId || !reason.trim()} onClick={save}>Attest</button>
                <button type="button" onClick={() => setOpen(false)}>Cancel</button>
              </div>
              {errors.save && <p className="teacher-panel__error">{errors.save}</p>}
            </div>
          )}
        </>
      )}
    </PanelFrame>
  );
}
