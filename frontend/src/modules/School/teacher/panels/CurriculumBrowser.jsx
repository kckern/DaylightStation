/**
 * CurriculumBrowser — the published catalog, read-only for structure
 * (authoring stays YAML), plus the wave-3 pass-criteria overrides
 * (teacher.passcriteria.edit): each unit shows its EFFECTIVE passing percent
 * (override ?? authored) with a gated set/clear. The override is data with an
 * audit trail; the authored curriculum is never edited here.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';
import { labelize } from '../labelize.js';

function PassOverride({ unit, override, onSaved }) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'pass-override' });
  const [value, setValue] = useState('');
  const effective = override ?? unit.passingPercent;
  const key = unit.unitId;

  const [localError, setLocalError] = useState(null);
  const set = () => {
    const percent = Number.parseInt(value, 10);
    // Garbage must never become a silent CLEAR of a real override.
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      setLocalError('1-100');
      return;
    }
    setLocalError(null);
    run(key, ({ actorId, pin }) => schoolApi.putPassOverride(unit.unitId, {
      percent, editedBy: actorId, pin,
    }), { onSuccess: () => { setValue(''); onSaved(); } });
  };
  const clear = () => run(key, ({ actorId, pin }) => schoolApi.putPassOverride(unit.unitId, {
    percent: null, editedBy: actorId, pin,
  }), { onSuccess: onSaved });

  return (
    <span className="teacher-curriculum__pass">
      <span className="teacher-curriculum__pass-now" data-overridden={override != null ? '' : undefined}>
        pass {effective != null ? `${effective}%` : '—'}
      </span>
      <input
        aria-label={`Pass override for ${unit.unitId}`}
        inputMode="numeric"
        placeholder="%"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="button" disabled={busy === key || !value} onClick={set}>Set</button>
      {override != null && <button type="button" disabled={busy === key} onClick={clear}>Clear</button>}
      {(localError || errors[key]) && <span className="teacher-panel__error">{localError ?? errors[key]}</span>}
    </span>
  );
}

export default function CurriculumBrowser() {
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'curriculum',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const overrides = usePanelFetch(() => schoolApi.passOverrides(), { panel: 'pass-overrides', nullAs: 'empty' });
  const overrideMap = overrides.data?.overrides ?? {};

  const units = catalog.data?.units ?? [];
  const byCourse = new Map();
  const standalone = [];
  for (const unit of units) {
    if (unit.courseId) {
      if (!byCourse.has(unit.courseId)) byCourse.set(unit.courseId, []);
      byCourse.get(unit.courseId).push(unit);
    } else standalone.push(unit);
  }
  for (const list of byCourse.values()) list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const row = (u) => (
    <li key={u.unitId}>
      <details className="teacher-curriculum__unit">
        <summary>
          <span className="teacher-curriculum__unit-title">{u.title}</span>
          {!u.hasBank && <span className="teacher-curriculum__flag">no quiz bank</span>}
          <PassOverride unit={u} override={overrideMap[u.unitId] ?? null} onSaved={overrides.retry} />
        </summary>
        {(u.objectives ?? []).length > 0 && (
          <ul className="teacher-curriculum__objectives">
            {u.objectives.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        )}
        {(u.grades ?? []).length > 0 && (
          <p className="teacher-curriculum__grades">grades: {u.grades.join(', ')}</p>
        )}
      </details>
    </li>
  );

  return (
    <PanelFrame
      title="Curriculum"
      state={catalog.state}
      retry={catalog.retry}
      emptyCopy="No published curriculum yet. Courses are authored as reviewed YAML under data/content/school/ (see docs/reference/school/README.md) — the console reads what's published; it doesn't author."
      unavailableCopy="The curriculum catalog isn't available on this install."
    >
      <div className="teacher-curriculum">
        {[...byCourse.entries()].map(([courseId, list]) => (
          <div key={courseId} className="teacher-curriculum__course">
            <h3>
              {labelize(courseId)}
              <a
                className="teacher-reportcard__pdf"
                href={`/api/v1/school/syllabus?courseId=${encodeURIComponent(courseId)}&format=pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Syllabus
              </a>
            </h3>
            <ol>{list.map(row)}</ol>
          </div>
        ))}
        {standalone.length > 0 && (
          <div className="teacher-curriculum__course">
            <h3>Standalone</h3>
            <ul>{standalone.map(row)}</ul>
          </div>
        )}
      </div>
    </PanelFrame>
  );
}
