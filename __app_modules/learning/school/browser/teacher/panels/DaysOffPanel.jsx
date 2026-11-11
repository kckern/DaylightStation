/**
 * DaysOffPanel — the household calendar's breaks, edited from the console.
 *
 * Lists upcoming breaks (past ones folded away and read-only), adds / edits /
 * removes them, offers a one-step away trip, writes the activity text of an
 * enrichment or holiday break's date-bound unit, and optionally the per-tier
 * keep-lists. Saves go through the gated teacher write with the file
 * revision loaded; the server refuses a stale save and any change to a day
 * already judged, and the change is live without a restart.
 * See `__docs/reference/school/day-off-tiers.md`.
 *
 * Touch: every control is a button, a date field, a text field or a select —
 * no sliders, no drag.
 */
import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import PanelFrame from "./PanelFrame.jsx";
import { useTeacherWrite } from "../useTeacherWrite.js";
import { teacherDateRange } from "../teacherDates.js";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";
import {
  TIERS, TIER_LABELS, ACTIVITY_TIERS, splitBreaks, draftFromServer, payloadFromDraft,
  validateDraft, awayTrip, blankBreak,
} from "./daysOffModel.js";

const KEEP_TIERS = ['stay-home', 'enrichment', 'major-holiday', 'away'];
const selectorKey = (s) => (s.subject ? `subject:${s.subject}` : `program:${s.program}`);
const selectorFrom = (key) => {
  const [kind, id] = key.split(':');
  return kind === 'subject' ? { subject: id } : { program: id };
};
const selectorLabel = (s) => (s.subject ? s.subject : s.program);

function TierChip({ tier }) {
  return <span className="teacher-daysoff__tier" data-tier={tier}>{TIER_LABELS[tier] ?? tier}</span>;
}

function BreakRow({ brk, activity }) {
  return (
    <li className="teacher-daysoff__row">
      <span className="teacher-daysoff__dates">{teacherDateRange(brk.from, brk.to === brk.from ? null : brk.to)}</span>
      <span className="teacher-daysoff__label">{brk.label || '—'}</span>
      <TierChip tier={brk.tier ?? 'away'} />
      {brk.replaces && <span className="teacher-daysoff__note">replaces {brk.replaces}</span>}
      {activity?.title && <span className="teacher-daysoff__note">{activity.title}</span>}
    </li>
  );
}

export default function DaysOffPanel({ kids = [] }) {
  const logger = useMemo(() => getLogger().child({ component: 'days-off-panel' }), []);
  const calendar = usePanelFetch(() => schoolApi.calendar(), {
    panel: 'days-off',
    notFoundAs: 'unavailable',
    // A calendar with no breaks is still an editor, never an empty panel.
    isEmpty: () => false,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'days-off' });
  const [draft, setDraft] = useState(null);
  const [mode, setMode] = useState(null); // null | 'edit' | 'trip'
  const [trip, setTrip] = useState({ from: '', to: '', label: '' });
  const [showPast, setShowPast] = useState(false);
  const [showKeep, setShowKeep] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [removeArm, setRemoveArm] = useState(null);

  useEffect(() => { logger.info('days-off.mounted', {}); }, [logger]);

  const data = calendar.data ?? null;
  const today = data?.today ?? '';
  const { upcoming, past } = splitBreaks(data?.except ?? [], today);

  const start = (nextMode) => {
    setDraft(draftFromServer(data));
    setLocalError(null);
    setRemoveArm(null);
    setMode(nextMode);
    if (nextMode === 'trip') setTrip({ from: today, to: today, label: '' });
    logger.info('days-off.edit-start', { mode: nextMode, breaks: (data?.except ?? []).length });
  };
  const cancel = () => { setMode(null); setDraft(null); setLocalError(null); };
  const patch = (key, fields) => setDraft((d) => ({ ...d, breaks: d.breaks.map((b) => (b.key === key ? { ...b, ...fields } : b)) }));
  const patchActivity = (key, fields) => setDraft((d) => ({
    ...d,
    breaks: d.breaks.map((b) => (b.key === key ? { ...b, activity: { ...(b.activity ?? { title: '', instructions: '', editable: true }), ...fields } } : b)),
  }));
  const setTier = (brk, tier) => patch(brk.key, {
    tier,
    activity: ACTIVITY_TIERS.includes(tier)
      ? brk.activity ?? { title: '', instructions: '', editable: true }
      : brk.activity,
    assignTo: ACTIVITY_TIERS.includes(tier) && !brk.assignment && !brk.assignTo?.length ? kids.map((k) => k.id) : brk.assignTo,
  });

  const save = (nextDraft) => {
    const problem = validateDraft(nextDraft);
    if (problem) { setLocalError(problem); logger.warn('days-off.invalid', { problem }); return; }
    setLocalError(null);
    const body = payloadFromDraft(nextDraft);
    logger.info('days-off.save', { breaks: body.except.length, activities: body.activities.length, keepLists: Boolean(nextDraft.keepListsTouched) });
    run('save', ({ actorId, pin }) => schoolApi.putCalendar({ ...body, editedBy: actorId, pin }), {
      onSuccess: () => { setMode(null); setDraft(null); calendar.retry(); logger.info('days-off.saved', {}); },
    }).then((saved) => { if (saved === false) logger.warn('days-off.save-refused', {}); });
  };

  const saveTrip = () => {
    if (!trip.from || !trip.to) { setLocalError('The trip needs both dates.'); return; }
    if (trip.to < trip.from) { setLocalError('The trip ends before it starts.'); return; }
    if (trip.from < today) { setLocalError('A trip can only start today or later.'); return; }
    save({ ...draft, breaks: [...draft.breaks, awayTrip(trip)] });
  };

  // --- keep-lists -------------------------------------------------------------
  const effectiveKeep = (tier) => (draft?.keepListsTouched
    ? draft.keepLists?.[tier]?.keep ?? []
    : data?.effectivePolicy?.[tier]?.keep ?? []);
  const setKeep = (tier, keep) => setDraft((d) => {
    const lists = Object.fromEntries(KEEP_TIERS.map((t) => [t, { keep: t === tier ? keep : (d.keepListsTouched ? d.keepLists?.[t]?.keep ?? [] : data?.effectivePolicy?.[t]?.keep ?? []) }]));
    return { ...d, keepLists: lists, keepListsTouched: true };
  });
  const keepOptions = [
    ...(data?.subjects ?? []).map((id) => `subject:${id}`),
    ...(data?.programs ?? []).map((id) => `program:${id}`),
  ];

  const editing = mode === 'edit' && draft;
  const editingUpcoming = editing ? draft.breaks.filter((b) => b.lock !== 'past').sort((a, b) => (a.isNew === b.isNew ? String(a.from).localeCompare(String(b.from)) : (a.isNew ? 1 : -1))) : [];

  return (
    <PanelFrame title="Days off" state={calendar.state} retry={calendar.retry} alwaysRender
      unavailableCopy="The household calendar can't be edited on this install.">
      {!mode && (
        <div className="teacher-daysoff">
          {upcoming.length ? (
            <ul className="teacher-daysoff__list">
              {upcoming.map((b) => <BreakRow key={`${b.from}-${b.label}`} brk={b} activity={data?.activities?.[b.assignment]} />)}
            </ul>
          ) : <p className="teacher-panel__empty">No days off coming up.</p>}
          {past.length > 0 && (
            <>
              <button type="button" className="teacher-daysoff__fold" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
                {showPast ? 'Hide past breaks' : `Past breaks (${past.length})`}
              </button>
              {showPast && (
                <ul className="teacher-daysoff__list" data-past="">
                  {past.map((b) => <BreakRow key={`${b.from}-${b.label}`} brk={b} activity={data?.activities?.[b.assignment]} />)}
                </ul>
              )}
            </>
          )}
          <div className="teacher-daysoff__actions">
            <button type="button" onClick={() => start('edit')} disabled={!data}>Edit days off</button>
            <button type="button" onClick={() => start('trip')} disabled={!data}>Add an away trip</button>
          </div>
        </div>
      )}

      {mode === 'trip' && draft && (
        <div className="teacher-daysoff teacher-daysoff__editor">
          <h3 className="teacher-daysoff__heading">Away trip</h3>
          <p className="teacher-daysoff__help">Nothing is asked on these days, scripture included.</p>
          <div className="teacher-daysoff__fields">
            <label>From <input type="date" aria-label="Trip starts" value={trip.from} min={today} onChange={(e) => setTrip((t) => ({ ...t, from: e.target.value, to: t.to < e.target.value ? e.target.value : t.to }))} /></label>
            <label>To <input type="date" aria-label="Trip ends" value={trip.to} min={trip.from || today} onChange={(e) => setTrip((t) => ({ ...t, to: e.target.value }))} /></label>
            <label className="teacher-daysoff__wide">Name <input aria-label="Trip name" value={trip.label} placeholder="Away" onChange={(e) => setTrip((t) => ({ ...t, label: e.target.value }))} /></label>
          </div>
          <div className="teacher-daysoff__actions">
            <button type="button" className="teacher-daysoff__primary" disabled={busy === 'save'} onClick={saveTrip}>Save trip</button>
            <button type="button" onClick={cancel}>Cancel</button>
          </div>
          {(localError || errors.save) && <p className="teacher-panel__error">{localError ?? errors.save}</p>}
        </div>
      )}

      {editing && (
        <div className="teacher-daysoff teacher-daysoff__editor">
          {editingUpcoming.map((brk) => {
            const started = brk.lock === 'started';
            const hasActivity = ACTIVITY_TIERS.includes(brk.tier);
            return (
              <fieldset key={brk.key} className="teacher-daysoff__card" data-tier={brk.tier}>
                <legend className="teacher-daysoff__legend">{brk.label || 'New break'}</legend>
                <div className="teacher-daysoff__fields">
                  <label className="teacher-daysoff__wide">Name <input aria-label={`Name of ${brk.label || 'new break'}`} value={brk.label} placeholder="e.g. Thanksgiving" onChange={(e) => patch(brk.key, { label: e.target.value })} /></label>
                  <label>From <input type="date" aria-label={`Starts ${brk.label || 'new break'}`} value={brk.from} disabled={started} min={started ? undefined : today} onChange={(e) => patch(brk.key, { from: e.target.value, to: brk.to < e.target.value ? e.target.value : brk.to })} /></label>
                  <label>To <input type="date" aria-label={`Ends ${brk.label || 'new break'}`} value={brk.to} min={started ? today : brk.from || today} onChange={(e) => patch(brk.key, { to: e.target.value })} /></label>
                </div>
                {started && <p className="teacher-daysoff__help">Already under way — only its end can move, and not before today.</p>}
                <div className="teacher-daysoff__tiers" role="group" aria-label={`Kind of day for ${brk.label || 'new break'}`}>
                  {TIERS.map((tier) => (
                    <button key={tier} type="button" data-tier={tier} aria-pressed={brk.tier === tier} onClick={() => setTier(brk, tier)}>{TIER_LABELS[tier]}</button>
                  ))}
                </div>
                {brk.tier === 'enrichment' && (
                  <label className="teacher-daysoff__fields">Replaces
                    <select aria-label={`Subject replaced on ${brk.label || 'new break'}`} value={brk.replaces} onChange={(e) => patch(brk.key, { replaces: e.target.value })}>
                      <option value="">pick a subject</option>
                      {(data?.subjects ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                {hasActivity && brk.activity?.editable === false && (
                  <p className="teacher-daysoff__help">Its activity ({brk.assignment}) is a curriculum lesson; edit it in the curriculum.</p>
                )}
                {hasActivity && brk.activity?.editable !== false && (
                  <div className="teacher-daysoff__activity">
                    <label className="teacher-daysoff__wide">Activity <input aria-label={`Activity title for ${brk.label || 'new break'}`} value={brk.activity?.title ?? ''} placeholder="e.g. Read Luke 2 together" onChange={(e) => patchActivity(brk.key, { title: e.target.value })} /></label>
                    <label className="teacher-daysoff__wide">Instructions
                      <textarea aria-label={`Activity instructions for ${brk.label || 'new break'}`} rows={3} value={brk.activity?.instructions ?? ''} onChange={(e) => patchActivity(brk.key, { instructions: e.target.value })} />
                    </label>
                    {!brk.assignment && kids.length > 0 && (
                      <div className="teacher-daysoff__who" role="group" aria-label="Who does it">
                        <span>Who does it</span>
                        {kids.map((kid) => {
                          const on = (brk.assignTo ?? []).includes(kid.id);
                          return (
                            <button key={kid.id} type="button" aria-pressed={on}
                              onClick={() => patch(brk.key, { assignTo: on ? brk.assignTo.filter((id) => id !== kid.id) : [...(brk.assignTo ?? []), kid.id] })}>
                              {kid.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {!started && (removeArm === brk.key ? (
                  <span className="teacher-daysoff__confirm">
                    <span>Remove this break?</span>
                    <button type="button" onClick={() => { setDraft((d) => ({ ...d, breaks: d.breaks.filter((b) => b.key !== brk.key) })); setRemoveArm(null); }}>Remove</button>
                    <button type="button" onClick={() => setRemoveArm(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="teacher-daysoff__remove" onClick={() => setRemoveArm(brk.key)}>Remove…</button>
                ))}
              </fieldset>
            );
          })}
          <button type="button" className="teacher-daysoff__add" onClick={() => setDraft((d) => ({ ...d, breaks: [...d.breaks, blankBreak(today)] }))}>Add a break</button>

          <button type="button" className="teacher-daysoff__fold" aria-expanded={showKeep} onClick={() => setShowKeep((v) => !v)}>
            {showKeep ? 'Hide what a day off keeps' : 'What a day off keeps…'}
          </button>
          {showKeep && (
            <div className="teacher-daysoff__keep">
              <p className="teacher-daysoff__help">Applies from today. Days already on the term grid keep their colour.</p>
              {KEEP_TIERS.map((tier) => {
                const keep = effectiveKeep(tier);
                const kept = new Set(keep.map(selectorKey));
                const addable = keepOptions.filter((k) => !kept.has(k));
                return (
                  <div key={tier} className="teacher-daysoff__keeprow">
                    <TierChip tier={tier} />
                    <span className="teacher-daysoff__chips">
                      {keep.length ? keep.map((s) => (
                        <button key={selectorKey(s)} type="button" className="teacher-daysoff__chip"
                          aria-label={`Stop keeping ${selectorLabel(s)} on ${TIER_LABELS[tier]} days`}
                          onClick={() => setKeep(tier, keep.filter((x) => selectorKey(x) !== selectorKey(s)))}>
                          {selectorLabel(s)} <span aria-hidden>×</span>
                        </button>
                      )) : <span className="teacher-daysoff__note">nothing</span>}
                    </span>
                    {addable.length > 0 && (
                      <select aria-label={`Keep on ${TIER_LABELS[tier]} days`} value=""
                        onChange={(e) => e.target.value && setKeep(tier, [...keep, selectorFrom(e.target.value)])}>
                        <option value="">add…</option>
                        {addable.map((k) => <option key={k} value={k}>{k.replace(':', ' · ')}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="teacher-daysoff__actions">
            <button type="button" className="teacher-daysoff__primary" disabled={busy === 'save'} onClick={() => save(draft)}>Save</button>
            <button type="button" onClick={cancel}>Cancel</button>
          </div>
          {(localError || errors.save) && <p className="teacher-panel__error">{localError ?? errors.save}</p>}
        </div>
      )}
    </PanelFrame>
  );
}
