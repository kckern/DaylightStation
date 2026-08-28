/**
 * SystemHealthPanel — the surface for two teacher read models that had no UI
 * at all (School Operations, plan item 4.4): which quiz banks failed to
 * parse at the last warm, and which report-card freezes a supersede-close
 * archived rather than destroyed. `docs/reference/school/teacher.md` §11
 * says a supersede "preserves the old record, never destroys it" — a claim
 * that was true and unverifiable from the console until this panel, since
 * the archived `{periodId}.v<n>.yml` copies had a read (`GET
 * /report-card/frozen/versions`) but nowhere that called it.
 *
 * Read-only, deliberately: the tools that FIX a malformed bank (re-author
 * the source file) or an unwanted freeze (a fresh supersede-close) already
 * have their own homes. This panel only says what is true.
 *
 * Two independent `PanelFrame`s, not one combined state the way
 * `ActiveOverrides` folds its two reads together: bank health and
 * report-card versions have nothing to do with each other, and one read
 * failing must never blank the other section's answer (spec §4.3, "panels
 * fail alone" — applied here at section granularity within one panel).
 *
 * `GET /report-card/frozen/versions` is learner+period scoped AT THE ROUTE —
 * it 400s without both query params, and there is no bulk "every superseded
 * freeze in the household" read to compose instead. So this section carries
 * its own learner + period selector rather than pretending to enumerate
 * something the API cannot answer — which makes it a spot-check tool for one
 * learner+period at a time, not a glanceable household-wide indicator like
 * the bank list above it.
 *
 * The selector lives OUTSIDE the `PanelFrame` it drives, same reasoning as
 * the `FrozenHistory` link added alongside this panel: it CHOOSES what to
 * fetch, so it cannot sit inside the thing that unmounts to a loading
 * skeleton on every choice (`PanelFrame`'s `alwaysRender` excludes
 * `'loading'` from rendering children). And the versions list itself is
 * gated on `versions.state === 'ok'`, not just "a period is picked" — a
 * failed read must never render the reassuring "all clear" sentence next to
 * its own error banner, which is exactly the contradiction this panel exists
 * to avoid.
 *
 * A healthy read renders a REASSURING sentence, not a blank card — the
 * opposite of the dashboard's backlog strip, which renders nothing at zero.
 * A backlog shouts when there is work; a health panel reassures when there
 * is none, because "no malformed banks" is itself information a teacher
 * wants confirmed, not absence of information.
 */
import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import PeriodSelect from './PeriodSelect.jsx';
import { currentPeriodId } from './currentPeriodId.js';
import { teacherDate, humanDateTime } from '../teacherDates.js';

const IconCheck = () => (
  <svg viewBox="0 0 16 16" className="teacher-health__check" aria-hidden="true" focusable="false">
    <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function SystemHealthPanel({ kids = [] }) {
  // --- Section 1: quiz bank health --------------------------------------
  const banks = usePanelFetch(() => schoolApi.bankHealth(), { panel: 'system-health-banks' });
  const failedBanks = banks.data?.failed ?? [];

  // --- Section 2: superseded report-card versions ------------------------
  const periods = usePanelFetch(() => schoolApi.periods(), { panel: 'system-health-periods' });
  const periodList = useMemo(() => (Array.isArray(periods.data) ? periods.data : []), [periods.data]);
  const [learnerId, setLearnerId] = useState(kids[0]?.id ?? null);
  const [periodId, setPeriodId] = useState(null);
  // Kids/periods often arrive after this component mounts (they're fetched
  // by the workspace shell / this panel's own read) — pick a default the
  // moment each becomes available, rather than only on first mount.
  useEffect(() => { if (!learnerId && kids.length) setLearnerId(kids[0].id); }, [kids, learnerId]);
  useEffect(() => {
    if (!periodId && periodList.length) setPeriodId(currentPeriodId(periodList));
  }, [periodId, periodList]);

  // No learner/period selected yet resolves to an empty list rather than
  // skipping the fetch conditionally — usePanelFetch's hook order must stay
  // fixed regardless of selection state.
  // `{versions: [...]}` always has the `versions` key, even when the array
  // is empty — never treated as usePanelFetch's 'empty' state (that would
  // route an empty read through PanelFrame's generic empty copy instead of
  // the reassuring sentence below, exactly the bug this shape avoids for
  // bank health too).
  const versions = usePanelFetch(
    () => (learnerId && periodId
      ? schoolApi.reportCardFrozenVersions({ learnerId, periodId })
      : Promise.resolve({ ok: true, status: 200, data: { versions: [] } })),
    { deps: [learnerId, periodId], panel: 'system-health-versions' },
  );
  const versionRows = versions.data?.versions ?? [];
  const learnerName = kids.find((k) => k.id === learnerId)?.name ?? learnerId;
  // Never fall all the way back to the raw periodId when a label exists
  // somewhere — the selector's own list first, else the generic noun.
  const periodLabel = periodList.find((p) => p.periodId === periodId)?.label ?? 'Academic period';

  return (
    <>
      <PanelFrame
        title="Quiz bank health"
        state={banks.state}
        retry={banks.retry}
        alwaysRender
        unavailableCopy="Bank health is not available on this install."
      >
        {banks.state === 'ok' && (
          failedBanks.length ? (
            <ul className="teacher-health__list" data-testid="system-health-malformed-banks">
              {failedBanks.map((bankId) => <li key={bankId}><code>{bankId}</code></li>)}
            </ul>
          ) : (
            <p className="teacher-health__ok" data-testid="system-health-banks-ok">
              <IconCheck />
              {' '}No malformed banks — {banks.data.banks} warmed cleanly
              {banks.data.warmedAt ? ` as of ${humanDateTime(banks.data.warmedAt)}` : ''}.
            </p>
          )
        )}
      </PanelFrame>

      <div className="teacher-health__versions">
        <p className="teacher-health__hint">
          Pick a learner and period to check for preserved (superseded) freezes — a spot check, not a household-wide list.
        </p>
        {!kids.length ? (
          <p className="teacher-panel__empty">No learners configured.</p>
        ) : (
          <div className="teacher-health__selectors">
            <select aria-label="Learner" value={learnerId ?? ''} onChange={(e) => setLearnerId(e.target.value)}>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            {periods.state === 'error' ? (
              <span className="teacher-panel__error">
                Couldn&rsquo;t load periods.
                <button type="button" className="teacher-panel__retry" onClick={periods.retry}>Retry</button>
              </span>
            ) : (
              <PeriodSelect periods={periodList} value={periodId} onChange={setPeriodId} />
            )}
          </div>
        )}
        {periods.state !== 'loading' && periods.state !== 'error' && kids.length > 0 && !periodList.length && (
          <p className="teacher-panel__empty">No academic periods configured — versions are period-scoped.</p>
        )}
        <PanelFrame
          title="Superseded report-card versions"
          state={versions.state}
          retry={versions.retry}
          alwaysRender
          unavailableCopy="Report-card versions are not available on this install."
        >
          {/* Gated on the READ's own state, not merely "a period is picked" —
              an error banner and a reassuring "all clear" must never render
              side by side (the exact contradiction this panel exists to
              prevent). */}
          {versions.state === 'ok' && periodId && (
            versionRows.length ? (
              <ul className="teacher-health__list" data-testid="system-health-frozen-versions">
                {versionRows.map(({ version, record }) => (
                  <li key={version}>
                    <span>{record?.period?.label ?? periodLabel} · v{version}</span>
                    <span>
                      Closed by {record?.closedBy ?? 'unknown'}
                      {record?.closedAt ? ` · ${teacherDate(record.closedAt)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="teacher-health__ok" data-testid="system-health-versions-ok">
                <IconCheck />
                {' '}No superseded versions for {learnerName} · {periodLabel}.
              </p>
            )
          )}
        </PanelFrame>
      </div>
    </>
  );
}
