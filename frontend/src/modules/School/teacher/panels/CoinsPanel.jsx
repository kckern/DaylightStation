/**
 * CoinsPanel — one learner's week in silver (teacher console, Coins tab).
 *
 * A PREVIEW of the economy's weekly earnings (`GET /api/v1/earnings/preview/:id`):
 * the week's work as School recorded it, what each household earn rule makes
 * of it, and inline per-learner rates — a preschooler can earn more for
 * simpler tasks. Rate edits go through the teacher gate
 * (`PUT /school/teacher/economy/earn-rates/:id`) and re-read the preview.
 * Nothing here pays anyone; the bank/exchange comes later.
 */
import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';
import {
  dayLabel, weekLabel, shiftWeek, workGrid, statusText, editableRate, ratePatch,
} from './earningsModel.js';

const CELL_WORDS = {
  met: 'green', partial: 'partly done', none: 'nothing done', exempt: 'no school', unknown: 'can’t tell',
  served: 'done', obligated: 'not done', excused: 'not asked', faulted: 'can’t tell',
};
const CELL_MARKS = { served: '✓', obligated: '✗', excused: '–', faulted: '?', met: '●', partial: '◐', none: '○', exempt: '–', unknown: '?' };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function amountText({ silver = 0, gems = 0 } = {}) {
  const parts = [];
  if (silver) parts.push(`${silver} silver`);
  if (gems) parts.push(plural(gems, 'gem'));
  return parts.length ? parts.join(' + ') : '—';
}

function WorkGrid({ work, from }) {
  const grid = useMemo(() => workGrid(work, from), [work, from]);
  return (
    <table className="teacher-coins__grid" aria-label="The week's work">
      <thead>
        <tr><th scope="col">Subject</th>{grid.days.map((d) => <th key={d} scope="col">{dayLabel(d)}</th>)}</tr>
      </thead>
      <tbody>
        <tr className="teacher-coins__day-row">
          <th scope="row">Whole day</th>
          {grid.dayRow.map((c) => (
            <td key={c.day} data-state={c.state ?? 'empty'} aria-label={c.state ? `Day ${dayLabel(c.day)}: ${CELL_WORDS[c.state] ?? c.state}` : undefined}>
              {c.state ? CELL_MARKS[c.state] ?? '' : ''}
            </td>
          ))}
        </tr>
        {grid.subjects.map((row) => (
          <tr key={row.subject}>
            <th scope="row">{row.subject}</th>
            {row.cells.map((c) => (
              <td key={c.day} data-state={c.state ?? 'empty'} title={c.reason ?? undefined}
                aria-label={c.state ? `${row.subject} ${dayLabel(c.day)}: ${CELL_WORDS[c.state] ?? c.state}` : undefined}>
                {c.state ? CELL_MARKS[c.state] ?? '' : ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {Number.isFinite(work?.rings) && (
        <tfoot><tr><th scope="row">Rings</th><td colSpan={7}>{plural(work.rings, 'ring')} in the ring week (Mon 4am – Sat noon)</td></tr></tfoot>
      )}
    </table>
  );
}

function RateCell({ line, busy, onSave, onReset }) {
  const rate = editableRate(line);
  const [value, setValue] = useState(String(rate.silver));
  useEffect(() => { setValue(String(rate.silver)); }, [rate.silver]);
  const parsed = Number(value);
  const valid = value !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000;
  const changed = valid && parsed !== rate.silver;
  return (
    <div className="teacher-coins__rate">
      <input type="number" min="0" step="1" inputMode="numeric" value={value}
        aria-label={`Silver for ${line.label}`} onChange={(e) => setValue(e.target.value)} />
      <span className="teacher-coins__unit">{rate.unit}</span>
      {changed && (
        <button type="button" disabled={busy} aria-label={`Save rate for ${line.label}`} onClick={() => onSave(line, parsed)}>Save</button>
      )}
      {line.overridden && !changed && (
        <button type="button" className="teacher-coins__reset" disabled={busy} aria-label={`Use household rate for ${line.label}`} onClick={() => onReset(line)}>
          Household rate
        </button>
      )}
    </div>
  );
}

export default function CoinsPanel({ learnerId, learnerName }) {
  const [week, setWeek] = useState(null);
  const preview = usePanelFetch(() => schoolApi.earningsPreview(learnerId, week), {
    deps: [learnerId, week], panel: 'coins', notFoundAs: 'unavailable', isEmpty: () => false,
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'coins' });
  const data = preview.data;
  const from = data?.windows?.school?.from ?? null;
  const name = learnerName ?? learnerId;

  const save = (key, patch) => run(key, ({ actorId, pin }) => schoolApi.putEarnRates(learnerId, { actorId, pin, patch }), { onSuccess: preview.retry });
  const saveRate = (line, silver) => save(`rate:${line.ruleId}`, ratePatch(line, silver));
  const resetRate = (line) => save(`rate:${line.ruleId}`, { rules: { [line.ruleId]: null } });

  const [multiplier, setMultiplier] = useState('');
  useEffect(() => { if (data) setMultiplier(String(data.multiplier ?? 1)); }, [data?.multiplier, data]);
  const m = Number(multiplier);
  const multiplierValid = multiplier !== '' && m > 0 && m <= 10;
  const multiplierChanged = multiplierValid && data && m !== (data.multiplier ?? 1);

  return (
    <PanelFrame title="Coins this week" state={preview.state} retry={preview.retry}
      unavailableCopy="Weekly earnings are not enabled on this install.">
      {data && from && (
        <div className="teacher-coins">
          <div className="teacher-coins__week">
            <button type="button" aria-label="Previous week" onClick={() => setWeek(shiftWeek(from, -1))}>‹</button>
            <span>Week of {weekLabel(data.windows.school)}</span>
            <button type="button" aria-label="Next week" onClick={() => setWeek(shiftWeek(from, 1))}>›</button>
            {week && <button type="button" className="teacher-coins__today" onClick={() => setWeek(null)}>This week</button>}
          </div>

          <div className="teacher-coins__summary">
            <p className="teacher-coins__total"><strong>{data.totals.silver}</strong> silver earned{data.totals.gems ? ` · ${plural(data.totals.gems, 'gem')}` : ''}</p>
            {(data.pending?.silver > 0 || data.pending?.gems > 0) && (
              <p className="teacher-coins__pending">+{amountText(data.pending).replace(' + ', ' and ')} pending</p>
            )}
            <p className="teacher-coins__fine">Preview — nothing is paid yet · rules revision {data.rulesRevision}</p>
            {data.evidence?.school === 'unavailable' && <p className="teacher-panel__error">School records could not be read — school lines show “can’t tell”, not zero.</p>}
            {data.evidence?.rings === 'unavailable' && <p className="teacher-panel__error">Fitness rings could not be read — ring lines show “can’t tell”.</p>}
          </div>

          <WorkGrid work={data.work} from={from} />

          <table className="teacher-coins__lines" aria-label="What it earns">
            <thead><tr><th scope="col">Rule</th><th scope="col">This week</th><th scope="col">Rate for {name}</th><th scope="col">Earns</th></tr></thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.ruleId} data-status={line.status}>
                  <th scope="row">{line.label}</th>
                  <td>
                    <span className={`teacher-coins__status teacher-coins__status--${line.status}`}>{statusText(line.status)}</span>
                    {line.status === 'earned' && line.kind !== 'ring-contest' && line.count > 1 && <span className="teacher-coins__count"> ×{line.count}</span>}
                    {line.note && <span className="teacher-coins__note">{line.note}</span>}
                  </td>
                  <td>
                    <RateCell line={line} busy={busy === `rate:${line.ruleId}`} onSave={saveRate} onReset={resetRate} />
                    {errors[`rate:${line.ruleId}`] && <p className="teacher-panel__error">{errors[`rate:${line.ruleId}`]}</p>}
                  </td>
                  <td className="teacher-coins__amount">{line.status === 'pending' && (line.amount.silver || line.amount.gems) ? `(${amountText(line.amount)})` : amountText(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="teacher-coins__multiplier">
            <label htmlFor={`coins-multiplier-${learnerId}`}>Multiplier for {name}</label>
            <input id={`coins-multiplier-${learnerId}`} type="number" min="0.1" max="10" step="0.1" value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)} />
            <span className="teacher-coins__unit">× every silver rate</span>
            {multiplierChanged && (
              <button type="button" disabled={busy === 'multiplier'} onClick={() => save('multiplier', { multiplier: m })}>Save multiplier</button>
            )}
            {errors.multiplier && <p className="teacher-panel__error">{errors.multiplier}</p>}
          </div>
        </div>
      )}
    </PanelFrame>
  );
}
