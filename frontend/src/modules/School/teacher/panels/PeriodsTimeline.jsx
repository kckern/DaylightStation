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
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherDateRange } from '../teacherDates.js';

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
  const [localError, setLocalError] = useState(null);
  const [removeArm, setRemoveArm] = useState(null); // index armed for removal
  const now = Date.now();

  const KINDS = ['term', 'semester', 'trimester', 'quarter', 'year'];
  const idFromLabel = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const [baseHistoryLength, setBaseHistoryLength] = useState(null);
  const startEditing = async () => {
    // The concurrent-edit baseline (B14): what we LOADED; the server refuses
    // a save when someone else edited since.
    const meta = await schoolApi.periodsMeta();
    setBaseHistoryLength(meta.ok ? (meta.data?.historyLength ?? null) : null);
    setDraft((periods.data ?? []).map((p) => ({
      periodId: p.periodId, kind: p.kind ?? 'term', label: p.label ?? p.periodId,
      startsAt: day(p.startsAt), endsAt: day(p.endsAt),
      origStartsAt: p.startsAt, origEndsAt: p.endsAt,
      // An EXISTING period's id is settled — a label typo-fix must never
      // silently rename the key its frozen records hang on (M6 gate).
      idTouched: true,
      ...(p.parentPeriodId ? { parentPeriodId: p.parentPeriodId } : {}),
    })));
    setEditing(true);
  };

  const patch = (i, field, value) => setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const save = () => {
    // Friendly pre-validation (B8): catch the obvious before the server's
    // engineer-speak does.
    for (const row of draft) {
      if (!row.periodId.trim()) { setLocalError('Every period needs an id — type a label and one is suggested.'); return; }
      if (!row.startsAt || !row.endsAt) { setLocalError(`"${row.label || row.periodId}" needs both dates.`); return; }
      if (row.endsAt <= row.startsAt) { setLocalError(`"${row.label || row.periodId}" must end after it starts.`); return; }
    }
    setLocalError(null);
    run('save', ({ actorId, pin }) => schoolApi.putPeriods({
    periods: draft.map(({ origStartsAt, origEndsAt, idTouched: _idTouched, cloned: _cloned, ...row }) => ({
      ...row,
      startsAt: row.startsAt === day(origStartsAt) ? origStartsAt : withOriginalTime(row.startsAt, origStartsAt),
      endsAt: row.endsAt === day(origEndsAt) ? origEndsAt : withOriginalTime(row.endsAt, origEndsAt),
    })),
    editedBy: actorId, pin,
    ...(baseHistoryLength !== null ? { baseHistoryLength } : {}),
  }), { onSuccess: () => { setEditing(false); periods.retry(); } });
  };

  return (
    <PanelFrame title="Academic periods" state={periods.state} retry={periods.retry} alwaysRender>
      {!editing && (periods.state === 'ok' || periods.state === 'empty') && (
        <>
          {periods.state === 'empty' ? (
            <p className="teacher-panel__empty">No academic periods configured.</p>
          ) : (
            <ol className="teacher-periods">
              {(periods.data ?? []).map((p) => {
                const current = Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt);
                // Only the NARROWEST current period wears the badge (design
                // audit): a year AND its fall semester both shouting CURRENT
                // gives the container and its child equal rank.
                const span = Date.parse(p.endsAt) - Date.parse(p.startsAt);
                const narrowestCurrent = current && !(periods.data ?? []).some((q) => q !== p
                  && Date.parse(q.startsAt) <= now && now < Date.parse(q.endsAt)
                  && (Date.parse(q.endsAt) - Date.parse(q.startsAt)) < span);
                return (
                  <li key={p.periodId} className="teacher-periods__period" data-current={current ? '' : undefined}>
                    <span className="teacher-periods__label">{p.label}</span>
                    <span className="teacher-periods__range">{teacherDateRange(p.startsAt, p.endsAt)}</span>
                    {narrowestCurrent && <span className="teacher-periods__now">current</span>}
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
              <input
                aria-label={`Label ${i}`}
                value={row.label}
                onChange={(e) => {
                  const label = e.target.value;
                  // The id follows the label until someone edits it by hand
                  // (B8): nobody should have to invent slugs.
                  setDraft((d) => d.map((r, idx) => (idx === i
                    ? { ...r, label, periodId: r.idTouched ? r.periodId : idFromLabel(label) }
                    : r)));
                }}
                placeholder="Label (e.g. Fall 2027)"
              />
              <input
                aria-label={`Period id ${i}`}
                value={row.periodId}
                onChange={(e) => setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, periodId: e.target.value, idTouched: true } : r)))}
                placeholder="period-id"
              />
              <select aria-label={`Kind ${i}`} value={row.kind} onChange={(e) => patch(i, 'kind', e.target.value)}>
                {[...new Set([...KINDS, row.kind].filter(Boolean))].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select aria-label={`Parent ${i}`} value={row.parentPeriodId ?? ''} onChange={(e) => patch(i, 'parentPeriodId', e.target.value || undefined)}>
                <option value="">no parent</option>
                {draft.filter((_, idx) => idx !== i).map((r) => r.periodId).filter(Boolean).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              <input aria-label={`Starts ${i}`} type="date" value={row.startsAt} onChange={(e) => patch(i, 'startsAt', e.target.value)} />
              <input aria-label={`Ends ${i}`} type="date" value={row.endsAt} onChange={(e) => patch(i, 'endsAt', e.target.value)} />
              {removeArm === i ? (
                <span className="teacher-close-period__confirm">
                  <span>Remove? Frozen report cards keyed to this period will no longer resolve.</span>
                  <button type="button" onClick={() => { setDraft((d) => d.filter((_, idx) => idx !== i)); setRemoveArm(null); }}>Confirm</button>
                  <button type="button" onClick={() => setRemoveArm(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setRemoveArm(i)}>Remove</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setDraft((d) => [...d, { periodId: '', kind: 'term', label: '', startsAt: '', endsAt: '' }])}>Add period</button>
          <button
            type="button"
            onClick={() => setDraft((d) => [
              ...d,
              // Clone-forward-a-year (B12): next August's biggest admin chore,
              // one tap. Dates shift +1 year; ids/labels get the year bumped
              // where one appears, else a -next suffix.
              ...d.filter((r) => !r.cloned).map((r) => {
                // Bump full years AND paired spans: '2026-27' → '2027-28',
                // never '2027-27' (the live year id's real shape, M6 gate).
                const bumpYear = (str) => String(str ?? '')
                  .replace(/(20\d{2})-(\d{2})(?!\d)/g, (_, y, yy) => `${Number(y) + 1}-${String(Number(yy) + 1).padStart(2, '0')}`)
                  .replace(/(20\d{2})(?!-\d{2})/g, (y) => String(Number(y) + 1));
                const shift = (dateStr) => {
                  if (!dateStr) return dateStr;
                  return `${Number(dateStr.slice(0, 4)) + 1}${dateStr.slice(4)}`;
                };
                const periodId = bumpYear(r.periodId) !== r.periodId ? bumpYear(r.periodId) : `${r.periodId}-next`;
                return {
                  ...r,
                  cloned: true,
                  idTouched: true,
                  periodId,
                  label: bumpYear(r.label) !== r.label ? bumpYear(r.label) : `${r.label} (next)`,
                  parentPeriodId: r.parentPeriodId ? (bumpYear(r.parentPeriodId) !== r.parentPeriodId ? bumpYear(r.parentPeriodId) : `${r.parentPeriodId}-next`) : undefined,
                  startsAt: shift(r.startsAt),
                  endsAt: shift(r.endsAt),
                  // The clone keeps the ORIGINAL boundary time-of-day (the M3
                  // rule): shifted date + the source instant's suffix.
                  origStartsAt: r.origStartsAt ? shift(day(r.origStartsAt)) + String(r.origStartsAt).slice(10) : undefined,
                  origEndsAt: r.origEndsAt ? shift(day(r.origEndsAt)) + String(r.origEndsAt).slice(10) : undefined,
                };
              }),
            ])}
          >
            Clone forward a year
          </button>
          <div className="teacher-assignments__actions">
            <button type="button" disabled={busy === 'save'} onClick={save}>Save</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {(localError || errors.save) && <p className="teacher-panel__error">{localError ?? errors.save}</p>}
        </div>
      )}
    </PanelFrame>
  );
}
