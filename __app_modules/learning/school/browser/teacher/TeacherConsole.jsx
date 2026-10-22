/**
 * TeacherConsole — a route-driven adult operations workspace.
 *
 * The shell keeps household triage and learner context persistent on a desk,
 * while the same information architecture becomes ordinary stacked screens
 * on a phone. Business actions remain in the existing panels and all writes
 * continue through useTeacherWrite/TeacherGate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ProfilePicker from "../../../../../frontend/src/lib/identity/ProfilePicker.jsx";
import ProfileAvatar from "../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import PinPrompt from "./panels/PinPrompt.jsx";
import LogBookSheet from "./panels/LogBookSheet.jsx";
import { TeacherProfileProvider, useTeacherProfile } from "./TeacherProfileContext.jsx";
import { schoolApi } from "../schoolApi.js";
import { teacherLog } from "./teacherLog.js";
import { useBacklog } from "./useBacklog.js";
import {
  consoleLinkTarget, parseTeacherPath, teacherDayPath, teacherLearnerPath, teacherSectionPath, teacherSessionPath,
} from "./teacherUrl.js";
import { humanDate, localDay } from "./teacherDates.js";
import TabErrorBoundary from "./TabErrorBoundary.jsx";
import {
  CoursesView, CurriculumView, DashboardView, HistoryView, LearnerDayScreen, LearnerOperationsView,
  OperationsView, QueueView, ReadingView, ReportsView, SessionInspector, WordsView, DebriefsView, CoinsView, CoinsRosterView,
} from "./WorkspaceViews.jsx";
import "./Teacher.scss";

// `short` is the phone tab label — a truthful abbreviation of the SAME word,
// never a different one ('Courses' for Curriculum collided with the student
// Courses tab; UX audit F26).
const GLOBAL_NAV = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home' },
  { id: 'queue', label: 'Action queue', short: 'Queue' },
  { id: 'curriculum', label: 'Curriculum', short: 'Curric.' },
  { id: 'coins', label: 'Coins', short: 'Coins' },
  { id: 'operations', label: 'Operations', short: 'Ops' },
];
/** The phone layout's breakpoint (`Teacher.scss`): the rail becomes a drawer. */
const PHONE_QUERY = '(max-width: 760px)';
const LEARNER_NAV = [
  { id: 'day', label: 'Day' },
  { id: 'courses', label: 'Courses' },
  { id: 'history', label: 'History' },
  { id: 'reading', label: 'Reading' },
  { id: 'words', label: 'Cards' }, // id kept: console links name the tab `words`
  { id: 'debriefs', label: 'Debriefs' },
  { id: 'coins', label: 'Coins' },
  { id: 'reports', label: 'Reports' },
  { id: 'operations', label: 'Operations' },
];

function TeacherShell({ PianoProgramsPanel }) {
  const {
    status, configured, teachers, currentTeacher, claim, release, authorization,
    pickerOpen, openPicker, closePicker,
  } = useTeacherProfile();
  const initial = useMemo(() => parseTeacherPath(window.location.pathname), []);
  const [route, setRoute] = useState(initial);
  const [kids, setKids] = useState([]);
  // One count for the rail badge, the phone tab bar and the dashboard strip;
  // the queue's panels call `backlog.refresh` when the teacher acts.
  const backlog = useBacklog();
  const [shellWarnings, setShellWarnings] = useState({ roster: false });
  const [railOpen, setRailOpen] = useState(false);
  const [logBookOpen, setLogBookOpen] = useState(false);
  // Where focus goes when "Log a book" closes: the control that opened it,
  // or, from the phone rail (closed off-screen by then), the menu button.
  const logBookOpenerRef = useRef(null);
  const menuRef = useRef(null);
  // An action, not a section: it opens over whatever page is showing. The
  // phone rail (and its scrim) sit above the sheet, so it closes first.
  const openLogBook = (event) => {
    const fromRail = event.currentTarget.dataset.from === 'rail';
    const phone = typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
    logBookOpenerRef.current = fromRail && phone && menuRef.current ? menuRef.current : event.currentTarget;
    setRailOpen(false);
    setLogBookOpen(true);
    teacherLog.nav('log-book', { from: event.currentTarget.dataset.from });
  };

  const navigate = useCallback((path, replace = false) => {
    const before = { pathname: window.location.pathname, search: window.location.search };
    if (`${before.pathname}${before.search}${window.location.hash}` !== path) window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    const target = new URL(path, window.location.origin);
    // Same page, different query (`?reading=`, `?open=`): the route below does
    // not change, so nothing re-renders. Views that keep query state already
    // resync on popstate, so tell them. The shell's own popstate listener
    // re-parses the same pathname and sets an equivalent route — harmless.
    if (target.pathname === before.pathname && target.search !== before.search) {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    const next = parseTeacherPath(target.pathname);
    setRoute(next);
    setRailOpen(false);
    // A new page starts at its top; a replace (a canonicalized URL) does not move.
    if (!replace) { try { window.scrollTo(0, 0); } catch { /* jsdom */ } }
    teacherLog.nav('workspace', { kind: next.kind, section: next.section, learnerId: next.learnerId, sessionId: next.sessionId });
  }, []);

  // One delegated handler for every console link (see `consoleLinkTarget`).
  const onLinkClick = useCallback((event) => {
    const path = consoleLinkTarget(event);
    if (!path) return;
    event.preventDefault();
    navigate(path);
  }, [navigate]);

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
    const onPop = () => setRoute(parseTeacherPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    // `/students/:id/overview` is a retired alias of the Day record (trim
    // 5.6) — canonicalize the bookmark to the bare learner path (the Day
    // record) instead of rendering a second view at the old URL.
    if (route.kind === 'learner' && route.section === 'overview' && route.learnerId) {
      navigate(`${route.base}/students/${encodeURIComponent(route.learnerId)}`, true);
    }
  }, [route, navigate]);

  const learner = kids.find((kid) => kid.id === route.learnerId) ?? null;
  const goGlobal = (section) => navigate(teacherSectionPath(section, route.base));
  const goLearner = (learnerId, section = 'day', detail = null) => navigate(teacherLearnerPath(learnerId, section, detail, route.base));
  const goSession = (sessionId, origin = {}) => navigate(teacherSessionPath(route.learnerId, sessionId, route.base, origin));
  const studyDay = route.studyDay ?? localDay();
  const goDay = (nextDay) => navigate(teacherDayPath(route.learnerId, nextDay, route.base));

  if (status !== 'ready') return <div className="teacher-console-page"><div className="teacher-console teacher-console--loading">Loading teacher workspace…</div></div>;

  const noTeachers = !configured || teachers.length === 0;
  let view;
  if (route.kind === 'not-found') {
    view = <section className="teacher-panel"><h2 className="teacher-panel__title">Page not found</h2><p className="teacher-panel__empty">This teacher-workspace address is not a valid route.</p><button type="button" onClick={() => goGlobal('dashboard')}>Return to dashboard</button></section>;
  } else if (route.kind === 'session') {
    // Back returns to the view that opened the session (?from=today → the
    // dashboard digest), not always History. The dashboard return carries the
    // learner as `?open=`, so the roster card the lesson came from is open again.
    const origin = new URLSearchParams(window.location.search);
    const from = origin.get('from');
    const originDay = origin.get('studyDay');
    const dashboardBack = () => navigate(`${teacherSectionPath('dashboard', route.base)}${route.learnerId ? `?open=${encodeURIComponent(route.learnerId)}` : ''}`);
    // Where Back goes, by the view that opened the session (`?from=`).
    const ORIGINS = {
      day: /^\d{4}-\d{2}-\d{2}$/.test(originDay ?? '') ? [`Back to ${humanDate(originDay)}`, () => goDay(originDay)] : null,
      today: ['Back to dashboard', dashboardBack],
      queue: ['Back to action queue', () => goGlobal('queue')],
      operations: ['Back to operations', () => goGlobal('operations')],
    };
    // Own keys only: `?from=constructor` must not reach Object.prototype.
    const [backLabel, onBack] = (Object.hasOwn(ORIGINS, from ?? '') ? ORIGINS[from] : null)
      ?? (route.learnerId ? ['Back to history', () => goLearner(route.learnerId, 'history')] : ['Back to dashboard', dashboardBack]);
    view = <SessionInspector learnerId={route.learnerId} sessionId={route.sessionId} kids={kids}
      backLabel={backLabel} onBack={onBack} />;
  } else if (route.kind === 'learner' && learner) {
    const views = {
      day: <LearnerDayScreen learnerId={learner.id} learnerName={learner.name} studyDay={studyDay}
        onChangeStudyDay={goDay} onOpenSession={(sessionId) => goSession(sessionId, { from: 'day', studyDay })} />,
      courses: <CoursesView learnerId={learner.id} learnerName={learner.name} courseId={route.courseId} kids={kids} PianoProgramsPanel={PianoProgramsPanel} />,
      history: <HistoryView learnerId={learner.id} learnerName={learner.name}
        onOpenSession={(sessionId) => goSession(sessionId, { from: 'history' })} />,
      reading: <ReadingView learnerId={learner.id} learnerName={learner.name} kids={kids} />,
      words: <WordsView learnerId={learner.id} learnerName={learner.name} />,
      debriefs: <DebriefsView learnerId={learner.id} learnerName={learner.name} />,
      coins: <CoinsView learnerId={learner.id} learnerName={learner.name} />,
      reports: <ReportsView learnerId={learner.id} kids={kids} />,
      // Keyed by the query: a different `?reason/unit/day` is a different
      // repair context, and the panels below seed from it only on mount.
      operations: <LearnerOperationsView key={`${learner.id}${window.location.search}`} learnerId={learner.id} learnerName={learner.name} kids={kids} />,
    };
    view = views[route.section] ?? views.day;
  } else {
    const views = {
      dashboard: <DashboardView kids={kids} onSelectLearner={(id) => goLearner(id)} backlog={backlog} onOpenQueue={() => goGlobal('queue')} />,
      queue: <QueueView kids={kids} onChanged={backlog.refresh} />,
      curriculum: <CurriculumView kids={kids} courseId={route.courseId} lessonId={route.lessonId} />,
      coins: <CoinsRosterView onSelectLearner={(id) => goLearner(id, 'coins')} />,
      operations: <OperationsView key={window.location.search} kids={kids} />,
    };
    view = views[route.section] ?? views.dashboard;
  }

  return (
    /* Grown-up admin: dates, bank ids, reasons. Never Hangul. */
    <div className="teacher-console-page" data-ime="off" onClick={onLinkClick}>
      <div className="teacher-console teacher-workspace">
        <header className="teacher-console__header teacher-workspace__topbar">
          <button type="button" ref={menuRef} className="teacher-workspace__menu" aria-label="Open navigation" aria-expanded={railOpen} onClick={() => setRailOpen((open) => !open)}>☰</button>
          <button type="button" className="teacher-workspace__brand" onClick={() => goGlobal('dashboard')}><span>School</span><strong>Teacher</strong></button>
          <div className="teacher-workspace__context" title={learner ? learner.name : GLOBAL_NAV.find((item) => item.id === route.section)?.label ?? 'Session'}>{learner ? learner.name : GLOBAL_NAV.find((item) => item.id === route.section)?.label ?? 'Session'}</div>
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
                  <span>{item.label}</span>{item.id === 'queue' && backlog.total > 0 && <b aria-label={`${backlog.total} items waiting`}>{backlog.total}</b>}
                </button>
              ))}
              <button type="button" className="teacher-workspace__log-book" data-from="rail" onClick={openLogBook}>
                <span>Log a book</span>
              </button>
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
            {(shellWarnings.roster || backlog.failed) && (
              <div className="teacher-workspace__alerts" role="status">
                {shellWarnings.roster && <span>Student roster unavailable. Navigation may be incomplete.</span>}
                {backlog.failed && <span>Action-queue totals unavailable. Open the queue for item-level status.</span>}
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
          {GLOBAL_NAV.map((item) => <button key={item.id} type="button" aria-label={item.label} aria-current={route.kind === 'section' && route.section === item.id ? 'page' : undefined} onClick={() => goGlobal(item.id)}>{item.short}{item.id === 'queue' && backlog.total > 0 && <b>{backlog.total}</b>}</button>)}
          <button type="button" data-from="tab-bar" onClick={openLogBook}>Log book</button>
        </nav>
        <LogBookSheet open={logBookOpen} onClose={() => setLogBookOpen(false)} returnFocusRef={logBookOpenerRef} />
        <PinPrompt />
        <ProfilePicker open={pickerOpen} users={teachers} activeId={currentTeacher?.id} onPick={claim} onDismiss={closePicker} timeoutMs={600000} title="Who’s teaching?" />
      </div>
    </div>
  );
}

export default function TeacherConsole({ PianoProgramsPanel } = {}) {
  return <TeacherProfileProvider><TeacherShell PianoProgramsPanel={PianoProgramsPanel} /></TeacherProfileProvider>;
}
