/**
 * CoinsRosterPanel — Saturday morning at a glance: every learner's week in
 * silver (`GET /api/v1/earnings/preview`). Roster order, never ranked — the
 * economy's no-standing rule; counts side by side are fine. Each row opens
 * that learner's Coins tab for the detail and the rates.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { weekLabel, shiftWeek } from './earningsModel.js';

function greenDays(work) {
  const school = (work?.days ?? []).filter((d) => d.state !== 'exempt');
  return `${school.filter((d) => d.state === 'met').length} of ${school.length}`;
}

function pendingText(pending) {
  const parts = [];
  if (pending?.silver) parts.push(`+${pending.silver} silver`);
  if (pending?.gems) parts.push(`+${pending.gems} gem${pending.gems === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export default function CoinsRosterPanel({ onSelectLearner }) {
  const [week, setWeek] = useState(null);
  const roster = usePanelFetch(() => schoolApi.earningsRoster(week), {
    deps: [week], panel: 'coins-roster', notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.learners ?? []).length,
  });
  const data = roster.data;
  const from = data?.windows?.school?.from ?? null;
  return (
    <PanelFrame title="Coins this week" state={roster.state} retry={roster.retry}
      emptyCopy="No learners on the roster." unavailableCopy="Weekly earnings are not enabled on this install.">
      {data && from && (
        <div className="teacher-coins">
          <div className="teacher-coins__week">
            <button type="button" aria-label="Previous week" onClick={() => setWeek(shiftWeek(from, -1))}>‹</button>
            <span>Week of {weekLabel(data.windows.school)}</span>
            <button type="button" aria-label="Next week" onClick={() => setWeek(shiftWeek(from, 1))}>›</button>
            {week && <button type="button" className="teacher-coins__today" onClick={() => setWeek(null)}>This week</button>}
          </div>
          <table className="teacher-coins__lines" aria-label="Everyone's week">
            <thead><tr><th scope="col">Learner</th><th scope="col">Silver</th><th scope="col">Gems</th><th scope="col">Pending</th><th scope="col">Green days</th><th scope="col">Rings</th><th scope="col"><span className="teacher-visually-hidden">Open</span></th></tr></thead>
            <tbody>
              {data.learners.map((l) => (
                <tr key={l.learnerId}>
                  <th scope="row">{l.learnerName ?? l.learnerId}</th>
                  <td className="teacher-coins__amount">{l.totals.silver}</td>
                  <td>{l.totals.gems || ''}</td>
                  <td className="teacher-coins__pending">{pendingText(l.pending)}</td>
                  <td>{greenDays(l.work)}</td>
                  <td>{Number.isFinite(l.work?.rings) ? l.work.rings : (l.evidence?.rings === 'unavailable' ? '?' : '')}</td>
                  <td>
                    <button type="button" aria-label={`Open ${l.learnerName ?? l.learnerId}’s coins`} onClick={() => onSelectLearner?.(l.learnerId)}>Details</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="teacher-coins__fine">Preview — nothing is paid yet · rules revision {data.rulesRevision}</p>
        </div>
      )}
    </PanelFrame>
  );
}
