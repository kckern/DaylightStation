/**
 * TeacherConsole — a route-driven adult operations workspace.
 *
 * The shell keeps household triage and learner context persistent on a desk,
 * while the same information architecture becomes ordinary stacked screens
 * on a phone. Business actions remain in the existing panels and all writes
 * continue through useTeacherWrite/TeacherGate.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProfilePicker from '../../../lib/identity/ProfilePicker.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import PinPrompt from './panels/PinPrompt.jsx';
import { TeacherProfileProvider, useTeacherProfile } from './TeacherProfileContext.jsx';
import { schoolApi } from '../schoolApi.js';
import { teacherLog } from './teacherLog.js';
import {
  parseTeacherPath, teacherLearnerPath, teacherSectionPath, teacherSessionPath,
} from './teacherUrl.js';
import TabErrorBoundary from './TabErrorBoundary.jsx';
import {
  CoursesView, CurriculumView, DashboardView, HistoryView, LearnerOperationsView,
  LearnerOverview, OperationsView, QueueView, ReportsView, SessionInspector,
} from './WorkspaceViews.jsx';
import './Teacher.scss';

// `short` is the phone tab label — a truthful abbreviation of the SAME word,
// never a different one ('Courses' for Curriculum collided with the student
// Courses tab; UX audit F26).
const GLOBAL_NAV = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home' },
  { id: 'queue', label: 'Action queue', short: 'Queue' },
  { id: 'curriculum', label: 'Curriculum', short: 'Curric.' },
  { id: 'operations', label: 'Operations', short: 'Ops' },
];
const LEARNER_NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'courses', label: 'Courses' },
  { id: 'history', label: 'History' },
  { id: 'reports', label: 'Reports' },
  { id: 'operations', label: 'Operations' },
];

function TeacherShell() {
  const {
    status, configured, teachers, currentTeacher, claim, release, authorization,
    pickerOpen, openPicker, closePicker,
  } = useTeacherProfile();
  const initial = useMemo(() => parseTeacherPath(window.location.pathname), []);
  const [route, setRoute] = useState(initial);
  const [kids, setKids] = useState([]);
  const [backlog, setBacklog] = useState(0);
  const [shellWarnings, setShellWarnings] = useState({ roster: false, backlog: false });
  const [railOpen, setRailOpen] = useState(false);

  const navigate = useCallback((path, replace = false) => {
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    const next = parseTeacherPath(path);
    setRoute(next);
    setRailOpen(false);
    teacherLog.nav('workspace', { kind: next.kind, section: next.section, learnerId: next.learnerId, sessionId: next.sessionId });
  }, []);

  useEffect(() => {
    teacherLog.nav('mounted', { kind: initial.kind, section: initial.section, learnerId: initial.learnerId });
    let alive = true;
    schoolApi.roster().then(({ ok, data }) => {
      if (!alive) return;
      if (ok && Array.isArray(data)) {
        setKids(data);
        setShellWarnings((value) => ({ ...value, roster: false }));
      } else {
        setShellWarnings((value) => ({ ...value, roster: true }));
        teacherLog.fetch('roster-failed', { status: ok ? 200 : 'unavailable' });
      }
    });
    return () => { alive = false; };
  }, [initial]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const [review, prints] = await Promise.all([schoolApi.lifecycleReview(), schoolApi.printPending()]);
      if (!alive) return;
      setBacklog((review.ok ? (review.data?.items ?? []).length : 0) + (prints.ok && Array.isArray(prints.data) ? prints.data.length : 0));
      const failed = !review.ok || !prints.ok;
      setShellWarnings((value) => ({ ...value, backlog: failed }));
      if (failed) teacherLog.fetch('backlog-failed', { reviewStatus: review.status, printStatus: prints.status });
    };
    poll();
    const timer = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseTeacherPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const learner = kids.find((kid) => kid.id === route.learnerId) ?? null;
  const goGlobal = (section) => navigate(teacherSectionPath(section, route.base));
  const goLearner = (learnerId, section = 'overview', detail = null) => navigate(teacherLearnerPath(learnerId, section, detail, route.base));
  const goSession = (sessionId) => navigate(teacherSessionPath(route.learnerId, sessionId, route.base));

  if (status !== 'ready') return <div className="teacher-console-page"><div className="teacher-console teacher-console--loading">Loading teacher workspace…</div></div>;

  const noTeachers = !configured || teachers.length === 0;
  let view;
  if (route.kind === 'not-found') {
    view = <section className="teacher-panel"><h2 className="teacher-panel__title">Page not found</h2><p className="teacher-panel__empty">This teacher-workspace address is not a valid route.</p><button type="button" onClick={() => goGlobal('dashboard')}>Return to dashboard</button></section>;
  } else if (route.kind === 'session') {
    view = <SessionInspector learnerId={route.learnerId} sessionId={route.sessionId} kids={kids} onBack={() => route.learnerId ? goLearner(route.learnerId, 'history') : goGlobal('dashboard')} />;
  } else if (route.kind === 'learner' && learner) {
    const views = {
      overview: <LearnerOverview learnerId={learner.id} learnerName={learner.name} onOpenSession={goSession} />,
      courses: <CoursesView learnerId={learner.id} learnerName={learner.name} courseId={route.courseId} kids={kids} />,
      history: <HistoryView learnerId={learner.id} learnerName={learner.name} onOpenSession={goSession} />,
      reports: <ReportsView learnerId={learner.id} kids={kids} />,
      operations: <LearnerOperationsView learnerId={learner.id} learnerName={learner.name} kids={kids} />,
    };
    view = views[route.section] ?? views.overview;
  } else {
    const views = {
      dashboard: <DashboardView kids={kids} onSelectLearner={(id) => goLearner(id)} onOpenQueue={() => goGlobal('queue')} />,
      queue: <QueueView kids={kids} />,
      curriculum: <CurriculumView kids={kids} courseId={route.courseId} lessonId={route.lessonId} />,
      operations: <OperationsView kids={kids} />,
    };
    view = views[route.section] ?? views.dashboard;
  }

  return (
    <div className="teacher-console-page">
      <div className="teacher-console teacher-workspace">
        <header className="teacher-console__header teacher-workspace__topbar">
          <button type="button" className="teacher-workspace__menu" aria-label="Open navigation" aria-expanded={railOpen} onClick={() => setRailOpen((open) => !open)}>☰</button>
          <button type="button" className="teacher-workspace__brand" onClick={() => goGlobal('dashboard')}><span>School</span><strong>Teacher</strong></button>
          <div className="teacher-workspace__context">{learner ? learner.name : GLOBAL_NAV.find((item) => item.id === route.section)?.label ?? 'Session'}</div>
          {noTeachers ? (
            <div className="teacher-console__no-teachers">{configured ? 'Configured teachers do not resolve to the roster.' : 'No teachers configured in school.yml.'}</div>
          ) : (
            <div className="teacher-console__identity">
              <button type="button" className="teacher-console__chip" onClick={openPicker} title={authorization.active ? 'Teacher tools unlocked' : 'Choose teacher'}>
                {currentTeacher ? <><ProfileAvatar id={currentTeacher.id} name={currentTeacher.name} /><span>{currentTeacher.name}</span><i aria-label={authorization.active ? 'Unlocked' : 'Locked'}>{authorization.active ? '●' : '○'}</i></> : <span>Teacher tools</span>}
              </button>
              {currentTeacher && <button type="button" className="teacher-console__lock" onClick={release}>Lock</button>}
            </div>
          )}
        </header>

        <div className="teacher-workspace__layout">
          <aside className={`teacher-workspace__rail${railOpen ? ' is-open' : ''}`} aria-label="Teacher workspace navigation">
            <nav className="teacher-workspace__global" aria-label="Workspace">
              {GLOBAL_NAV.map((item) => (
                <button key={item.id} type="button" aria-current={route.kind === 'section' && route.section === item.id ? 'page' : undefined} onClick={() => goGlobal(item.id)}>
                  <span>{item.label}</span>{item.id === 'queue' && backlog > 0 && <b aria-label={`${backlog} items waiting`}>{backlog}</b>}
                </button>
              ))}
            </nav>
            <div className="teacher-workspace__rail-label">Students</div>
            <nav className="teacher-workspace__students" aria-label="Students">
              {kids.map((kid) => (
                <button key={kid.id} type="button" aria-current={kid.id === route.learnerId ? 'page' : undefined} onClick={() => goLearner(kid.id)}>
                  <ProfileAvatar id={kid.id} name={kid.name} /><span>{kid.name}</span>
                </button>
              ))}
            </nav>
          </aside>
          {railOpen && <button type="button" className="teacher-workspace__scrim" aria-label="Close navigation" onClick={() => setRailOpen(false)} />}

          <div className="teacher-workspace__main">
            {(shellWarnings.roster || shellWarnings.backlog) && (
              <div className="teacher-workspace__alerts" role="status">
                {shellWarnings.roster && <span>Student roster unavailable. Navigation may be incomplete.</span>}
                {shellWarnings.backlog && <span>Action-queue totals unavailable. Open the queue for item-level status.</span>}
              </div>
            )}
            {learner && route.kind !== 'session' && (
              <nav className="teacher-workspace__learner-nav" aria-label={`${learner.name} workspace`}>
                {LEARNER_NAV.map((item) => <button key={item.id} type="button" aria-current={route.section === item.id ? 'page' : undefined} onClick={() => goLearner(learner.id, item.id)}>{item.label}</button>)}
              </nav>
            )}
            <main className="teacher-console__body" id="teacher-main">
              {!learner && route.kind === 'learner' ? (
                <section className="teacher-panel"><h2 className="teacher-panel__title">Student not found</h2><p className="teacher-panel__empty">This bookmark names a learner who is no longer on the roster.</p><button type="button" onClick={() => goGlobal('dashboard')}>Return to dashboard</button></section>
              ) : (
                <TabErrorBoundary tab={route.section} resetKey={`${route.learnerId ?? ''}:${route.sessionId ?? ''}`}>{view}</TabErrorBoundary>
              )}
            </main>
          </div>
        </div>

        <nav className="teacher-workspace__mobile-nav" aria-label="Sections">
          {GLOBAL_NAV.map((item) => <button key={item.id} type="button" aria-label={item.label} aria-current={route.kind === 'section' && route.section === item.id ? 'page' : undefined} onClick={() => goGlobal(item.id)}>{item.short}{item.id === 'queue' && backlog > 0 && <b>{backlog}</b>}</button>)}
        </nav>
        <PinPrompt />
        <ProfilePicker open={pickerOpen} users={teachers} activeId={currentTeacher?.id} onPick={claim} onDismiss={closePicker} timeoutMs={600000} title="Who’s teaching?" />
      </div>
    </div>
  );
}

export default function TeacherConsole() {
  return <TeacherProfileProvider><TeacherShell /></TeacherProfileProvider>;
}
