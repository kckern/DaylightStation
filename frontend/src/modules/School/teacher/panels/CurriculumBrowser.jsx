/**
 * CurriculumBrowser — the published catalog, read-only: courses with their
 * units in authored sequence, standalone units after. Authoring stays YAML
 * (the promotion boundary); this is the planning view of what exists.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

export default function CurriculumBrowser() {
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'curriculum',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
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

  return (
    <PanelFrame
      title="Curriculum"
      state={catalog.state}
      retry={catalog.retry}
      emptyCopy="No published curriculum yet."
      unavailableCopy="The curriculum catalog isn't available on this install."
    >
      <div className="teacher-curriculum">
        {[...byCourse.entries()].map(([courseId, list]) => (
          <div key={courseId} className="teacher-curriculum__course">
            <h3>{courseId}</h3>
            <ol>
              {list.map((u) => (
                <li key={u.unitId}>
                  <span className="teacher-curriculum__unit-title">{u.title}</span>
                  {!u.hasBank && <span className="teacher-curriculum__flag">no quiz bank</span>}
                </li>
              ))}
            </ol>
          </div>
        ))}
        {standalone.length > 0 && (
          <div className="teacher-curriculum__course">
            <h3>Standalone</h3>
            <ul>
              {standalone.map((u) => (
                <li key={u.unitId}>
                  <span className="teacher-curriculum__unit-title">{u.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PanelFrame>
  );
}
