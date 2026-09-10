/**
 * AgendaStatusBoard — a read-only, at-a-glance board of every student's school
 * day: WHICH subjects are on the plan and which of them are done. The
 * per-assignment discs carry the subject wall's own icons, so a kid walking
 * past reads their day as pictures rather than as a bar chart. Extra completed
 * work owned by one assignment rides on that disc as a `+N` badge instead of
 * inflating the assigned day; one "x of y" carries the assignment count.
 *
 * A CLEARED DAY IS A STATE, NOT A SENTENCE. When every disc is filled the card
 * itself goes green — the child should be able to see they are finished from
 * across the room, without reading anything. That is the whole reward this
 * board offers.
 *
 * IT DOES NOT MOVE, and that is a settled decision rather than an omission.
 * The cleared card has been a breathing glow (which reads as blinking, because
 * it changes brightness) and a dot crawl (which holds luminance but still
 * pulls the eye). Both were distracting for the same reason: a wall panel sits
 * in peripheral vision all day, and anything moving there asks for attention
 * it does not need. Colour alone carries it. Do not re-add motion here.
 *
 * RINGS ARE A SECOND, INDEPENDENT READ (2026-08-26). The discs say what school
 * work is planned and done; the ring count comes from the active
 * `fitness.weekly-rings` State Gate progress projection. The request is fired
 * alongside the per-learner plans and a failure costs the number, never the
 * card.
 *
 * The ring is STATIC here, for the same reason the cleared card is: nothing on
 * this panel moves. `RingIcon` spins only where motion is already the idiom —
 * inside the fitness app.
 *
 * FITNESS NOW SPEAKS TWICE, and deliberately (2026-09-09). The chip is the
 * week's cumulative ring count; the workout DISC is a plain yes-or-no about
 * today, sitting in the subject row with the school work. They answer
 * different questions from different places on the card. The disc is
 * supplemental in the same sense reading is — pushed after the counts, never
 * pending, never amber, absent entirely on a day nobody worked out — because
 * physical education is credited, never assigned. See `agendaStatusModel.js`.
 *
 * Deliberately NON-INTERACTIVE (kiosk spec wave 5): it renders on the locked
 * Portal beside the keypad as a reminder/preview only — codes and printed
 * agendas remain the only entry path, so the rows accept no taps and the
 * board must never block or delay the keypad. It reads the same models the
 * teacher console uses: the agenda dry-run preview (the plan) and the teacher
 * day digest (what's done). Exported for reuse by adult surfaces that may
 * mount a more interactive variant later.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import RingIcon from '../../../lib/icons/RingIcon.jsx';
import Icon from '../home/icons/Icon.jsx';
import { hasIcon } from '../home/icons/iconRegistry.js';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import DayGrid from '../shared/dayGrid/DayGrid.jsx';
import { weekStart, addDays } from '../shared/dayGrid/dayGridModel.js';
import { dayStatus, summarize, ringProgressByLearner, triangleRows } from './agendaStatusModel.js';

const REFRESH_MS = 5 * 60_000;
const SCHOOL_REFRESH_EVENTS = new Set([
  'session-grade-changed',
  'story-read',
  'book-log-changed',
  'piano-lesson-complete',
  'program-day-bypass-changed',
]);

// The subject wall's own icon set, addressed by subject id (icons/MANIFEST.md:
// "filenames are the subject ids"), so the board and the wall say the same
// thing about `math` without a second mapping to keep in sync. An agenda can
// name a subject that is not one of the nine shelves — the planner's `other`
// bucket, a legacy id — and those get the school's own apple rather than a
// blank disc, because a segment with no mark reads as a rendering bug.
const FALLBACK_ICON = 'apple';
// Warned-about subjects, remembered for the life of the tab: this runs inside
// render on a board that repaints every five minutes forever, and a wall
// fixture must not turn one missing file into an endless log.
const warnedSubjects = new Set();
function iconFor(subject) {
  if (hasIcon(subject)) return subject;
  if (!warnedSubjects.has(subject)) {
    warnedSubjects.add(subject);
    schoolLog.surface('subject-icon-missing', { subject: subject ?? null });
  }
  return FALLBACK_ICON;
}

function labelForSegment(segment) {
  const state = segment.state === 'passed' ? 'done'
    : segment.state === 'needs-retry' ? 'try again'
      : segment.state === 'in-progress' ? 'in progress'
        : 'not done';
  const extra = segment.extraCount > 0
    ? `, ${segment.extraCount} extra ${segment.extraCount === 1 ? 'item' : 'items'} completed`
    : '';
  const reading = segment.readingActivity;
  const fitness = segment.fitnessActivity;
  const counts = reading ? [
    [reading.bookCount, 'book', 'books'], [reading.finishedCount, 'finish', 'finishes'], [reading.progressCount, 'progress entry', 'progress entries'],
  ] : fitness ? [
    [fitness.rings, 'ring', 'rings'],
  ] : [];
  const activity = counts
    .filter(([count]) => Number.isInteger(count) && count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`).join(', ');
  return `${segment.label}: ${state}${extra}${activity ? `, ${activity}` : ''}`;
}

/**
 * The assignments as bowling pins: rows from `triangleRows`, filled in the
 * order `summarize` returns them — reading order, top row first — so the
 * subject a child sees first today is the one they saw first yesterday.
 * Each row is its own list; the disc is decorative and the NAME rides on the
 * icon (Icon's `label` gives it role="img"), which keeps the list semantics.
 */
/** Rows nest (hex, √3/2) only when they differ by ONE disc: a row two wider
 * puts its middle disc straight under the one above, so that pair stacks
 * at a full pitch. The sum of the pitch factors is what the height math
 * needs; each row carries its own so the CSS can place it. */
const HEX = 0.8660254;
function pitchFactors(rows) {
  return rows.map((width, i) => (i === 0 ? 0 : ((width - rows[i - 1]) % 2 === 1 ? HEX : 1)));
}

function Pins({ segments }) {
  const rows = triangleRows(segments.length);
  const factors = pitchFactors(rows);
  const stack = factors.reduce((sum, f) => sum + f, 0);
  let cursor = 0;
  // `--base` and `--stack` size the disc: the base row must fit the width and
  // the stack (disc + Σ pitch) must fit the height; the disc is whichever is
  // smaller, capped.
  return (
    <div className="school-status-board__pins" style={{ '--base': Math.max(...rows), '--stack': stack }}>
      {rows.map((width, r) => {
        const slice = segments.slice(cursor, cursor + width);
        cursor += width;
        return (
          <ul key={r} className="school-status-board__pills" style={{ '--pitch': factors[r] }}>
            {slice.map((segment, i) => (
              <li
                // Two sections can share a subject; the index keeps the key
                // unique without pretending order is meaningful.
                key={`${segment.unitId ?? segment.subject}-${r}-${i}`}
                className="school-status-board__pill"
                data-state={segment.state}
                // `data-done` kept alongside `data-state` for anything still
                // selecting on the boolean; the tri-state is the one to read.
                data-done={segment.state === 'passed' ? 'true' : 'false'}
              >
                <Icon name={iconFor(segment.subject)} label={labelForSegment(segment)} />
                {segment.extraCount > 0 && (
                  <span className="school-status-board__extra" aria-hidden="true">
                    +{segment.extraCount}
                  </span>
                )}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

/**
 * The term as a grid, weeks as columns. `undefined` is in flight (a skeleton
 * of the right width), `null` is a failed read (nothing — a grid that lied
 * about a term would be worse than no grid), a term is drawn. The eighth row
 * appears only when a week carries week-level work.
 */
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The two axes around the term grid, on the SAME column template as the
 * cells so they line up by construction: week numbers above (every fourth
 * week — a digit per 8px column is not legible from a doorway), months
 * below at the column in which each month begins.
 */
function termAxes(weeks) {
  const weekNumbers = weeks.map((w, i) => (i % 4 === 0 ? String(i + 1) : ''));
  let lastMonth = null;
  const months = weeks.map((w) => {
    // The month a week belongs to is the month most of it is in: Thursday's.
    const thursday = new Date(Date.parse(`${w.weekId}T00:00:00Z`) + 3 * 86_400_000);
    const month = thursday.getUTCMonth();
    if (month === lastMonth) return '';
    lastMonth = month;
    return MONTH_SHORT[month];
  });
  return { weekNumbers, months };
}

function TermGrid({ term }) {
  if (term === null) return null;
  if (term === undefined || !term.from || !term.to) {
    return <div className="school-status-board__grid school-status-board__grid--skeleton" aria-hidden="true" />;
  }
  const weeks = Array.isArray(term.weeks) ? term.weeks : [];
  const hasWeeklyWork = weeks.some((w) => (w.asked ?? 0) > 0);
  const { weekNumbers, months } = termAxes(weeks);
  const axisStyle = { '--grid-cols': weeks.length };
  return (
    <div className="school-status-board__term-plot">
      <ol className="school-status-board__term-axis school-status-board__term-axis--weeks" style={axisStyle} aria-hidden="true">
        {weekNumbers.map((n, i) => <li key={weeks[i].weekId}>{n}</li>)}
      </ol>
      <DayGrid
        days={(term.days ?? []).map((d) => ({ studyDay: d.studyDay, state: d.state }))}
        orientation="weeks-as-columns"
        from={term.from}
        to={term.to}
        studyDay={term.today ?? null}
        highlightCurrentWeek
        extraRow={hasWeeklyWork ? weeks.map((w) => ({ weekId: w.weekId, state: w.state })) : null}
        className="school-status-board__grid"
        testId="board-term-grid"
        todayTestId="board-term-today"
        ariaLabel={`${term.label ?? 'This term'}: ${(term.days ?? []).filter((d) => d.state === 'met').length} days met`}
      />
      <ol className="school-status-board__term-axis school-status-board__term-axis--months" style={axisStyle} aria-hidden="true">
        {months.map((m, i) => <li key={weeks[i].weekId}>{m}</li>)}
      </ol>
    </div>
  );
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * THIS WEEK as seven squares: the term grid's current column turned on its
 * side, drawn from the SAME rows so the two cannot disagree, with the
 * weekday letters under it. Days after today are outlines, not verdicts.
 * Nothing while the term is in flight; nothing at all without one.
 */
function WeekStrip({ term }) {
  if (!term?.today) return null;
  const from = weekStart(term.today);
  const to = addDays(from, 6);
  const days = (term.days ?? []).filter((d) => d.studyDay >= from && d.studyDay <= to)
    .map((d) => ({ studyDay: d.studyDay, state: d.state }));
  return (
    <div className="school-status-board__week-strip" data-testid="board-week-strip">
      <DayGrid
        days={days.length ? days : [{ studyDay: term.today, state: 'unknown' }]}
        orientation="weeks-as-rows"
        from={from}
        to={to}
        studyDay={term.today}
        className="school-status-board__grid school-status-board__grid--week"
        testId="board-week-grid"
        todayTestId="board-week-today"
        ariaLabel={`This week: ${days.filter((d) => d.state === 'met').length} days met`}
      />
      <ol className="school-status-board__week-letters" aria-hidden="true">
        {WEEKDAY_LETTERS.map((letter, i) => <li key={i}>{letter}</li>)}
      </ol>
    </div>
  );
}

/**
 * The day's count as a SEGMENTED BAR — one segment per assignment, filled as
 * each is done — with the words beneath. A bar is the shape a child reads
 * from across a room; "2 of 7" is the shape an adult reads up close. At 100%
 * both give way to one word.
 */
function DayMeter({ summary }) {
  if (!summary || summary.total <= 0) return null;
  if (summary.done >= summary.total) {
    return <span className="school-status-board__done-chip" aria-label="Done for the day">Done</span>;
  }
  return (
    <div className="school-status-board__meter" data-testid="board-day-meter">
      <div
        className="school-status-board__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.done}
        aria-label={`${summary.done} of ${summary.total} done`}
        style={{ '--segments': summary.total }}
      >
        {Array.from({ length: summary.total }, (_, i) => (
          <span key={i} className={`school-status-board__segment${i < summary.done ? ' is-done' : ''}`} />
        ))}
      </div>
      <span className="school-status-board__status">{summary.done} of {summary.total}</span>
    </div>
  );
}

export default function AgendaStatusBoard({ kids = [], day }) {
  const [rows, setRows] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [studyDay, setStudyDay] = useState(day ?? null);
  // Kept out of `rows` on purpose: the plan reads settle per-card and this one
  // covers the whole roster, so folding it in would mean re-settling every
  // card when it lands — and a slow State Gates read would hold the plans back.
  const [rings, setRings] = useState({});
  // The term grid, per learner: `undefined` while in flight, `null` when the
  // read failed (the card then simply has no term), else the term read model.
  // Settles independently, like the rings — the server replays today and
  // yesterday on every read and serves the rest from its cache.
  const [terms, setTerms] = useState({});
  const rosterIds = useMemo(() => new Set(kids.map((kid) => kid.id)), [kids]);

  /**
   * ONE CARD PER KID FROM THE FIRST PAINT, filled in as each read lands.
   *
   * This used to `Promise.all` the day digest and every learner's agenda and
   * render nothing at all until the slowest one returned. Measured against the
   * real Portal: the digest is ~150ms, and a learner with no open work answers
   * in ~70ms — but a learner whose day still holds a PROGRAM subject (piano,
   * whose launcher resolves against Plex) takes ~1s, so the whole board sat
   * blank for as long as the slowest child's plan took. Four kids, four blank
   * seconds, nothing on screen to say the panel was even working.
   *
   * The roster is known synchronously, so the cards, their rails, and their
   * disc rows are drawn immediately as skeletons and each one swaps its own
   * contents in place. Nothing moves when a plan arrives — the card was
   * already the size it is going to be — and one slow learner no longer holds
   * the other three hostage. It also stops being all-or-nothing: a single
   * failed read now costs that learner's card, not the board.
   */
  useEffect(() => {
    if (!kids.length) return undefined;
    let alive = true;
    setRows(kids.map((kid) => ({ kid, summary: null, loading: true })));

    const settle = (kidId, summary) => {
      if (!alive) return;
      setRows((current) => (current ?? []).map((row) => (
        row.kid.id === kidId ? { ...row, summary, loading: false } : row
      )));
    };

    // The digest supplies one authoritative study day and the completed
    // evidence for the whole roster, shared rather than refetched per card.
    const digest = (schoolApi.teacherDay ? (day ? schoolApi.teacherDay(day) : schoolApi.teacherDay()) : Promise.resolve({ ok: false }))
      .catch((error) => {
        schoolLog.selfServiceError?.('status-board.digest-failed', { error: error?.message });
        return { ok: false };
      });

    // Fired alongside the plans, never awaited by them. A failed or slow
    // State Gates read costs the ring numbers and nothing else.
    if (schoolApi.stateGates) {
      schoolApi.stateGates({ gateId: 'fitness.weekly-rings', periodKind: 'interval' })
        .then((res) => {
          if (!alive) return;
          setRings(res?.ok ? ringProgressByLearner(res.data) : {});
        })
        .catch((error) => {
          if (alive) setRings({});
          schoolLog.selfServiceError?.('status-board.state-gates-failed', { error: error?.message });
        });
    }

    // The term, one read per learner, never awaited by the plan. A failed
    // read costs that card's grid and nothing else.
    setTerms({});
    if (schoolApi.learnerTerm) {
      kids.forEach((kid) => {
        schoolApi.learnerTerm(kid.id)
          .then((res) => {
            if (!alive) return;
            setTerms((current) => ({ ...current, [kid.id]: res?.ok ? res.data : null }));
          })
          .catch((error) => {
            if (alive) setTerms((current) => ({ ...current, [kid.id]: null }));
            schoolLog.selfServiceError?.('status-board.term-failed', { learnerId: kid.id, error: error?.message });
          });
      });
    }

    // A live board uses the household study day, including its pre-4am
    // boundary. Each learner settles independently after the shared digest.
    kids.forEach(async (kid) => {
      const dayResponse = await digest;
      if (!alive) return;
      const effectiveDay = day ?? dayResponse?.data?.studyDay;
      setStudyDay(effectiveDay ?? null);
      const learner = dayResponse?.ok
        ? dayResponse.data?.learners?.find((row) => row.learnerId === kid.id) : null;
      const readingActivity = learner?.readingActivity ?? null;
      const fitnessActivity = learner?.fitnessActivity ?? null;
      const settleWithoutPlan = () => {
        const summary = summarize([], [], [], readingActivity, fitnessActivity);
        settle(kid.id, summary.segments.length ? summary : null);
      };
      try {
        const plan = await schoolApi.agendaPreview(kid.id, effectiveDay);
        if (!plan?.ok) return settleWithoutPlan();
        settle(kid.id, summarize(plan.data?.sections, learner?.sessions ?? [], plan.data?.entries, readingActivity, fitnessActivity));
      } catch (error) {
        schoolLog.selfServiceError?.('status-board.load-failed', { learnerId: kid.id, error: error?.message });
        settleWithoutPlan();
      }
    });
    return () => { alive = false; };
  }, [kids, day, nonce]);

  // Periodic refresh — minutes, not seconds; a hidden panel refreshes nothing.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNonce((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * COMPLETED WORK CHANGES THE BOARD NOW, not in up to five minutes.
   *
   * The poll above is the floor, not the mechanism. When a worksheet is scanned
   * its result receipt usually prints, and a printed receipt SUPPRESSES the
   * on-screen ceremony on purpose — the paper carries the news and the panel
   * must never show a score the report card will. The consequence, until now,
   * was that the most legible moment in the whole flow (a disc turning green)
   * was invisible to the child standing right there.
   *
   * So the board listens to the same `omr` topic the ceremony does and to the
   * School events emitted by story time, piano, and program bypasses, then
   * simply re-reads. It does NOT paint a result from the payload: the payload
   * carries `percent`/`correctCount`, and re-reading keeps this board unable to
   * display a score even by accident. It also means one code path produces the
   * discs, so a pushed update and a polled one can never disagree.
   *
   * Any terminal scan outcome triggers it, not just a pass — a failed sheet
   * turns a disc yellow and that is just as much news. School events are scoped
   * to the displayed roster; story reads are also scoped to this study day.
   */
  const onScan = useCallback((payload) => {
    const event = payload?.event;
    if (!event || !String(event).startsWith('scan-')) return;
    schoolLog.scan('status-board.refresh', {
      source: 'omr', event, learnerId: payload.learnerId ?? null, studyDay,
    });
    setNonce((n) => n + 1);
  }, [studyDay]);
  useWebSocketSubscription('omr', onScan, [onScan]);

  const onSchool = useCallback((payload) => {
    const event = payload?.event;
    if (!SCHOOL_REFRESH_EVENTS.has(event)) return;
    const learnerId = payload?.learnerId ?? null;
    if (!learnerId || !rosterIds.has(learnerId)) return;

    const eventStudyDay = payload?.studyDay ?? payload?.studyDate ?? null;
    if (event === 'story-read' && eventStudyDay && eventStudyDay !== studyDay) return;

    schoolLog.selfService('status-board.refresh', {
      source: 'school', event, learnerId, studyDay: eventStudyDay ?? studyDay,
    });
    setNonce((n) => n + 1);
  }, [studyDay, rosterIds]);
  useWebSocketSubscription('school', onSchool, [onSchool]);

  const onStateGates = useCallback((event) => {
    const current = event?.payload?.current;
    const gateId = current?.gateId ?? event?.payload?.gateId ?? null;
    if (gateId !== 'fitness.weekly-rings') return;
    const learnerId = current?.subject?.id ?? event?.payload?.subject?.id ?? null;
    if (learnerId && !rosterIds.has(learnerId)) return;
    schoolLog.selfService('status-board.refresh', {
      source: 'state-gates', event: event?.kind ?? null, learnerId,
    });
    setNonce((n) => n + 1);
  }, [rosterIds]);
  useWebSocketSubscription('state-gates', onStateGates, [onStateGates]);

  const visible = useMemo(() => rows ?? [], [rows]);
  // Once EVERY card has settled with nothing to show, the board is not a
  // board — it steps off the panel entirely rather than standing there as
  // four empty rows. While anything is still loading it stays put.
  const settledEmpty = visible.length > 0
    && visible.every((row) => !row.loading && row.summary === null);
  if (!visible.length || settledEmpty) return null;
  return (
    <div className="school-status-board" data-testid="agenda-status-board">
      {/* One card per student, equal height whether or not a plan loaded —
          the board is a wall fixture, and four uneven rows read as broken. */}
      <ul className="school-status-board__rows">
        {visible.map(({ kid, summary, loading }) => (
          <li
            key={kid.id}
            className={`school-status-board__row${loading ? ' is-loading' : ''}`}
            data-status={summary ? dayStatus(summary) : null}
            data-complete={summary && summary.total > 0 && summary.done >= summary.total ? 'true' : 'false'}
            aria-busy={loading ? 'true' : undefined}
          >
            {/* THE NAME RIDES WITH THE FACE. Together they are one rail — who
                this card belongs to — which frees the whole width of the card
                for the day itself, and lets the avatar grow into the height
                the name used to take out of the row. */}
            <div className="school-status-board__rail">
              <span className="school-status-board__name">{kid.name}</span>
              <ProfileAvatar id={kid.id} name={kid.name} size={192} />
            </div>
            {/* THE DAY: the assignments as a bowling-pin triangle, with the
                count under the pins. Time widens left to right across the
                card — who, today, this week, the term — and each partition
                is one thing with its own number inside it, not a count
                floating away from the thing it counts. */}
            <div className="school-status-board__day" data-testid="board-day">
              <h3 className="school-status-board__part-title">Today</h3>
              {loading ? (
                // SKELETON PINS while the plan is in flight — a three-disc
                // pyramid, the row's height fixed by the disc size rather than
                // by how many there turn out to be. They shimmer so the panel
                // reads as working rather than as broken.
                <div className="school-status-board__pins" aria-hidden="true">
                  {[[0], [1, 2]].map((row, r) => (
                    <ul key={r} className="school-status-board__pills">
                      {row.map((i) => <li key={i} className="school-status-board__pill school-status-board__pill--skeleton" />)}
                    </ul>
                  ))}
                </div>
              ) : summary && summary.segments.length > 0 ? (
                <Pins segments={summary.segments} />
              ) : null}
              {/* THE METER, under the pins: a segmented bar with the words
                  beneath, or one word at 100%. */}
              {loading ? (
                <span className="school-status-board__status school-status-board__status--none">&nbsp;</span>
              ) : summary && summary.total > 0 ? (
                <DayMeter summary={summary} />
              ) : (
                <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
              )}
            </div>
            {/* THIS WEEK: the fitness rings. Rendered only once the number has
                arrived — a placeholder zero would be a claim we cannot support
                yet, and "0" and "not loaded" are different facts. The count
                stands alone until a weekly goal is authored (see
                `ringProgressByLearner`). */}
            <div className="school-status-board__week" data-testid="board-week">
              <h3 className="school-status-board__part-title">This week</h3>
              <WeekStrip term={terms[kid.id]} />
              {Number.isFinite(rings[kid.id]?.current) && (
                <span className="school-status-board__rings" title="Rings this week">
                  <RingIcon size="1.6em" label={`${rings[kid.id].current} rings this week`} />
                  <span className="school-status-board__rings-count">
                    {rings[kid.id].current}
                    {Number.isFinite(rings[kid.id].target) ? ` of ${rings[kid.id].target}` : ''}
                  </span>
                </span>
              )}
            </div>
            {/* THE TERM: every day since September, one square each, weeks as
                columns. Blank-but-present while loading, so the card is the
                width it is going to be from the first paint. */}
            <div className="school-status-board__term" data-testid="board-term">
              <h3 className="school-status-board__part-title">This term</h3>
              <TermGrid term={terms[kid.id]} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
