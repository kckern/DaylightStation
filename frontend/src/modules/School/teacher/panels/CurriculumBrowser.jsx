/**
 * CurriculumBrowser — the published catalog, read-only for structure
 * (authoring stays YAML), plus the wave-3 pass-criteria overrides
 * (teacher.passcriteria.edit): each unit shows its EFFECTIVE passing percent
 * (override ?? authored) with a gated set/clear. The override is data with an
 * audit trail; the authored curriculum is never edited here.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { languageApi } from '../../Programs/SentenceLadder/languageApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';
import { teacherBaseFor } from '../teacherUrl.js';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import { LessonIdentity } from '../CurriculumIdentity.jsx';

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

/**
 * Course-level pass bar: one input, applied to every lesson via the existing
 * per-unit override store (which stays the SSOT — this is a bulk write, not a
 * new concept), behind the module's arm→confirm.
 */
function CourseBulkPassBar({ courseId, units, onSaved }) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'pass-override-bulk' });
  const [value, setValue] = useState('');
  const [armed, setArmed] = useState(false);
  const key = `bulk:${courseId}`;
  const percent = Number.parseInt(value, 10);
  const valid = Number.isInteger(percent) && percent >= 1 && percent <= 100;
  const apply = () => run(key, async ({ actorId, pin }) => {
    let last = { ok: true, status: 200, data: {} };
    for (const unit of units) {
      // Sequential on purpose: override writes share one store file.
       
      last = await schoolApi.putPassOverride(unit.unitId, { percent, editedBy: actorId, pin });
      if (!last.ok) return last;
    }
    return last;
  }, { onSuccess: () => { setArmed(false); setValue(''); onSaved(); } });
  return (
    <div className="teacher-action-row teacher-curriculum__bulk-pass">
      <label>Course pass bar
        <input aria-label={`Course pass bar for ${courseId}`} inputMode="numeric" placeholder="%" value={value} onChange={(event) => { setValue(event.target.value); setArmed(false); }} />
      </label>
      {!armed
        ? <button type="button" disabled={!valid || busy === key} onClick={() => setArmed(true)}>Set all {units.length} lessons</button>
        : <span className="teacher-close-period__confirm">
          <span>Set the pass bar to {percent}% on all {units.length} lessons?</span>
          <button type="button" disabled={busy === key} onClick={apply}>Confirm</button>
          <button type="button" onClick={() => setArmed(false)}>Cancel</button>
        </span>}
      {errors[key] && <span className="teacher-panel__error">{errors[key]}</span>}
    </div>
  );
}

export default function CurriculumBrowser({ courseId = null }) {
  const base = teacherBaseFor(globalThis.location?.pathname ?? '');
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'curriculum',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const overrides = usePanelFetch(() => schoolApi.passOverrides(), { panel: 'pass-overrides', nullAs: 'empty' });
  const languageCourses = usePanelFetch(() => languageApi.courses(), { panel: 'sentence-ladder-preview', nullAs: 'empty' });
  const overrideMap = overrides.data?.overrides ?? {};

  const allUnits = catalog.data?.units ?? [];
  // Scoped to ONE course when a courseId is given (the drill-in page). The
  // all-courses flat render is retired — the catalog page owns discovery.
  const units = courseId ? allUnits.filter((unit) => unit.courseId === courseId) : allUnits;
  const byCourse = new Map();
  const standalone = [];
  for (const unit of units) {
    if (unit.courseId) {
      if (!byCourse.has(unit.courseId)) byCourse.set(unit.courseId, []);
      byCourse.get(unit.courseId).push(unit);
    } else standalone.push(unit);
  }
  for (const list of byCourse.values()) list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  // Two-line cell (design audit #6): line 1 = title (+ a quiet no-bank dot),
  // line 2 = a right-aligned control cluster that NEVER wraps internally —
  // the old inline chip + input + Set shattered into three ragged lines at
  // phone width, nine times per course.
  const row = (u) => (
    <li key={u.unitId}>
      <details className="teacher-curriculum__unit">
        <summary>
          <span className="teacher-curriculum__unit-line1">
            <span className="teacher-curriculum__unit-title">
              {!u.hasBank && <span className="teacher-curriculum__nobank-dot" title="No quiz bank yet" aria-label="No quiz bank yet" />}
              <LessonIdentity
                compact
                subject={u.subject}
                courseTitle={u.courseTitle}
                moduleTitle={u.moduleTitle}
                lessonTitle={u.title}
                posterUrl={u.courseId ? `/api/v1/school/teacher/curriculum/${encodeURIComponent(u.courseId)}/poster.jpg` : null}
              />
            </span>
          </span>
          <span className="teacher-curriculum__unit-line2">
            <PassOverride unit={u} override={overrideMap[u.unitId] ?? null} onSaved={overrides.retry} />
          </span>
        </summary>
        {!u.hasBank && (
          <p className="teacher-curriculum__grades">No quiz bank is bound to this unit yet — the gate waits until one is authored.</p>
        )}
        {(u.objectives ?? []).length > 0 && (
          <ul className="teacher-curriculum__objectives">
            {u.objectives.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        )}
        {(u.grades ?? []).length > 0 && (
          <p className="teacher-curriculum__grades">grades: {u.grades.join(', ')}</p>
        )}
        {u.hasDocument && u.courseId && (
          <a className="teacher-curriculum__preview" href={teacherWorkspaceApi.lessonPreviewUrl(u.courseId, u.unitId)} target="_blank" rel="noreferrer">
            Preview worksheet
          </a>
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
        {[...byCourse.entries()].map(([id, list]) => (
          <div key={id} className="teacher-curriculum__course">
            <h3>
              <a href={`${base}/curriculum/${encodeURIComponent(id)}`}>{list.find((unit) => unit.courseTitle)?.courseTitle ?? 'Course'}</a>
              <a
                className="teacher-reportcard__pdf"
                href={`/api/v1/school/syllabus?courseId=${encodeURIComponent(id)}&format=pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Syllabus
              </a>
            </h3>
            <CourseBulkPassBar courseId={id} units={list} onSaved={overrides.retry} />
            <ol>{list.map(row)}</ol>
          </div>
        ))}
        {standalone.length > 0 && (
          <div className="teacher-curriculum__course">
            <h3>Standalone</h3>
            <ul>{standalone.map(row)}</ul>
          </div>
        )}
        {languageCourses.state === 'ready' && (languageCourses.data ?? []).length > 0 && (
          <section className="teacher-curriculum__sandbox" aria-label="Guest previews">
            <h3>Try as guest</h3>
            <p>Open a Sentence Ladder lesson without a learner, history, or saved work.</p>
            <ul>
              {languageCourses.data.map((course) => (
                <li key={course.id}>
                  <a className="teacher-curriculum__preview" href={`/school/sentence-ladder-preview/${encodeURIComponent(course.id)}`} target="_blank" rel="noreferrer">
                    Try {course.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PanelFrame>
  );
}
