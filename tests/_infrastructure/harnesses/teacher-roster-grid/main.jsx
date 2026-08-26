// Teacher roster-grid harness: mounts the REAL RosterStrip inside a replica
// of the teacher workspace's ancestry (workspace layout → rail + main →
// console body → today tab → PanelFrame), with the real compiled SCSS. The
// only substitution is a fetch shim answering the agenda preview with fixture
// sections — everything else (images) is served statically from public/.
import { createRoot } from 'react-dom/client';
import { AGENDA_SECTIONS, KIDS, ROW, STUDY_DAY } from './fixtureData.js';

// The shim must exist before RosterStrip's schoolApi call runs.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/agenda/preview') && url.includes('format=json')) {
    return new Response(JSON.stringify({ sections: AGENDA_SECTIONS }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
};

const { default: RosterStrip } = await import(
  '../../../../frontend/src/modules/School/teacher/panels/RosterStrip.jsx'
);
await import('../../../../frontend/src/modules/School/teacher/Teacher.scss');

createRoot(document.getElementById('root')).render(
  <div className="teacher-console-page">
  <div className="teacher-console teacher-workspace">
    <div className="teacher-workspace__layout">
      <aside className="teacher-workspace__rail" aria-label="Teacher workspace navigation" />
      <div className="teacher-workspace__main">
        <main className="teacher-console__body" id="teacher-main">
          <div className="teacher-view">
            <div className="teacher-tab teacher-tab--today">
              <section className="teacher-panel" data-state="ok">
                <h2 className="teacher-panel__title">Today</h2>
                <RosterStrip rows={[ROW]} kids={KIDS} studyDay={STUDY_DAY} />
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
  </div>,
);
