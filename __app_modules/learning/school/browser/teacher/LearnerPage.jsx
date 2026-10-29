/**
 * LearnerPage — one child, one page (owner ruling 2026-10-29: "one rich page,
 * not ten tabs").
 *
 * The day is the page's spine and is always shown: the week strip, the day
 * stepper and the day's lessons. Everything else a parent might want about
 * this child is a fold below it, in the order a parent reaches for them.
 *
 * A fold mounts its view only once it has been opened, so the page costs the
 * day's reads and nothing more until a parent asks. The old tab URLs
 * (`/students/:id/reading`, `/students/:id/words`, …) still land: they open
 * that fold and scroll to it.
 *
 * WHICH FOLD IS OPEN RIDES IN THE QUERY (`?fold=`), NEVER THE PATH. The path
 * is the day being read (`/students/:id/day/2026-10-27`); writing the fold
 * into it threw a past day back to today, and dropping the query wiped a
 * fold's own state — the Fix fold's preselected repair, an open reading.
 * Opening a fold rewrites only `fold`, with `replace`, so Back still leaves
 * the child and every other query value survives.
 */
import { useEffect, useRef, useState } from 'react';
import { teacherLog } from "./teacherLog.js";
import TabErrorBoundary from "./TabErrorBoundary.jsx";
import {
  CoinsView, CoursesView, DebriefsView, HistoryView, LearnerDayScreen, LearnerOperationsView,
  ReadingView, ReportsView, SentencesView, WordsView,
} from "./WorkspaceViews.jsx";

/**
 * The folds, in reading order. `id` is the old tab's URL segment, kept so
 * every console link and bookmark that names a section still opens it.
 */
export const LEARNER_FOLDS = [
  { id: 'reading', label: 'Reading', hint: 'Shelf, this week’s reading, add or log a book' },
  { id: 'words', label: 'Cards', hint: 'Card ladder day by day, missed words, flashcards' },
  { id: 'sentences', label: 'Sentences', hint: 'Sentence ladder: what was typed and recorded' },
  { id: 'debriefs', label: 'Debriefs', hint: 'What they said they learned' },
  { id: 'coins', label: 'Coins', hint: 'This week in silver, and their rates' },
  { id: 'courses', label: 'Courses', hint: 'Enrollment, pace, milestones' },
  { id: 'history', label: 'History', hint: 'Every session, newest first' },
  { id: 'reports', label: 'Reports', hint: 'Report card, pacing, closing the period' },
  { id: 'operations', label: 'Fix something', hint: 'Credit, excuse, reassign, bypass' },
];
const FOLD_IDS = new Set(LEARNER_FOLDS.map((fold) => fold.id));

function Fold({ fold, open, onToggle, children }) {
  const ref = useRef(null);
  // A deep link opens a fold below the day: bring it into view once.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!open || scrolledRef.current || !fold.deepLinked) return;
    scrolledRef.current = true;
    try { ref.current?.scrollIntoView?.({ block: 'start' }); } catch { /* jsdom */ }
  }, [open, fold.deepLinked]);
  return (
    <section ref={ref} className={`teacher-learner-fold${open ? ' is-open' : ''}`} data-fold={fold.id}>
      <button type="button" className="teacher-learner-fold__head" aria-expanded={open} onClick={onToggle}>
        <span className="teacher-learner-fold__label">{fold.label}</span>
        <span className="teacher-learner-fold__hint">{fold.hint}</span>
        <span className="teacher-learner-fold__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="teacher-learner-fold__body">{children}</div>}
    </section>
  );
}

export default function LearnerPage({
  learner, route, kids, studyDay, onChangeStudyDay, onOpenSession, onOpenSessionFrom, onReplaceUrl, PianoProgramsPanel,
}) {
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  const queried = query.get('fold');
  // A fold named by the old section path, or by `?fold=` (the current form).
  const linked = FOLD_IDS.has(route.section) ? route.section : (FOLD_IDS.has(queried) ? queried : null);
  const [openFolds, setOpenFolds] = useState(() => new Set(linked ? [linked] : []));
  useEffect(() => {
    // A link to another section of the same child (an in-console anchor, or
    // Back) opens that fold too, rather than leaving the page as it was.
    if (linked) setOpenFolds((current) => (current.has(linked) ? current : new Set([...current, linked])));
  }, [linked]);
  useEffect(() => { teacherLog.nav('learner-page', { learnerId: learner.id, fold: linked }); }, [learner.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => {
    const opening = !openFolds.has(id);
    const next = new Set(openFolds);
    if (opening) next.add(id); else next.delete(id);
    setOpenFolds(next);
    teacherLog.nav('learner-fold', { learnerId: learner.id, fold: id, open: opening });
    // The URL names the fold just opened, else another still open, else none.
    // The path stays the day being read; the rest of the query is untouched.
    const named = opening ? id : [...next].at(-1) ?? null;
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (named) params.set('fold', named); else params.delete('fold');
    onReplaceUrl?.(params);
  };

  // A repair context is `?reason/subject/unit/day` — only those remount the
  // Fix fold, so opening another fold never resets a half-filled form.
  const repairKey = ['reason', 'subject', 'unit', 'day'].map((key) => query.get(key) ?? '').join('|');
  const views = {
    reading: () => <ReadingView learnerId={learner.id} learnerName={learner.name} kids={kids} />,
    words: () => <WordsView learnerId={learner.id} learnerName={learner.name} />,
    sentences: () => <SentencesView learnerId={learner.id} learnerName={learner.name} />,
    debriefs: () => <DebriefsView learnerId={learner.id} learnerName={learner.name} />,
    coins: () => <CoinsView learnerId={learner.id} learnerName={learner.name} />,
    courses: () => <CoursesView learnerId={learner.id} learnerName={learner.name} courseId={route.courseId} kids={kids} PianoProgramsPanel={PianoProgramsPanel} />,
    history: () => <HistoryView learnerId={learner.id} learnerName={learner.name} onOpenSession={(sessionId) => onOpenSessionFrom(sessionId, 'history')} />,
    reports: () => <ReportsView learnerId={learner.id} kids={kids} />,
    operations: () => <LearnerOperationsView key={`${learner.id}|${repairKey}`} learnerId={learner.id} learnerName={learner.name} kids={kids} />,
  };

  return (
    <div className="teacher-learner-page">
      <LearnerDayScreen learnerId={learner.id} learnerName={learner.name} studyDay={studyDay}
        onChangeStudyDay={onChangeStudyDay} onOpenSession={onOpenSession} />
      <div className="teacher-learner-folds">
        {LEARNER_FOLDS.map((fold) => (
          <Fold key={fold.id} fold={{ ...fold, deepLinked: fold.id === linked }} open={openFolds.has(fold.id)} onToggle={() => toggle(fold.id)}>
            <TabErrorBoundary tab={fold.id} resetKey={learner.id}>{views[fold.id]()}</TabErrorBoundary>
          </Fold>
        ))}
      </div>
    </div>
  );
}
