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
import { useCallback, useEffect, useState } from 'react';
import ProfileAvatar from "../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import SafeImg from "./SafeImg.jsx";
import { agendaPreviewSrc } from "./agendaPreviewSrc.js";
import { AgendaDispatch } from "./AgendaDispatch.jsx";
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import { joinLearnerDay, DAY_STATUS_LABEL } from "../learnerDay.js";
import { teacherBaseFor, teacherDayPath, teacherSessionPath, teacherLearnerPath, teacherLearnerOpsPath } from "../teacherUrl.js";
import { localDay } from "../teacherDates.js";
import { SubjectIdentity, subjectTitle } from "../CurriculumIdentity.jsx";
import Icon from "../../home/icons/Icon.jsx";
import { hasIcon } from "../../home/icons/iconRegistry.js";
import { teacherLog } from "../teacherLog.js";
import { GROWN_UP_ACTION, grownUpActionFor, mutedExcuseFor } from "../obligationCopy.js";

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

// ---------------------------------------------------------------------------
// Obligation copy (plan 3.2/3.3). `row.obligation = { state, reason,
// needsGrownUp }` is task 7's pass-through of `agenda.mjs`'s own verdict —
// this file adds no classification of its own, only the link for reasons
// that already carry `needsGrownUp: true`. The words (and the muted fallback
// for the ones that don't) live in `obligationCopy.js`. NEVER a raw reason
// slug on screen.
// ---------------------------------------------------------------------------

/**
 * `faulted` outranks the `needsGrownUp` flag: the ladder that computes the
 * flag (`learnerDay.js`'s `NEEDS_GROWN_UP`) is a hand-authored mirror of
 * `agenda.mjs`'s own two-reason `FAULT_REASONS` set, and if the mirror ever
 * drifts (a fault reason added on one side, not the other) `state: 'faulted'`
 * is still the domain's own word for "needs a grown-up" (per
 * `__docs/reference/school/teacher.md` §4: "faulted means the day could not be
 * judged at all"). Checking BOTH is what keeps the red card band
 * (`--faulted`, keyed off `state` alone) from ever painting with nothing in
 * it to read.
 */
function needsAdult(obligation) {
  return Boolean(obligation && (obligation.needsGrownUp || obligation.state === 'faulted'));
}

/**
 * Where a grown-up action goes, carrying the row it came from:
 * - a hold → the failed lesson itself, where "Offer another try" lives;
 * - a finished course → the learner's Courses;
 * - everything else → the learner's own Operations, told the reason, subject,
 *   unit and day, so it can name the problem and preselect the repair.
 *
 * A held subject's row rarely carries the failed session: agenda.mjs makes
 * the held entry the section's `next`, and the failed attempt is from an
 * earlier day, so nothing of today's joins it. The digest's `attention` item
 * for that unit is what still names the session, so it is asked first.
 * Exported for its unit test only.
 */
export function grownUpHref(linkTo, learnerId, base, row = null, { attention = [], studyDay = null } = {}) {
  // One unit for every destination, offer first — the unit a held lesson is
  // matched on. The repair-tools link used to read session first, so a row
  // whose offer and session named different units sent the two links to
  // different lessons (review 2026-10-21).
  const unitId = row?.offer?.unitId ?? row?.session?.unitId ?? null;
  if (linkTo === 'history') {
    const held = unitId ? attention.find((item) => item.unitId === unitId) : null;
    const sessionId = held?.sessionId ?? row?.session?.remediation?.activeSessionId ?? row?.session?.sessionId ?? null;
    return sessionId
      ? teacherSessionPath(learnerId, sessionId, base, { from: 'today' })
      : teacherLearnerPath(learnerId, 'history', null, base);
  }
  if (linkTo === 'courses') return teacherLearnerPath(learnerId, 'courses', null, base);
  return teacherLearnerOpsPath(learnerId, {
    reason: row?.obligation?.reason ?? null,
    subject: row?.subject ?? null,
    unit: unitId,
    day: studyDay,
  }, base);
}

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
export function DigestArtifactButtons({ session, onOpen = () => {} }) {
  const worksheet = session?.artifacts?.worksheet ?? null;
  const receipt = session?.artifacts?.receipt ?? null;
  const worksheetUrl = worksheet?.originalPdfUrl ?? null;
  const receiptUrl = receipt?.originalUrl ?? null;
  const receiptStatus = receiptUrl
    ? receipt.printed === false ? 'Receipt print failed; archived image is available'
      : receipt.printReason === 'unverified' ? 'Sent to printer; printer confirmation unavailable'
        : receipt.printed === true ? 'Printer confirmed receipt' : 'Archived receipt' : null;
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
          title={receiptStatus}
          onClick={() => { onOpen('receipt', session); window.open(receiptUrl, '_blank', 'noopener'); }}>
          <IconReceipt />
        </button>
      )}
      {/* Only a FAILED print is news. "Sent; the printer cannot confirm" is the
          ordinary case and printed under every row (audit 2026-10-29); it
          stays as the receipt button's tooltip. */}
      {receipt?.printed === false && receiptStatus && <small className="teacher-lesson-card__print-state">{receiptStatus}</small>}
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

/**
 * One lesson on the day — identity, state, score, and its paper, in one
 * square.
 *
 * `showObligation` defaults true: it is set false only for a non-first row of
 * a multi-session section (`LearnerDayGrid` below), because every row a
 * section produces shares the SAME obligation (`learnerDay.js`: "the plan is
 * stated once for the subject, not repeated per session") — two finished
 * sessions under one `excused:caught_up` subject must not print "This course
 * has no more lessons" on two adjacent cards.
 */
function LessonCard({ row, learnerId, base, onOpen, showObligation = true, attention = [], studyDay = null }) {
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
  // THE PLANNER'S VERDICT, SHOWN AS ITS OWN FACT — never merged with `status`
  // into a combined badge. A row can be `planned` under `excused`; that is
  // two true things, not a contradiction (plan 3.2/3.3/3.4 design note).
  const obligation = row.obligation ?? null;
  const faulted = obligation?.state === 'faulted';
  // `showObligation` suppresses the NOTICE on a repeat row of the same
  // section (see the doc comment above) — the card still carries its own
  // status chip and score regardless; only the once-per-subject verdict text
  // is held back. `grownUpActionFor`/`mutedExcuseFor` never return null, so
  // this slot is never silently blank for a row that IS showing it.
  const grownUp = (showObligation && needsAdult(obligation)) ? grownUpActionFor(obligation.reason) : null;
  // A quiet excuse still says why, just never with a button — the fallback
  // only fires when nothing upstream (an in-flight session, the row's own
  // `detail`) already supplied a sentence.
  const mutedExcuse = (showObligation && obligation?.state === 'excused' && !needsAdult(obligation))
    ? mutedExcuseFor(obligation.reason)
    : null;
  const pendingText = note ?? row.detail ?? mutedExcuse;
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
    <article
      className={`teacher-lesson-card teacher-lesson-card--${row.status}${faulted ? ' teacher-lesson-card--faulted' : ''}`}
      data-testid="lesson-card"
    >
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
          {/* THE OBLIGATION IS A SEPARATE FACT FROM THE CHIP ABOVE, never
              merged into it (plan 3.2/3.3): a `planned` chip can sit right
              beside "This program can't start". Only the reasons that
              dead-end without an adult earn a link; the rest of this slot is
              the quiet muted sentence it always was. */}
          {grownUp ? (
            <span className={`teacher-lesson-card__obligation${faulted ? ' teacher-lesson-card__obligation--fault' : ''}`}>
              <strong>{grownUp.headline}</strong>
              <a className="teacher-lesson-card__obligation-link" href={grownUpHref(grownUp.linkTo, learnerId, base, row, { attention, studyDay })}>
                {grownUp.linkLabel}
              </a>
            </span>
          ) : (pendingText && (
            <span className="teacher-lesson-card__pending">{pendingText}</span>
          ))}
        </span>
        {session && <DigestArtifactButtons session={session} onOpen={onOpen} />}
        {row.carriedOver && session?.remediation?.activeSessionId && (
          <a className="teacher-btn teacher-btn--quiet teacher-lesson-card__retry-link"
            href={teacherSessionPath(learnerId, session.remediation.activeSessionId, base, { from: 'today' })}>
            Open active retry →
          </a>
        )}
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
  // A row that dead-ends without a grown-up (task 8's four obligation
  // reasons) gets its OWN tone regardless of row status: `blocked_unreachable`
  // carries the same `status: 'blocked'` an ordinary reachable lock does, and
  // the collapsed row must still tell the two apart at a glance.
  if (needsAdult(row.obligation)) return 'needs-grownup';
  // Status now means progress for EVERY row, so there is no branch here for
  // unplanned work — it tones by how far along it is, like anything else, and
  // the dot's label carries the provenance. Grey is reserved for "not touched",
  // and a dashed amber ring for "out in the world but not back yet".
  if (row.status === 'done') return 'passed';
  if (row.status === 'in-progress') return 'active';
  if (row.status === 'blocked') return 'failed';
  return 'idle';
}

// The chip's verdict in words: a percent beats any state; otherwise the
// console's ONE status vocabulary (`DAY_STATUS_LABEL`, the Day record's own
// words), lower-cased for a chip (audit 2026-10-29: eight words for one fact).
function chipResult(row) {
  const score = row.session?.effectiveScore;
  if (score?.percent != null) return `${Math.round(score.percent)}%`;
  if (row.session?.reviewStatus === 'pending') return 'to mark';
  if (needsAdult(row.obligation)) return 'needs you';
  return (DAY_STATUS_LABEL[row.status] ?? '').toLowerCase();
}

/**
 * THE DAY AS CHIPS — one per lesson, in plan order: the subject's mark, its
 * short name, and its result (a percent, else "done" / "started" / "to do" /
 * "stuck" / "needs you"). Icon-only discs made a parent hover each one to
 * learn which subject was which and how it went (audit 2026-10-29, job 1);
 * the words are the at-a-glance answer. Tone still colours the chip, never
 * alone.
 */
function DayDots({ rows }) {
  if (!rows.length) return null;
  return (
    <span className="teacher-roster__dots" data-testid="day-dots">
      {rows.map((row) => {
        const tone = dotTone(row);
        const score = row.session?.effectiveScore;
        const result = chipResult(row);
        // One spoken label per chip: the subject's name, the lesson, its result.
        const label = [
          subjectTitle(row.subject),
          row.session?.lessonTitle ?? row.planned,
          score?.percent != null ? `${Math.round(score.percent)}%` : DAY_STATUS_LABEL[row.status],
          row.unplanned ? 'not on the plan' : null,
          needsAdult(row.obligation) ? GROWN_UP_ACTION[row.obligation.reason]?.headline ?? null : null,
        ].filter(Boolean).join(' — ');
        return (
          <span key={row.key} className={`teacher-roster__dot teacher-roster__dot--${tone}`} title={label}>
            {/* `Icon` draws NOTHING for a subject with no SVG; the initial stands in.
                Hidden from the accessible name: the label below says it once. */}
            {hasIcon(row.subject)
              ? <span aria-hidden="true"><SubjectIdentity subject={row.subject} iconOnly /></span>
              : <span aria-hidden="true" className="teacher-roster__dot-initial">
                {String(row.subject ?? '?')[0].toUpperCase()}
              </span>}
            {/* The subject's first word ("Math", "Scripture"): the full shelf name
                ("Math & Money") wrapped five chips to five lines on a phone. */}
            <span className="teacher-roster__dot-name" aria-hidden="true">{subjectTitle(row.subject).split(/\s+&\s+/)[0]}</span>
            {result && <span className="teacher-roster__dot-result" aria-hidden="true">{result}</span>}
            <span className="teacher-visually-hidden">{label}</span>
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
function LearnerDayGrid({ learnerId, rows, markedToday = [], base, studyDay, agenda, attention = [], onOpenArtifact }) {
  useEffect(() => {
    teacherLog.nav('drill-open', { learnerId, lessons: rows.length, markedToday: markedToday.length });
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
            {/* A section's obligation is stated ONCE (`learnerDay.js`: "the
                plan is stated once for the subject, not repeated per
                session"). Every row a section produces shares the SAME
                `obligation` object BY REFERENCE (task 7), so identity — not
                the subject string, which two different sections can share —
                is what "already shown" means here. Fresh every render, so a
                stale Set never survives past this one pass. */}
            {(() => {
              const seenObligations = new Set();
              return rows.map((gridRow) => {
                const showObligation = !gridRow.obligation || !seenObligations.has(gridRow.obligation);
                if (gridRow.obligation) seenObligations.add(gridRow.obligation);
                return (
                  <LessonCard key={gridRow.key} row={gridRow} learnerId={learnerId} base={base}
                    onOpen={onOpenArtifact} showObligation={showObligation}
                    attention={attention} studyDay={studyDay} />
                );
              });
            })()}
          </div>
          : markedToday.length === 0
            ? <p className="teacher-panel__empty">Nothing planned or recorded for this day.</p>
            : null}
      {agenda.state !== 'loading' && markedToday.length > 0 && (
        <section className="teacher-roster__marked-today" aria-label="Marked today">
          <h4>Marked today</h4>
          <p className="teacher-muted">Earlier work graded on this date. Its paper and result stay with the original attempt.</p>
          <div className="teacher-lesson-grid" data-testid="marked-today-grid">
            {markedToday.map((session) => (
              <LessonCard key={session.sessionId} learnerId={learnerId} base={base}
                onOpen={onOpenArtifact} showObligation={false}
                row={{ key: session.sessionId, subject: session.subject, status: 'done', carriedOver: true,
                  session, obligation: null, detail: session.studyDay ? `Study day ${session.studyDay}` : null }} />
            ))}
          </div>
        </section>
      )}
      <a className="teacher-btn teacher-btn--quiet teacher-roster__day-link"
        href={teacherDayPath(learnerId, studyDay, base)}>
        Open the full day record →
      </a>
    </>
  );
}

/**
 * One hold in words, by its own reason: "Place Value — 2 retries, last 17% →"
 * for the cap, "Quiz — not retried in 4 school days, last 17% →" for a
 * failure left alone. The numbers are the item's, never a fixed "two".
 */
function attentionLabel(item) {
  const why = item.kind === 'remediation-stale'
    ? `not retried in ${item.idleStudyDays} school ${item.idleStudyDays === 1 ? 'day' : 'days'}`
    : `${item.depth} ${item.depth === 1 ? 'retry' : 'retries'}`;
  const score = item.lastScore?.percent != null ? `, last ${Math.round(item.lastScore.percent)}%` : '';
  return `${item.unitTitle ?? item.unitId} — ${why}${score} →`;
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
function RosterEntry({ row, kids, studyDay: studyDayProp, open, onToggle, onNeedsGrownUp, coins = null }) {
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
  const claimedCarried = new Set(joined.rows.filter((joinedRow) => joinedRow.carriedOver)
    .map((joinedRow) => joinedRow.session?.sessionId));
  const markedToday = carriedOver.filter((session) => !claimedCarried.has(session.sessionId));
  // Holds only a grown-up can move, by unit — a held lesson's link reads its
  // failed session from here (see `grownUpHref`).
  const attention = row.attention ?? [];
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
    markedToday.length > 0 ? `${markedToday.length} marked today` : null,
  ].filter(Boolean).join(' · ');
  // The week in coins, beside the day (the Coins roster folded into Home,
  // owner ruling 2026-10-29). Absent when the economy is off or unread.
  // Green days are counted against the days that are over (today counts
  // only once it is green): "0 green days" on a Monday is not a verdict.
  // Reading and piano beside the plan (audit 2026-10-29): what the day's
  // digest already carries. An unread source says nothing, never a zero.
  const reading = row.readingActivity?.status === 'ok' ? row.readingActivity : null;
  const piano = row.pianoActivity?.status === 'ok' ? row.pianoActivity : null;
  const pianoGameMinutes = Number.isFinite(piano?.gameSeconds) ? Math.round(piano.gameSeconds / 60) : 0;
  const activityLine = [
    reading ? (reading.minutes > 0 ? `Read ${reading.minutes} min`
      : reading.bookCount > 0 ? `Read ${reading.bookCount} book${reading.bookCount === 1 ? '' : 's'}` : 'No reading yet') : null,
    piano?.exercises > 0 ? `Piano ${piano.exercises} exercise${piano.exercises === 1 ? '' : 's'}${piano.passed ? ` (${piano.passed} passed)` : ''}` : null,
    pianoGameMinutes > 0 ? `${pianoGameMinutes} min piano games` : null,
  ].filter(Boolean).join(' · ');
  const coinLine = coins ? [
    `${coins.silver} silver this week`,
    coins.greenOf ? `${coins.green} of ${coins.greenOf} day${coins.greenOf === 1 ? '' : 's'} green` : null,
  ].filter(Boolean).join(' · ') : null;
  // The plan link is for a learner who has not begun. `scored` used to mean
  // "any machine-graded attempt today", which missed a day spent entirely on
  // work that carries no score.
  const started = (joined.counts.done ?? 0) + (joined.counts['in-progress'] ?? 0) > 0;
  // SETTLED MEANS THE PLAN ACTUALLY ARRIVED. `!== 'loading'` also admitted
  // `error` and `unavailable`, where `agenda.data` is null, the join runs over
  // zero sections, every row gets `obligation: null` ("the planner didn't
  // say", per `learnerDay.js`), and the tally below reports an empty array as
  // fact. That is a false all-clear on the one screen built to catch a broken
  // day — and the "couldn't load the day's plan" notice lives in the grid,
  // which a collapsed card never mounts, so nothing else says otherwise.
  const settled = agenda.state === 'ok' || agenda.state === 'empty';
  // The other half of the same truth: we tried, and we could not tell. Silence
  // alone would be honest but useless — the parent would still see a clean
  // roster. This travels up to the dashboard as a caution, not as a zero.
  const planUnknown = agenda.state === 'error' || agenda.state === 'unavailable';
  // THE SUBJECTS THIS LEARNER CONTRIBUTES to the dashboard's "N subjects need
  // a grown-up" strip (plan 3.4) — task 7's `needsGrownUp` read straight off
  // the join, never a second classification. Reported only once the plan has
  // settled, for the same reason `DayDots` waits below: "zero" before the
  // read lands is a guess, not a fact.
  //
  // ONE PER SECTION, NOT ONE PER ROW. A section that produced two rows (two
  // matched sessions, say) shares the SAME `obligation` object across both
  // (task 7) — a subject stuck on `excused:caught_up` after finishing two
  // lessons must count as ONE subject, not two, or the strip reads "2
  // subjects need a grown-up" for a single course. Dedup by object identity:
  // two DIFFERENT sections never share the same `obligation` reference (each
  // section computes its own), so this is exact, not a subject-string guess.
  const grownUpEntries = (() => {
    const seen = new Set();
    const entries = [];
    joined.rows.forEach((r) => {
      if (!needsAdult(r.obligation) || seen.has(r.obligation)) return;
      seen.add(r.obligation);
      entries.push(r);
    });
    return entries;
  })();
  // A stable signature (not the array itself, which is a fresh reference every
  // render) so the report effect fires only when the SET of subjects needing
  // a grown-up actually changes, not on every unrelated re-render. It spells
  // out everything an entry's link is built from, so a row that gains its
  // session (or its unit) re-reports the sharper link.
  const grownUpSignature = grownUpEntries.map((r) => [
    r.key, r.obligation.reason, r.subject ?? '', r.session?.sessionId ?? '',
    r.session?.remediation?.activeSessionId ?? '', r.session?.unitId ?? r.offer?.unitId ?? '',
  ].join(':')).join('|') + `#${attention.map((item) => `${item.unitId}=${item.sessionId}`).join(',')}`;
  // Three answers, not two: a tally, "we could not tell", and — while the read
  // is still in flight — nothing at all.
  useEffect(() => {
    if (!onNeedsGrownUp) return;
    if (!settled && !planUnknown) return;
    // Each entry carries its own named link, so the dashboard strip can list
    // every affected subject rather than send the parent to the first one.
    onNeedsGrownUp(learnerId, settled ? grownUpEntries.map((r) => {
      const action = grownUpActionFor(r.obligation.reason);
      return {
        reason: r.obligation.reason,
        subject: r.subject ?? null,
        headline: action.headline,
        href: grownUpHref(action.linkTo, learnerId, base, r, { attention, studyDay }),
      };
    }) : [], { known: settled });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- grownUpSignature stands in for grownUpEntries
  }, [onNeedsGrownUp, settled, planUnknown, learnerId, grownUpSignature, base, studyDay]);
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
          {activityLine && <span className="teacher-roster__activity">{activityLine}</span>}
          {coinLine && <span className="teacher-roster__coins">{coinLine}</span>}
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
      {/* PRINT, beside the thing that only PREVIEWS. The icon below opens the
          sheet on screen; this puts it on paper. Ordered BEFORE that icon
          because grid auto-placement is order-sensitive — once the column-3
          icon has taken row 1, a later column-2 item cannot backfill it and
          drops to a row of its own under the card. It belongs on the dashboard row
          because that is where a grown-up already is when a child cannot start
          their day — a lost NFC card, most often — and the alternative was
          drilling into that learner's Day panel to find the same control. */}
      <span className="teacher-roster__agenda-print">
        <AgendaDispatch learnerId={learnerId} learnerName={name} label="Print agenda" />
      </span>
      {/* THE AGENDA BELONGS ON THE CARD, not behind the disclosure. It is
          the child's paper for the day — the thing a parent reaches for
          before deciding whether to open anything at all — and it used to
          cost an accordion open plus a printable-agenda preview toggle to
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
      {settled && (
        <a className="teacher-btn teacher-btn--quiet teacher-roster__plan-link"
          href={teacherDayPath(learnerId, studyDay, base)}>
          {started ? `Open ${name}’s day →` : 'See today’s plan →'}
        </a>
      )}
      {/* WORK ONLY A GROWN-UP CAN MOVE (`GetTeacherToday`'s `attention`): a
          unit past the retry cap, or a failure left unretried for days. It
          stays listed every day until someone acts, and links straight to the
          failed session, where "Offer another try" lives. */}
      {(row.attention ?? []).length > 0 && (
        <ul className="teacher-roster__attention" data-testid="attention">
          {row.attention.map((item) => (
            <li key={item.sessionId} className="teacher-roster__attention-item">
              <a href={teacherSessionPath(learnerId, item.sessionId, base, { from: 'today' })}>
                {attentionLabel(item)}
              </a>
            </li>
          ))}
        </ul>
      )}
      {/* The kid's own words about today's work (advocacy wave 7):
          reflections used to be written and read by nobody. */}
      {(row.reflectionsToday ?? []).length > 0 && (
        <ul className="teacher-roster__reflections" data-testid="reflections">
          {(row.reflectionsToday ?? []).map((r, i) => (
             
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
          markedToday={markedToday} studyDay={studyDay} agenda={agenda} attention={attention}
          onOpenArtifact={openArtifact}
        />
      </div>}
    </div>
  );
}

export default function RosterStrip({ rows, kids, studyDay = null, onNeedsGrownUp = null, coinsByLearner = null }) {
  // Which learner is open lives in the URL (`?open=`), so the trip to a
  // lesson and back — or a refresh — returns to the same open card.
  const [openId, setOpenId] = useState(() => new URLSearchParams(globalThis.location?.search ?? '').get('open'));
  // Back/forward, or an in-console link that changes only `?open=` (the shell
  // announces those as popstate), must move the open card with the URL.
  useEffect(() => {
    const onPop = () => setOpenId(new URLSearchParams(window.location.search).get('open'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const toggle = (learnerId) => {
    const next = openId === learnerId ? null : learnerId;
    setOpenId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('open', next); else url.searchParams.delete('open');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  };
  // One small tally, keyed by learner, built entirely from what each entry
  // already fetched for its own agenda preview (plan 3.4) — never a second
  // fetch just to count what the roster already knows. `reportGrownUp` is
  // referentially stable (`useCallback`, no deps) so a re-render never looks
  // like a fresh report to the entries holding it.
  // `{ entries, known }` per learner, not a bare array: a learner whose plan
  // could not be read contributes no subjects AND must not be counted as a
  // quiet zero. The two are different facts and the dashboard shows both.
  const [grownUpByLearner, setGrownUpByLearner] = useState({});
  const reportGrownUp = useCallback((learnerId, entries, { known = true } = {}) => {
    setGrownUpByLearner((prev) => ({ ...prev, [learnerId]: { entries, known } }));
  }, []);
  // A primitive stand-in for `rows` (which is a fresh array reference on
  // every parent render whenever the caller derives it inline) — the
  // dashboard-report effect below must fire on an actual roster-order
  // change, never on an unrelated re-render.
  const rowOrder = rows.map((row) => row.learnerId).join('|');
  // The same stand-in for `kids`, which the strip's items read for names —
  // names included, so a rename refreshes the strip.
  const kidIds = kids.map((k) => `${k.id}=${k.name}`).join('|');
  useEffect(() => {
    if (!onNeedsGrownUp) return;
    // Count, unknowns and links all come from the SAME set — the learners on
    // the roster now. A report left behind by a learner who has since left
    // the roster used to keep counting while its links had gone.
    const reports = rows.map((row) => ({ row, report: grownUpByLearner[row.learnerId] }))
      .filter(({ report }) => Boolean(report));
    const count = reports.reduce((sum, { report }) => sum + (report.entries?.length ?? 0), 0);
    // Learners whose plan could not be read at all. The count above is short
    // by an unknown amount for each one, and saying so is the whole point.
    const unknown = reports.filter(({ report }) => report.known === false).length;
    // One link per affected subject, in roster order, each named for its
    // child — the strip used to carry a single href to the first learner.
    const items = reports.flatMap(({ row, report }) => (report.entries ?? [])
      .map((entry) => ({
        ...entry,
        learnerId: row.learnerId,
        name: kids.find((k) => k.id === row.learnerId)?.name ?? row.learnerId,
      })));
    onNeedsGrownUp({ count, unknown, items });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowOrder/kidIds stand in for `rows`/`kids`
  }, [grownUpByLearner, rowOrder, kidIds, onNeedsGrownUp]);
  // The strip must go quiet if the roster itself unmounts (a failed/loading
  // digest read) — a stale "N subjects need a grown-up" outliving its own
  // source is exactly the kind of ghost signal this panel model forbids. A
  // SEPARATE effect, deliberately not re-run by the report effect above: its
  // cleanup must fire only on a true unmount, never on every tally update.
  useEffect(() => (onNeedsGrownUp ? () => onNeedsGrownUp({ count: 0, unknown: 0, items: [] }) : undefined), [onNeedsGrownUp]);
  return (
    <div className="teacher-roster">
      {rows.map((row) => (
        <RosterEntry
          key={row.learnerId}
          row={row}
          kids={kids}
          studyDay={studyDay}
          open={openId === row.learnerId}
          onToggle={() => toggle(row.learnerId)}
          onNeedsGrownUp={reportGrownUp}
          coins={coinsByLearner?.[row.learnerId] ?? null}
        />
      ))}
    </div>
  );
}
