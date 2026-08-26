/**
 * AgendaStatusBoard — a read-only, at-a-glance board of every student's school
 * day: WHICH subjects are on the plan, which of them are done, and a status
 * word. The per-subject segments carry the subject wall's own icons, so a kid
 * walking past reads their day as pictures rather than as a bar chart; the
 * "x of y" line stays because a count is the one thing icons cannot say.
 *
 * Deliberately NON-INTERACTIVE (kiosk spec wave 5): it renders on the locked
 * Portal beside the keypad as a reminder/preview only — codes and printed
 * agendas remain the only entry path, so the rows accept no taps and the
 * board must never block or delay the keypad. It reads the same models the
 * teacher console uses: the agenda dry-run preview (the plan) and the teacher
 * day digest (what's done). Exported for reuse by adult surfaces that may
 * mount a more interactive variant later.
 */
import { useEffect, useMemo, useState } from 'react';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import Icon, { hasIcon } from '../home/icons/Icon.jsx';
import { subjectLabel } from '../home/subjects.js';
import { labelize } from '../teacher/labelize.js';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

const REFRESH_MS = 5 * 60_000;

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

// Shelf label where there is a shelf, humanized slug otherwise. This is the
// segment's ONLY name now that the tile carries no text, so it has to be
// speakable for every id the agenda can hand us, not just the nine.
function nameFor(subject) {
  const label = subjectLabel(subject);
  return label === subject ? labelize(subject) : label;
}

export function dayStatus({ total, done }) {
  if (!total) return null;
  if (done >= total) return 'Done for the day';
  if (done > 0) return 'In progress';
  return 'Not started';
}

// The plan ∪ the outcomes, per learner: agenda sections (suppressed ones
// excluded) matched against passed sessions by subject. This is the coarse
// counting version; the teacher workspace's Learner Day does the same join
// per-row and by unit id (teacher/learnerDay.js#joinLearnerDay), because a
// subject key double-counts a unit the planner bucketed into 'other'.
export function summarize(sections, sessions) {
  const planned = (sections ?? []).filter((section) => !section.suppressed);
  const passedSubjects = new Set((sessions ?? [])
    .filter((session) => session.outcome?.result === 'passed')
    .map((session) => session.subject));
  // The board draws one segment PER SUBJECT now, so the join has to survive as
  // a list and not collapse straight to a count: which subject is done is the
  // whole point of the icons. `total`/`done` stay derived from it so the
  // status word and the "x of y" readout cannot drift from the segments.
  const segments = planned.map((section) => ({
    subject: section.subject,
    label: nameFor(section.subject),
    done: Boolean(section.servedToday || passedSubjects.has(section.subject)),
  }));
  return { total: segments.length, done: segments.filter((s) => s.done).length, segments };
}

export default function AgendaStatusBoard({ kids = [], day }) {
  const [rows, setRows] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!kids.length || !day) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const [dayResponse, ...plans] = await Promise.all([
          schoolApi.teacherDay ? schoolApi.teacherDay(day) : Promise.resolve({ ok: false }),
          ...kids.map((kid) => schoolApi.agendaPreview(kid.id, day)),
        ]);
        if (!alive) return;
        const learners = dayResponse.ok ? (dayResponse.data?.learners ?? []) : [];
        const next = kids.map((kid, index) => {
          const plan = plans[index];
          if (!plan?.ok) return { kid, summary: null };
          const sessions = learners.find((row) => row.learnerId === kid.id)?.sessions ?? [];
          return { kid, summary: summarize(plan.data?.sections, sessions) };
        });
        setRows(next.every((row) => row.summary === null) ? null : next);
      } catch (error) {
        if (!alive) return;
        schoolLog.selfServiceError?.('status-board.load-failed', { error: error?.message });
        setRows(null);
      }
    };
    load();
    return () => { alive = false; };
  }, [kids, day, nonce]);

  // Periodic refresh — minutes, not seconds; a hidden panel refreshes nothing.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNonce((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(() => rows ?? [], [rows]);
  if (!visible.length) return null;
  return (
    <div className="school-status-board" data-testid="agenda-status-board">
      <h2 className="school-status-board__title">Today</h2>
      {/* One card per student, equal height whether or not a plan loaded —
          the board is a wall fixture, and four uneven rows read as broken. */}
      <ul className="school-status-board__rows">
        {visible.map(({ kid, summary }) => (
          <li key={kid.id} className="school-status-board__row" data-status={summary ? dayStatus(summary) : null}>
            <ProfileAvatar id={kid.id} name={kid.name} size={192} />
            <div className="school-status-board__info">
              <div className="school-status-board__line">
                <span className="school-status-board__name">{kid.name}</span>
                {summary && summary.total > 0 ? (
                  <span className="school-status-board__status">{dayStatus(summary)}</span>
                ) : (
                  <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
                )}
              </div>
              {summary && summary.total > 0 && (
                <>
                  {/* The segments used to be an anonymous meter, hidden from
                      assistive tech because they said nothing a sighted reader
                      could not get from the count. Carrying a subject icon
                      makes each one a fact of its own — so it has to be
                      readable too. The disc is decorative; the NAME rides on
                      the icon (Icon's `label` gives it role="img"), which
                      keeps the list semantics of the row intact. */}
                  {/* The count is a LAYOUT input, not decoration: CSS cannot
                      count its own children, and the discs divide the row
                      between themselves so a nine-subject day fits one line
                      (School.scss, `&__pill`). */}
                  <ul
                    className="school-status-board__pills"
                    style={{ '--count': summary.segments.length }}
                  >
                    {summary.segments.map((segment, i) => (
                      <li
                        // Two sections can share a subject; the index keeps the
                        // key unique without pretending order is meaningful.
                        // eslint-disable-next-line react/no-array-index-key -- order stable within one fetch
                        key={`${segment.subject}-${i}`}
                        className="school-status-board__pill"
                        data-done={segment.done ? 'true' : 'false'}
                      >
                        <Icon
                          name={iconFor(segment.subject)}
                          label={`${segment.label}: ${segment.done ? 'done' : 'not done'}`}
                        />
                      </li>
                    ))}
                  </ul>
                  <span className="school-status-board__count">{summary.done} of {summary.total}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
