/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 *
 * Tapping a learner expands the day as a GRID of lesson cards — every lesson
 * on the day side by side: done work with its score (marks + percent), planned
 * work not yet started, and per-lesson access to the issued worksheet and the
 * printed result receipt. The artifact links ride the digest itself
 * (GetTeacherToday derives them from session state at zero extra I/O), so
 * showing them costs no per-session fetch — the N+1 the old eager dashboard
 * paid stays dead. The one lazy read is the agenda preview (per learner, on
 * expand, GET-only and non-recording) that contributes the "not yet started"
 * cards; without it the grid still renders everything recorded.
 *
 * Every artifact here is one tap from its icon — the worksheet PDF, the result
 * receipt, and the learner's own printed agenda (which lives on the roster
 * card, above the disclosure, because it is the sheet a parent wants before
 * deciding whether to expand anything). None of them is worth a modal: there
 * is a single destination behind each, and an overlay in front of one
 * destination is a tap and a dismissal charged for nothing.
 *
 * Previewing stays side-effect free: every read here is a GET that creates no
 * session, print, ticket, or code — the agenda preview route is inert by
 * construction (`X-School-Preview: agenda-non-recording`).
 */
import { useEffect, useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import SafeImg from './SafeImg.jsx';
import { agendaPreviewSrc } from './LearnerDayView.jsx';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { joinLearnerDay, DAY_STATUS_LABEL } from '../learnerDay.js';
import { teacherBaseFor, teacherDayPath, teacherSessionPath } from '../teacherUrl.js';
import { localDay } from '../teacherDates.js';
import { SubjectIdentity } from '../CurriculumIdentity.jsx';
import Icon, { hasIcon } from '../../home/icons/Icon.jsx';
import { teacherLog } from '../teacherLog.js';

// ---------------------------------------------------------------------------
// Inline SVG marks (kiosk WebViews render unicode glyphs as tofu).
// ---------------------------------------------------------------------------
const MarkCheck = () => (
  <svg viewBox="0 0 16 16" className="teacher-mark teacher-mark--check" aria-hidden="true" focusable="false">
    <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const MarkCross = () => (
  <svg viewBox="0 0 16 16" className="teacher-mark teacher-mark--cross" aria-hidden="true" focusable="false">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
const IconPdf = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 1.5h7l4 4V17a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 17V3A1.5 1.5 0 0 1 5.5 1.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 1.5V6h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M6.5 10h7M6.5 12.7h7M6.5 15.4h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconReceipt = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 2h10v15l-2-1.4-2 1.4-2-1.4L7 17l-2-1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.2 6h5.6M7.2 8.8h5.6M7.2 11.6h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconChevron = ({ open }) => (
  <svg viewBox="0 0 16 16" className={`teacher-roster__chevron${open ? ' teacher-roster__chevron--open' : ''}`} aria-hidden="true" focusable="false">
    <path d="M5.5 3.5L11 8l-5.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconAgenda = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 2h10v15l-2-1.4-2 1.4-2-1.4L7 17l-2-1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.2 6h5.6M7.2 8.8h5.6M7.2 11.6h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

// `reviewStatus` is 'pending' | 'complete' | null on the wire — null until the
// session has something reviewable. Accept the historical 'pending_review'
// spelling too, so a backend rename can't silence the label.
const AWAITING = new Set(['pending', 'pending_review']);

// The agenda sheet is 580px of receipt tape, and a full browser tab gives it a
// whole screen to be a narrow column in the middle of. A window sized to the
// PNG puts the paper at its own scale, alongside the dashboard rather than on
// top of it. The anchor keeps its real `href` so middle-click and long-press
// still work; only a plain left-click is intercepted.
const AGENDA_WINDOW_WIDTH = 620;   // 580px of tape + the window's own chrome
const AGENDA_WINDOW_HEIGHT = 900;

function openAgendaWindow(event, src, learnerId) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const left = Math.max(0, (globalThis.screen?.availWidth ?? AGENDA_WINDOW_WIDTH) - AGENDA_WINDOW_WIDTH);
  const opened = window.open(
    src,
    `agenda-${learnerId}`,
    `popup=yes,width=${AGENDA_WINDOW_WIDTH},height=${AGENDA_WINDOW_HEIGHT},left=${left},top=0,`
    + 'menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes',
  );
  // A blocked popup must not swallow the click: fall through to the anchor's
  // own navigation rather than leaving the teacher with nothing.
  if (opened) event.preventDefault();
}

const SELF_LABEL = {
  not_yet: 'says: not yet', uncertain: 'says: not sure', ready: 'says: feels ready',
};

/**
 * The score as the operator asked for it: green checks and red X's AND a
 * percentage. The marks carry the count visually; the aria-label states it in
 * words so the pair never has to be printed twice as text (IA1). Past a dozen
 * items individual marks stop reading as a count, so one mark of each kind
 * with a numeral stands in.
 */
function ScoreMarks({ score }) {
  const { correctCount: correct, totalCount: total, percent } = score;
  const label = `${correct} of ${total} correct`;
  const pct = typeof percent === 'number' ? Math.round(percent) : Math.round((correct / total) * 100);
  return (
    <div className="teacher-lesson-card__score" role="img" aria-label={label} data-testid="score-marks">
      <span className="teacher-lesson-card__marks">
        {total <= 12 ? <>
          {Array.from({ length: correct }, (_, i) => <MarkCheck key={`c${i}`} />)}
          {Array.from({ length: total - correct }, (_, i) => <MarkCross key={`x${i}`} />)}
        </> : <>
          <MarkCheck /><span className="teacher-lesson-card__mark-count">{correct}</span>
          <MarkCross /><span className="teacher-lesson-card__mark-count">{total - correct}</span>
        </>}
      </span>
      <span className={`teacher-lesson-card__percent${pct < 80 ? ' teacher-lesson-card__percent--low' : ''}`}>{pct}%</span>
    </div>
  );
}

/**
 * Small square tap targets for the paper record; hidden when nothing was
 * archived.
 *
 * STRAIGHT TO THE FILE. These used to open a modal whose entire content was
 * one thumbnail and an "Open worksheet" link — an interstitial in front of a
 * single destination, which is a tap and a dismissal charged for nothing. The
 * button IS the link now. The PDF is an anchor (a real link a teacher can
 * middle-click or long-press); the receipt PNG goes through `window.open` so
 * the log line still fires on the way out.
 */
function ArtifactButtons({ session, onOpen }) {
  const worksheet = session?.artifacts?.worksheet ?? null;
  const receipt = session?.artifacts?.receipt ?? null;
  const worksheetUrl = worksheet?.originalPdfUrl ?? null;
  const receiptUrl = receipt?.originalUrl ?? null;
  if (!worksheetUrl && !receiptUrl) return null;
  return (
    <span className="teacher-lesson-card__artifacts">
      {worksheetUrl && (
        <a className="teacher-artifact-btn" aria-label="Open the worksheet" href={worksheetUrl}
          target="_blank" rel="noreferrer"
          onClick={() => onOpen('worksheet', session)}><IconPdf /></a>
      )}
      {receiptUrl && (
        <button type="button" className="teacher-artifact-btn" aria-label="Open the result receipt"
          onClick={() => { onOpen('receipt', session); window.open(receiptUrl, '_blank', 'noopener'); }}>
          <IconReceipt />
        </button>
      )}
    </span>
  );
}

/**
 * The secondary footer line for work that is under way.
 *
 * "Not graded" used to live here, fired by any session with no score — which
 * covered both "nothing was done yet" and "this lesson type will never have a
 * score", and read as a chore a grown-up still owed. It is gone. What remains
 * is news: paper is out, or a submission is waiting on a mark.
 *
 * `reviewStatus` is consulted ONLY from `submitted` onward. The digest defaults
 * it to 'complete' for sessions that were never worked, so asking earlier
 * answers a different question than the one being posed.
 */
const progressNote = (session) => {
  const state = session?.state ?? null;
  if (state === 'submitted') return AWAITING.has(session?.reviewStatus) ? 'Awaiting review' : null;
  if (state === 'issued' || state === 'reprinted') return 'Worksheet out';
  return null;
};

/** One lesson on the day — identity, state, score, and its paper, in one square. */
function LessonCard({ row, learnerId, base, onOpen }) {
  const session = row.session;
  const subject = session?.subject ?? row.subject;
  // A PLANNED LESSON IS AS FULLY DESCRIBED AS A RECORDED ONE.
  //
  // The agenda offer resolves its own Subject › Course › Unit › Lesson names
  // and its poster (BuildAgenda's `offerPresentation`), so a card with no
  // session yet has no reason to fall back to a bare title. It used to,
  // because the day-join threw everything but `next.title` away — which is
  // how "Arts & Culture / How to Play “Dinah” on Piano / Nothing recorded
  // yet" ended up with no art and no course beneath it.
  const offer = row.offer ?? null;
  // A SERVED SUBJECT STILL KNOWS WHAT IT SERVED. Once a subject is done for
  // the day the planner drops its `next`, so this chain used to run out and
  // land on "No work offered" — printed on a card whose own chip said DONE.
  // `served.work` names curriculum work; `served.progressLabel` is the
  // program's own copy for a subject that completes outside a work session.
  const served = row.served ?? null;
  const title = session?.lessonTitle ?? session?.title
    ?? offer?.taxonomy?.lesson ?? row.planned
    // A clean lesson name, whether it came from the curriculum tally or from a
    // program's own status. Preferred over `progressLabel` because that is a
    // whole authored SENTENCE — "Done today — Rhythm Improvisation with Chords
    // · 35/366" — which repeats the Done chip beside it and reads oddly as a
    // title. It stays as the last resort, used verbatim: slicing a "Done
    // today — " prefix off it would rot the moment that wording changed.
    ?? served?.work?.[0]?.title
    ?? served?.progressLabel
    ?? 'No work offered';
  const courseTitle = session?.courseTitle ?? offer?.taxonomy?.course ?? null;
  const posterUrl = session?.posterUrl ?? offer?.posterUrl ?? null;
  const score = session?.effectiveScore;
  const scored = score?.correctCount != null && score?.totalCount != null;
  // A SCORE ALREADY SAYS "DONE". Seven green checks and 71% cannot be the
  // state of unstarted work, so a "Done" chip above them is a label for
  // something the reader has already been told. The chip survives only where
  // it carries news — not started, in progress, deferred, blocked, or a done
  // card whose work belongs to an earlier study day.
  const statusLabel = row.status === 'done' && row.carriedOver ? 'Done (earlier day)' : DAY_STATUS_LABEL[row.status];
  const showChip = !scored || row.carriedOver;
  // Provenance composes with any status: an unplanned lesson can be finished,
  // in progress, or untouched, and the tag says so beside the chip rather than
  // standing in for it.
  const note = session ? progressNote(session) : null;
  // THE POSTER FRAME IS ALWAYS DRAWN, poster or not.
  //
  // It used to be a conditional full-width 52px band — a letterboxed strip of
  // a portrait poster, cropped to a rug. Two problems, both fixed here: art
  // shot at 2:3 is shown at 2:3, and the box holding it exists before the
  // bytes arrive. A frame that appears when an image loads, or vanishes when
  // one 404s, moves every word on the card underneath it; a card in a grid of
  // cards moves its neighbours too. Reserved space is the whole point — the
  // layout is identical at first paint, on load, and on failure.
  // The breadcrumb, in the card's own header band: where in the curriculum
  // this lesson sits. Course and unit both, when both are known — the same
  // Subject › Course › Unit the printed lesson card carries.
  const crumbs = [
    courseTitle,
    session?.moduleTitle ?? offer?.taxonomy?.unit ?? served?.moduleLabel,
  ].filter(Boolean);
  const identity = (
    <span className="teacher-lesson-card__identity">
      <span className="teacher-lesson-card__poster">
        {/* THE FRAME IS RESERVED EITHER WAY (see above), but a permanently
            empty one reads as a failed load rather than as art that never
            existed. The subject's own mark stands in — the same glyph the
            header carries, so the card is still identifiable at a glance. */}
        {/* The glyph is always in the frame; the image covers it when it
            loads. So a poster that never existed and one that 404s look
            identical, and neither moves anything. */}
        <Icon name={subject ?? 'school'} className="teacher-lesson-card__poster-glyph" />
        {posterUrl && <SafeImg src={posterUrl} alt="" fallback="" />}
      </span>
      {/* THE LESSON OUTRANKS ITS SHELF. The breadcrumb used to sit in the
          tinted header band — uppercase, full width, above a divider — which
          made the least specific fact on the card the loudest one, and on a
          long course path it wrapped to two lines and out-measured the title
          it was supposed to locate. It is a locator now, under the name,
          clamped to one line. */}
      <span className="teacher-lesson-card__copy">
        <strong className="teacher-lesson-card__title">{title}</strong>
        {crumbs.length > 0 && (
          <span className="teacher-lesson-card__crumbs">{crumbs.join(' › ')}</span>
        )}
      </span>
    </span>
  );
  return (
    <article className={`teacher-lesson-card teacher-lesson-card--${row.status}`} data-testid="lesson-card">
      {/* HEADER — the shelf this lesson came off. Subject full width across
          the top, breadcrumb beneath it, on its own tinted band above a
          divider. The subject used to be a caption wedged into the text
          column beside the art, at the same weight as the course line. */}
      <header className="teacher-lesson-card__header">
        <SubjectIdentity subject={subject} />
      </header>
      <div className="teacher-lesson-card__body">
        {session?.sessionId
          ? <a className="teacher-lesson-card__open" href={teacherSessionPath(learnerId, session.sessionId, base, { from: 'today' })}>{identity}</a>
          : identity}
      </div>
      {/* FOOTER — how it went, and its paper. Same band treatment as the
          header, on the other side of the body. */}
      <footer className="teacher-lesson-card__foot">
        <span className="teacher-lesson-card__state">
          {scored && <ScoreMarks score={score} />}
          {(showChip || row.unplanned) && (
            <span className="teacher-lesson-card__chips">
              {showChip && (
                <span className={`teacher-day-chip teacher-day-chip--${row.status}`}>{statusLabel}</span>
              )}
              {row.unplanned && <span className="teacher-day-chip__tag">not on the plan</span>}
            </span>
          )}
          {(note ?? row.detail) && (
            <span className="teacher-lesson-card__pending">{note ?? row.detail}</span>
          )}
        </span>
        {session && <ArtifactButtons session={session} onOpen={onOpen} />}
      </footer>
    </article>
  );
}

/**
 * The day as dots, for the collapsed card: one per lesson, in plan order.
 *
 * Green passed, amber fell short, grey not started yet — the shape of the day
 * without opening it. The subject's own icon rides inside each dot, so the row
 * says WHICH lessons as well as how many; "10 / 10 correct across 2
 * assignments" said neither.
 *
 * `passing` is 80% — the same bar the printed result receipt states.
 */
const PASS_PERCENT = 80;

function dotTone(row) {
  const score = row.session?.effectiveScore;
  if (score?.percent != null) return score.percent >= PASS_PERCENT ? 'passed' : 'failed';
  // Status now means progress for EVERY row, so there is no branch here for
  // unplanned work — it tones by how far along it is, like anything else, and
  // the dot's label carries the provenance. Grey is reserved for "not touched",
  // and a dashed amber ring for "out in the world but not back yet".
  if (row.status === 'done') return 'passed';
  if (row.status === 'in-progress') return 'active';
  if (row.status === 'blocked') return 'failed';
  return 'idle';
}

function DayDots({ rows }) {
  if (!rows.length) return null;
  return (
    <span className="teacher-roster__dots" data-testid="day-dots">
      {rows.map((row) => {
        const tone = dotTone(row);
        const score = row.session?.effectiveScore;
        const label = [
          row.subject ?? 'lesson',
          row.session?.lessonTitle ?? row.planned,
          score?.percent != null ? `${Math.round(score.percent)}%` : DAY_STATUS_LABEL[row.status],
          row.unplanned ? 'not on the plan' : null,
        ].filter(Boolean).join(' — ');
        return (
          <span key={row.key} className={`teacher-roster__dot teacher-roster__dot--${tone}`} title={label}>
            {/* `Icon` draws NOTHING for a subject with no SVG, and here the
                icon IS the content — an empty disc says neither which lesson
                nor that anything is missing. The subject's initial stands in. */}
            {hasIcon(row.subject)
              ? <SubjectIdentity subject={row.subject} iconOnly />
              : <>
                <span aria-hidden="true" className="teacher-roster__dot-initial">
                  {String(row.subject ?? '?')[0].toUpperCase()}
                </span>
                <span className="teacher-visually-hidden">{label}</span>
              </>}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The expanded day for one learner: the joined rows as a grid of lesson cards.
 * The join itself lives on the entry above — the collapsed card needs it too.
 */
function LearnerDayGrid({ learnerId, rows, base, studyDay, agenda, onOpenArtifact }) {
  useEffect(() => {
    teacherLog.nav('drill-open', { learnerId, lessons: rows.length });
  }, [learnerId]); // eslint-disable-line react-hooks/exhaustive-deps -- one open, one event
  return (
    <>
      {agenda.state === 'error' && (
        <p className="teacher-roster__plan-notice">Couldn&rsquo;t load the day&rsquo;s plan — showing recorded work only.
          <button type="button" className="teacher-panel__retry" onClick={agenda.retry}>Retry</button></p>
      )}
      {/* The grid waits for the plan. Rendering the recorded sessions first and
          letting the planned ones drop in when the agenda read lands re-flows
          the whole grid under a teacher who has already started reading it —
          cards move, and a tap can land on a card that was somewhere else a
          frame ago. One reserved-height line holds the space instead. */}
      {agenda.state === 'loading'
        ? <p className="teacher-roster__plan-loading" aria-busy="true">Loading the day&rsquo;s plan…</p>
        : rows.length > 0
          ? <div className="teacher-lesson-grid" data-testid="lesson-grid">
            {rows.map((gridRow) => (
              <LessonCard key={gridRow.key} row={gridRow} learnerId={learnerId} base={base} onOpen={onOpenArtifact} />
            ))}
          </div>
          : <p className="teacher-panel__empty">Nothing planned or recorded for this day.</p>}
      <a className="teacher-btn teacher-btn--quiet teacher-roster__day-link"
        href={teacherDayPath(learnerId, studyDay, base)}>
        Open the full day record →
      </a>
    </>
  );
}

/**
 * One learner: the collapsed card, and the day grid when it is open.
 *
 * THE AGENDA READ LIVES HERE, not in the grid, because the collapsed card
 * needs the plan too — a row of dots that only knew about recorded sessions
 * would show a four-lesson day as two. It is still ONE read per learner (never
 * per session: that N+1 stays dead), and it is still GET-only and
 * non-recording.
 */
function RosterEntry({ row, kids, studyDay: studyDayProp, open, onToggle }) {
  const learnerId = row.learnerId;
  const name = kids.find((k) => k.id === learnerId)?.name ?? learnerId;
  const panelId = `teacher-day-${String(learnerId).replace(/[^a-z0-9_-]/gi, '-')}`;
  const base = teacherBaseFor(globalThis.location?.pathname ?? '');
  // A v1 digest carries no studyDay; default LOCAL (never the UTC date, which
  // flips to tomorrow every evening) so the agenda read always names a real
  // day — `studyDay=undefined` is rejected as malformed.
  const studyDay = studyDayProp ?? row.studyDay ?? localDay();
  const agenda = usePanelFetch(() => schoolApi.agendaPreview(learnerId, studyDay), {
    deps: [learnerId, studyDay], panel: `roster-agenda-${learnerId}`, notFoundAs: 'unavailable',
  });
  const sessions = row.sessions ?? row.sessionsToday ?? [];
  const carriedOver = (row.processedToday ?? []).filter((session) => session.studyDay !== studyDay);
  const joined = joinLearnerDay({
    sections: agenda.data?.sections ?? [], sessions, carriedOver, studyDay,
  });
  const openArtifact = (kind, session) => {
    teacherLog.nav('artifact-open', { learnerId, sessionId: session.sessionId, kind });
  };
  // THE DAY, COUNTED AT DAY SCOPE. "6 / 6 correct" was a LESSON's numerator
  // and denominator printed on a row that stands for a whole student-day: on
  // the reported screenshot it was one worksheet's marks, on a day holding
  // three lessons, one of which had not been started. It said nothing about
  // how much of the day was left, which is the only question this row exists
  // to answer.
  const lessons = joined.rows.filter((r) => !r.unplanned).length;
  const doneCount = joined.rows.filter((r) => !r.unplanned && r.status === 'done').length;
  const unplannedCount = joined.rows.filter((r) => r.unplanned).length;
  const summary = [
    lessons > 0 ? `${doneCount} of ${lessons} lesson${lessons === 1 ? '' : 's'} done` : null,
    unplannedCount > 0 ? `${unplannedCount} extra` : null,
  ].filter(Boolean).join(' · ');
  // The plan link is for a learner who has not begun. `scored` used to mean
  // "any machine-graded attempt today", which missed a day spent entirely on
  // work that carries no score.
  const started = (joined.counts.done ?? 0) + (joined.counts['in-progress'] ?? 0) > 0;
  const settled = agenda.state !== 'loading';
  return (
    <div className="teacher-roster__entry">
      <button
        type="button"
        className="teacher-roster__card"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <ProfileAvatar id={learnerId} name={name} />
        <span className="teacher-roster__identity">
          <span className="teacher-roster__name">{name}</span>
          {settled && summary && <span className="teacher-roster__stats">{summary}</span>}
        </span>
        {/* THE DAY ITSELF — the row's primary content, not a decoration
            beside a number. One disc per assigned lesson, in plan order,
            carrying its subject's mark and its own state. Rendered only once
            the plan has settled: dots that multiply as the read lands are the
            same rug pull the grid below refuses. */}
        {settled && <DayDots rows={joined.rows} />}
        {row.pendingReview > 0 && (
          <span className="teacher-roster__badge">{row.pendingReview} to review</span>
        )}
        {/* Decorative, and INSIDE the toggle it describes. It used to be
            absolutely positioned over the button, 20px from the agenda link —
            two targets stacked in one corner of a row whose whole surface is
            already the toggle. */}
        <span className="teacher-roster__disclosure" aria-hidden="true"><IconChevron open={open} /></span>
      </button>
      {/* THE AGENDA BELONGS ON THE CARD, not behind the disclosure. It is
          the child's paper for the day — the thing a parent reaches for
          before deciding whether to open anything at all — and it used to
          cost an accordion open plus a "Show the printed agenda" toggle to
          reach. One tap, straight to the sheet. */}
      <a className="teacher-artifact-btn teacher-roster__agenda-link"
        href={agendaPreviewSrc(learnerId, studyDay)}
        aria-label={`Open ${name}'s printed agenda`}
        onClick={(event) => {
          teacherLog.nav('agenda-open', { learnerId });
          openAgendaWindow(event, agendaPreviewSrc(learnerId, studyDay), learnerId);
        }}>
        <IconAgenda />
      </a>

      {/* A learner with nothing recorded is not a dead end: the plan for
          the day is the next thing a teacher wants to see. */}
      {settled && !started && (
        <a className="teacher-btn teacher-btn--quiet teacher-roster__plan-link"
          href={teacherDayPath(learnerId, studyDay, base)}>
          See today’s plan →
        </a>
      )}
      {/* The kid's own words about today's work (advocacy wave 7):
          reflections used to be written and read by nobody. */}
      {(row.reflectionsToday ?? []).length > 0 && (
        <ul className="teacher-roster__reflections" data-testid="reflections">
          {(row.reflectionsToday ?? []).map((r, i) => (
            // eslint-disable-next-line react/no-array-index-key -- order stable within one fetch
            <li key={i} className="teacher-roster__reflection">
              {r.selfAssessment && <span className="teacher-roster__reflection-mood">{SELF_LABEL[r.selfAssessment] ?? r.selfAssessment}</span>}
              {r.note && <span className="teacher-roster__reflection-note">&ldquo;{r.note}&rdquo;</span>}
            </li>
          ))}
        </ul>
      )}
      {open && <div id={panelId} className="teacher-roster__details">
        <LearnerDayGrid
          learnerId={learnerId} rows={joined.rows} base={base}
          studyDay={studyDay} agenda={agenda} onOpenArtifact={openArtifact}
        />
      </div>}
    </div>
  );
}

export default function RosterStrip({ rows, kids, studyDay = null }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="teacher-roster">
      {rows.map((row) => (
        <RosterEntry
          key={row.learnerId}
          row={row}
          kids={kids}
          studyDay={studyDay}
          open={openId === row.learnerId}
          onToggle={() => setOpenId((cur) => (cur === row.learnerId ? null : row.learnerId))}
        />
      ))}
    </div>
  );
}
