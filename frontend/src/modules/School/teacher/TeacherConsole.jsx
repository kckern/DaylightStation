/**
 * TeacherConsole — the grown-up side of School (teacher-console spec §4).
 * Phone-first, browser-only, mounted at /school/teacher (main.jsx route, NOT
 * inside SchoolApp — the kids' shell never parses this URL). Four read-only
 * tabs; the URL carries the whole nav state (/school/teacher/<tab>[/<learner>])
 * so a phone home-screen shortcut deep-links to one child's tab.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProfilePicker from '../../../lib/identity/ProfilePicker.jsx';
import PinPrompt from './panels/PinPrompt.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { TeacherProfileProvider, useTeacherProfile } from './TeacherProfileContext.jsx';
import { schoolApi } from '../schoolApi.js';
import { teacherLog } from './teacherLog.js';
import { TABS, parseTeacherPath, teacherPathFor } from './teacherUrl.js';
import TabErrorBoundary from './TabErrorBoundary.jsx';
import TodayTab from './tabs/TodayTab.jsx';
import PlanningTab from './tabs/PlanningTab.jsx';
import RecordsTab from './tabs/RecordsTab.jsx';
import RepairTab from './tabs/RepairTab.jsx';
import './Teacher.scss';

const TAB_LABELS = { today: 'Today', planning: 'Planning', records: 'Records', repair: 'Repair' };
const TAB_VIEWS = { today: TodayTab, planning: PlanningTab, records: RecordsTab, repair: RepairTab };
// Today reads the whole roster; the other three follow the selected learner.
const LEARNER_SCOPED = new Set(['planning', 'records', 'repair']);

function TeacherShell() {
  const {
    status, configured, teachers, currentTeacher, claim,
    pickerOpen, openPicker, closePicker,
  } = useTeacherProfile();
  const initial = useMemo(() => parseTeacherPath(window.location.pathname), []);
  const [tab, setTab] = useState(initial.tab);
  const [learnerId, setLearnerId] = useState(initial.learnerId);
  const [kids, setKids] = useState([]);
  // Backlog badge (advocacy A1): pending marks + prints, refreshed while the
  // console is open, so the tab bar NOTICES for the teacher.
  const [backlog, setBacklog] = useState(0);

  useEffect(() => {
    teacherLog.nav('mounted', { tab: initial.tab, learnerId: initial.learnerId });
    let alive = true;
    schoolApi.roster().then(({ ok, data }) => {
      if (alive && ok && Array.isArray(data)) setKids(data);
    });
    return () => { alive = false; };
  }, [initial]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const [review, prints] = await Promise.all([schoolApi.lifecycleReview(), schoolApi.printPending()]);
      if (!alive) return;
      const reviewCount = review.ok ? (review.data?.items ?? []).length : 0;
      const printCount = prints.ok && Array.isArray(prints.data) ? prints.data.length : 0;
      setBacklog(reviewCount + printCount);
    };
    poll();
    const timer = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Browser back/forward re-parse the URL — address bar and shell never disagree.
  useEffect(() => {
    const onPop = () => {
      const link = parseTeacherPath(window.location.pathname);
      setTab(link.tab);
      setLearnerId(link.learnerId);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const sync = useCallback((nextTab, nextLearner) => {
    const path = teacherPathFor(nextTab, nextLearner);
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
  }, []);

  const openTab = useCallback((next) => {
    setTab(next);
    sync(next, learnerId);
    teacherLog.nav('tab', { tab: next });
  }, [learnerId, sync]);

  const pickLearner = useCallback((id) => {
    const next = learnerId === id ? null : id;
    setLearnerId(next);
    sync(tab, next);
    teacherLog.nav('learner', { learnerId: next });
  }, [learnerId, tab, sync]);

  if (status !== 'ready') return <div className="teacher-console teacher-console--loading">Loading…</div>;

  const noTeachers = !configured || teachers.length === 0;
  const View = TAB_VIEWS[tab];
  return (
    <div className="teacher-console">
      <header className="teacher-console__header">
        <h1 className="teacher-console__title">Teacher</h1>
        {noTeachers ? (
          <div className="teacher-console__no-teachers">
            {configured
              ? 'No listed teacher resolves to a grown-up on the roster — check the teachers list in school.yml.'
              : 'No teachers configured — add a teachers: list to school.yml.'}
          </div>
        ) : (
          <button type="button" className="teacher-console__chip" onClick={openPicker}>
            {currentTeacher
              ? (<><ProfileAvatar id={currentTeacher.id} name={currentTeacher.name} /><span>{currentTeacher.name}</span></>)
              : <span>Sign in</span>}
          </button>
        )}
      </header>
      {LEARNER_SCOPED.has(tab) && (
        <div className="teacher-console__learners" role="tablist" aria-label="Learner">
          {kids.map((kid) => (
            <button
              key={kid.id}
              type="button"
              className={`teacher-console__learner${kid.id === learnerId ? ' teacher-console__learner--active' : ''}`}
              onClick={() => pickLearner(kid.id)}
            >
              <ProfileAvatar id={kid.id} name={kid.name} />
              <span>{kid.name}</span>
            </button>
          ))}
        </div>
      )}
      <main className="teacher-console__body">
        <TabErrorBoundary tab={tab} resetKey={learnerId ?? ''}>
          <View learnerId={learnerId} kids={kids} />
        </TabErrorBoundary>
      </main>
      <nav className="teacher-console__tabs" aria-label="Sections">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`teacher-console__tab${id === tab ? ' teacher-console__tab--active' : ''}`}
            aria-current={id === tab ? 'page' : undefined}
            onClick={() => openTab(id)}
          >
            {TAB_LABELS[id]}
            {id === 'today' && backlog > 0 && (
              <span className="teacher-console__badge" aria-label={`${backlog} items waiting`}>{backlog}</span>
            )}
          </button>
        ))}
      </nav>
      <PinPrompt />
      <ProfilePicker
        open={pickerOpen}
        users={teachers}
        activeId={currentTeacher?.id}
        onPick={claim}
        onDismiss={closePicker}
        timeoutMs={600000}
        title="Who's teaching?"
      />
    </div>
  );
}

export default function TeacherConsole() {
  return (
    <TeacherProfileProvider>
      <TeacherShell />
    </TeacherProfileProvider>
  );
}
