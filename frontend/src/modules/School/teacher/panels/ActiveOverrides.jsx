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
import { labelize } from '../labelize.js';

export default function ActiveOverrides({ kids = [] }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const overrides = usePanelFetch(() => schoolApi.passOverrides(), { panel: 'active-overrides', nullAs: 'empty' });
  const attestations = usePanelFetch(() => schoolApi.attestations(), { panel: 'active-attestations', nullAs: 'empty' });

  const overrideRows = Array.isArray(overrides.data) ? overrides.data : [];
  const attestationRows = attestations.data?.entries ?? [];
  const empty = !overrideRows.length && !attestationRows.length;
  const state = overrides.state === 'loading' || attestations.state === 'loading' ? 'loading'
    : empty ? 'empty' : 'ok';

  return (
    <PanelFrame
      title="Active overrides"
      state={state}
      retry={() => { overrides.retry(); attestations.retry(); }}
      emptyCopy="Nothing is overridden right now — every bar and gate is as authored."
    >
      {overrideRows.length > 0 && (
        <div className="teacher-overrides__group" data-testid="active-pass-overrides">
          <h3>Pass-criteria overrides</h3>
          <ul>
            {overrideRows.map((o) => (
              <li key={o.unitId}>
                <span>{labelize(o.unitId)}</span>
                <span>
                  bar {o.percent}%
                  {o.setBy ? ` · by ${o.setBy}` : ''}
                  {o.at ? ` · since ${String(o.at).slice(0, 10)}` : ''}
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
                <span>{nameFor(a.learnerId)} · {labelize(a.unitId)}</span>
                <span>by {a.attestedBy ?? 'unknown'}{a.at ? ` · ${String(a.at).slice(0, 10)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PanelFrame>
  );
}
