/**
 * ActiveOverrides — the complete override surface in ONE place (admin
 * advocacy #13): what is overridden right now, by whom, since when. Before
 * this panel, pass-overrides hid inside per-unit collapsed <details> in the
 * CurriculumBrowser and attestations lived on a per-learner Repair panel —
 * "what is overridden" meant expanding every unit for every kid.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { curriculumTitles } from '../curriculumTitles.js';
import { teacherDate } from '../teacherDates.js';

export default function ActiveOverrides({ kids = [] }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const overrides = usePanelFetch(() => schoolApi.passOverrides(), { panel: 'active-overrides', nullAs: 'empty' });
  const attestations = usePanelFetch(() => schoolApi.attestations(), { panel: 'active-attestations', nullAs: 'empty' });
  const bypasses = usePanelFetch(() => schoolApi.programDayBypasses(), { panel: 'active-program-bypasses', nullAs: 'empty', notFoundAs: 'unavailable' });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), { panel: 'active-overrides-catalog', notFoundAs: 'unavailable' });
  const titles = curriculumTitles(catalog.data?.units ?? []);

  // The current API returns `{ overrides: { [unitId]: percent|record } }`.
  // Keep accepting the earlier array projection so mixed-version installs
  // still show their active policy instead of incorrectly claiming "none".
  const overrideRows = Array.isArray(overrides.data)
    ? overrides.data
    : Object.entries(overrides.data?.overrides ?? {}).map(([unitId, value]) => (
      typeof value === 'object' && value !== null ? { unitId, ...value } : { unitId, percent: value }
    ));
  const attestationRows = attestations.data?.entries ?? [];
  const bypassRows = bypasses.data?.active ?? [];
  const empty = !overrideRows.length && !attestationRows.length && !bypassRows.length;
  const state = overrides.state === 'loading' || attestations.state === 'loading' || bypasses.state === 'loading'
    ? 'loading'
    : empty ? 'empty' : 'ok';

  return (
    <PanelFrame
      title="Active overrides"
      state={state}
      retry={() => { overrides.retry(); attestations.retry(); bypasses.retry(); }}
      emptyCopy="Nothing is overridden right now — every bar and gate is as authored."
    >
      {overrideRows.length > 0 && (
        <div className="teacher-overrides__group" data-testid="active-pass-overrides">
          <h3>Pass-criteria overrides</h3>
          <ul>
            {overrideRows.map((o) => (
              <li key={o.unitId}>
                <span>{titles.lesson(o.unitId)}</span>
                <span>
                  bar {o.percent}%
                  {o.setBy ? ` · by ${o.setBy}` : ''}
                  {o.at ? ` · since ${teacherDate(o.at)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {bypassRows.length > 0 && (
        <div className="teacher-overrides__group" data-testid="active-program-bypasses">
          <h3>Today&rsquo;s program bypasses</h3>
          <ul>
            {bypassRows.map((b) => (
              <li key={b.bypassId}>
                <span>{nameFor(b.learnerId)} · {b.programId}</span>
                <span>
                  by {b.decidedBy ?? 'unknown'}
                  {b.decidedAt ? ` · ${teacherDate(b.decidedAt)}` : ''}
                  {b.reason ? ` — ${b.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {attestationRows.length > 0 && (
        <div className="teacher-overrides__group" data-testid="active-attestations">
          <h3>Attested completions</h3>
          <ul>
            {attestationRows.map((a) => (
              <li key={a.id}>
                <span>{nameFor(a.learnerId)} · {titles.lesson(a.unitId)}</span>
                <span>by {a.attestedBy ?? 'unknown'}{a.at ? ` · ${teacherDate(a.at)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PanelFrame>
  );
}
