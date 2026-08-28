/**
 * CurriculumCatalog — the curriculum page's landing state: one card per
 * course, not one row per lesson. Lessons (and per-lesson pass overrides)
 * live on the course drill-in page (`<base>/curriculum/<courseId>`), which
 * kills the tens-of-thousands-of-pixels flat render and its army of
 * identical Set forms (UX audit C10).
 */
import { schoolApi } from '../../schoolApi.js';
import { languageApi } from '../../Programs/SentenceLadder/languageApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import SafeImg from './SafeImg.jsx';
import { teacherBaseFor } from '../teacherUrl.js';
import { passSummary } from './curriculumPassSummary.js';

export default function CurriculumCatalog() {
  const base = teacherBaseFor(globalThis.location?.pathname ?? '');
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'curriculum-catalog',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const overrides = usePanelFetch(() => schoolApi.passOverrides(), { panel: 'pass-overrides', nullAs: 'empty' });
  const languageCourses = usePanelFetch(() => languageApi.courses(), { panel: 'sentence-ladder-preview', nullAs: 'empty' });
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

  return (
    <PanelFrame
      title="Courses"
      state={catalog.state}
      retry={catalog.retry}
      emptyCopy="No published curriculum yet. Courses are authored as reviewed YAML under data/content/school/ (see docs/reference/school/README.md) — the console reads what's published; it doesn't author."
      unavailableCopy="The curriculum catalog isn't available on this install."
    >
      <div className="teacher-course-catalog" data-testid="curriculum-catalog">
        {[...byCourse.entries()].map(([courseId, list]) => (
          <div key={courseId} className="teacher-course-catalog__card">
            <a className="teacher-course-catalog__open" href={`${base}/curriculum/${encodeURIComponent(courseId)}`}>
              <SafeImg src={`/api/v1/school/teacher/curriculum/${encodeURIComponent(courseId)}/poster.jpg`} alt="" fallback="" />
              <strong>{list.find((unit) => unit.courseTitle)?.courseTitle ?? courseId}</strong>
              <span>{list.length} lesson{list.length === 1 ? '' : 's'} · {passSummary(list, overrideMap)}</span>
            </a>
            <a
              className="teacher-reportcard__pdf"
              href={`/api/v1/school/syllabus?courseId=${encodeURIComponent(courseId)}&format=pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Syllabus
            </a>
          </div>
        ))}
        {standalone.length > 0 && (
          <div className="teacher-course-catalog__card teacher-course-catalog__card--standalone">
            <strong>Standalone lessons</strong>
            <span>{standalone.length} lesson{standalone.length === 1 ? '' : 's'} · {passSummary(standalone, overrideMap)}</span>
          </div>
        )}
      </div>
      {languageCourses.state === 'ok' && (languageCourses.data ?? []).length > 0 && (
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
    </PanelFrame>
  );
}
