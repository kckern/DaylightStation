/**
 * PeriodsTimeline — the academic calendar, now EDITABLE (wave 3,
 * teacher.periods.edit over the config→data promotion): whole-list edit
 * (labels, kinds, date bounds, add/remove) saved through the gate.
 * BOUNDARY PRESERVATION (M3 review): the live calendar's instants carry a
 * timezone-offset time-of-day (e.g. T07:00:00.000Z = midnight LA). An
 * untouched date round-trips the ORIGINAL instant verbatim; an edited date
 * keeps the original time-of-day suffix, so a label fix can never shift a
 * period boundary by hours.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';

const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');
// Re-attach the ORIGINAL instant's time-of-day to an edited date; a new row
// (no original) gets midnight UTC.
const withOriginalTime = (date, original) => (
  typeof original === 'string' && original.length > 10
    ? `${date}${original.slice(10)}`
    : `${date}T00:00:00.000Z`
);

export default function PeriodsTimeline() {
  const periods = usePanelFetch(() => schoolApi.periods(), { panel: 'periods' });
  const { run, busy, errors } = useTeacherWrite({ panel: 'periods' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const now = Date.now();

  const startEditing = () => {
    setDraft((periods.data ?? []).map((p) => ({
      periodId: p.periodId, kind: p.kind ?? 'term', label: p.label ?? p.periodId,
      startsAt: day(p.startsAt), endsAt: day(p.endsAt),
      origStartsAt: p.startsAt, origEndsAt: p.endsAt,
      ...(p.parentPeriodId ? { parentPeriodId: p.parentPeriodId } : {}),
    })));
    setEditing(true);
  };

  const patch = (i, field, value) => setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const save = () => run('save', ({ actorId, pin }) => schoolApi.putPeriods({
    periods: draft.map(({ origStartsAt, origEndsAt, ...row }) => ({
      ...row,
      startsAt: row.startsAt === day(origStartsAt) ? origStartsAt : withOriginalTime(row.startsAt, origStartsAt),
      endsAt: row.endsAt === day(origEndsAt) ? origEndsAt : withOriginalTime(row.endsAt, origEndsAt),
    })),
    editedBy: actorId, pin,
  }), { onSuccess: () => { setEditing(false); periods.retry(); } });

  return (
    <section className="teacher-panel" data-state={periods.state}>
      <h2 className="teacher-panel__title">Academic periods</h2>
      {periods.state === 'loading' && <div className="teacher-panel__skeleton" aria-hidden />}
      {periods.state === 'error' && (
        <p className="teacher-panel__error">
          Couldn&rsquo;t load Academic periods.
          <button type="button" className="teacher-panel__retry" onClick={periods.retry}>Retry</button>
        </p>
      )}
      {!editing && (periods.state === 'ok' || periods.state === 'empty') && (
        <>
          {periods.state === 'empty' ? (
            <p className="teacher-panel__empty">No academic periods configured.</p>
          ) : (
            <ol className="teacher-periods">
              {(periods.data ?? []).map((p) => {
                const current = Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt);
                return (
                  <li key={p.periodId} className="teacher-periods__period" data-current={current ? '' : undefined}>
                    <span className="teacher-periods__label">{p.label}</span>
                    <span className="teacher-periods__range">{day(p.startsAt)} → {day(p.endsAt)}</span>
                    {current && <span className="teacher-periods__now">current</span>}
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" className="teacher-assignments__edit" onClick={startEditing}>Edit periods</button>
        </>
      )}
      {editing && (
        <div className="teacher-periods__editor">
          {draft.map((row, i) => (
            <div key={i} className="teacher-periods__editrow">
              <input aria-label={`Period id ${i}`} value={row.periodId} onChange={(e) => patch(i, 'periodId', e.target.value)} placeholder="period-id" />
              <input aria-label={`Label ${i}`} value={row.label} onChange={(e) => patch(i, 'label', e.target.value)} placeholder="Label" />
              <input aria-label={`Kind ${i}`} value={row.kind} onChange={(e) => patch(i, 'kind', e.target.value)} placeholder="kind" />
              <input aria-label={`Starts ${i}`} type="date" value={row.startsAt} onChange={(e) => patch(i, 'startsAt', e.target.value)} />
              <input aria-label={`Ends ${i}`} type="date" value={row.endsAt} onChange={(e) => patch(i, 'endsAt', e.target.value)} />
              <button type="button" onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft((d) => [...d, { periodId: '', kind: 'term', label: '', startsAt: '', endsAt: '' }])}>Add period</button>
          <div className="teacher-assignments__actions">
            <button type="button" disabled={busy === 'save'} onClick={save}>Save</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {errors.save && <p className="teacher-panel__error">{errors.save}</p>}
        </div>
      )}
    </section>
  );
}
