/**
 * AgendaStatusBoard — a read-only, at-a-glance board of every student's school
 * day: WHICH subjects are on the plan and which of them are done. The
 * per-subject discs carry the subject wall's own icons, so a kid walking past
 * reads their day as pictures rather than as a bar chart; one "x of y" in the
 * card's top corner carries the count, which is the one thing icons cannot say.
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
 * work is planned and done; the ring count says how much the child has MOVED
 * this week (Sunday 04:00 → Saturday 04:00). It is deliberately additive: the
 * measures request is fired alongside the per-learner plans and a failure
 * costs the number, never the card. v1 displays the figure only — no target,
 * no progress bar, no gate.
 *
 * The ring is STATIC here, for the same reason the cleared card is: nothing on
 * this panel moves. `RingIcon` spins only where motion is already the idiom —
 * inside the fitness app.
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
import { dayStatus, summarize, ringsByLearner } from './agendaStatusModel.js';

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

export default function AgendaStatusBoard({ kids = [], day }) {
  const [rows, setRows] = useState(null);
  const [nonce, setNonce] = useState(0);
  // Kept out of `rows` on purpose: the plan reads settle per-card and this one
  // covers the whole roster, so folding it in would mean re-settling every
  // card when it lands — and a slow measures read would hold the plans back.
  const [rings, setRings] = useState({});

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
    if (!kids.length || !day) return undefined;
    let alive = true;
    setRows(kids.map((kid) => ({ kid, summary: null, loading: true })));

    const settle = (kidId, summary) => {
      if (!alive) return;
      setRows((current) => (current ?? []).map((row) => (
        row.kid.id === kidId ? { ...row, summary, loading: false } : row
      )));
    };

    // The digest is one read for the whole roster; every learner's plan waits
    // on it only for the "what is already passed" half, so it is awaited once
    // and shared rather than refetched per card.
    const digest = (schoolApi.teacherDay ? schoolApi.teacherDay(day) : Promise.resolve({ ok: false }))
      .catch((error) => {
        schoolLog.selfServiceError?.('status-board.digest-failed', { error: error?.message });
        return { ok: false };
      });

    // Fired alongside the plans, never awaited by them. A failed or slow
    // measures read costs the ring numbers and nothing else.
    if (schoolApi.measuresWeekly) {
      schoolApi.measuresWeekly(day)
        .then((res) => { if (alive && res?.ok) setRings(ringsByLearner(res.data)); })
        .catch((error) => {
          schoolLog.selfServiceError?.('status-board.measures-failed', { error: error?.message });
        });
    }

    kids.forEach((kid) => {
      Promise.all([schoolApi.agendaPreview(kid.id, day), digest])
        .then(([plan, dayResponse]) => {
          if (!plan?.ok) return settle(kid.id, null);
          const learners = dayResponse.ok ? (dayResponse.data?.learners ?? []) : [];
          const sessions = learners.find((row) => row.learnerId === kid.id)?.sessions ?? [];
          return settle(kid.id, summarize(plan.data?.sections, sessions, plan.data?.entries));
        })
        .catch((error) => {
          schoolLog.selfServiceError?.('status-board.load-failed', { learnerId: kid.id, error: error?.message });
          settle(kid.id, null);
        });
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
   * A SCAN CHANGES THE BOARD NOW, not in up to five minutes.
   *
   * The poll above is the floor, not the mechanism. When a worksheet is scanned
   * its result receipt usually prints, and a printed receipt SUPPRESSES the
   * on-screen ceremony on purpose — the paper carries the news and the panel
   * must never show a score the report card will. The consequence, until now,
   * was that the most legible moment in the whole flow (a disc turning green)
   * was invisible to the child standing right there.
   *
   * So the board listens to the same `omr` topic the ceremony does and simply
   * re-reads. It does NOT paint the result from the payload: the payload
   * carries `percent`/`correctCount`, and re-reading keeps this board unable to
   * display a score even by accident. It also means one code path produces the
   * discs, so a pushed update and a polled one can never disagree.
   *
   * Any terminal scan outcome triggers it, not just a pass — a failed sheet
   * turns a disc yellow and that is just as much news.
   */
  const onScan = useCallback((payload) => {
    const event = payload?.event;
    if (!event || !String(event).startsWith('scan-')) return;
    schoolLog.scan('status-board.refresh', { event, learnerId: payload.learnerId ?? null });
    setNonce((n) => n + 1);
  }, []);
  useWebSocketSubscription('omr', onScan, [onScan]);

  const visible = useMemo(() => rows ?? [], [rows]);
  // Once EVERY card has settled with nothing to show, the board is not a
  // board — it steps off the panel entirely rather than standing there as
  // four empty rows. While anything is still loading it stays put.
  const settledEmpty = visible.length > 0
    && visible.every((row) => !row.loading && row.summary === null);
  if (!visible.length || settledEmpty) return null;
  return (
    <div className="school-status-board" data-testid="agenda-status-board">
      <h2 className="school-status-board__title">Today</h2>
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
            <div className="school-status-board__info">
              {/* ONE READOUT, top right. It used to be a status WORD there and
                  a count below the discs — two lines saying the same thing,
                  one of them in words the discs already show. The count is
                  what pictures cannot carry, so the count is what stays. */}
              {loading ? (
                <span className="school-status-board__status school-status-board__status--none">&nbsp;</span>
              ) : summary && summary.total > 0 ? (
                // AT 100% THE CHIP REPLACES THE COUNT. "5 of 5" makes a reader
                // do the comparison to learn the one thing that matters; the
                // chip says it. Below 100% the count is the more useful of the
                // two, because how much is left is exactly the open question.
                summary.done >= summary.total ? (
                  <span className="school-status-board__done-chip">Done for the day</span>
                ) : (
                  <span className="school-status-board__status">{summary.done} of {summary.total}</span>
                )
              ) : (
                <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
              )}
              {/* Rings this week. Rendered only once the number has arrived —
                  a placeholder zero would be a claim we cannot support yet,
                  and "0" and "not loaded" are different facts. Labelled "this
                  week" because a Sunday workout counts toward the NEXT week,
                  so this figure and the fitness app's own totals can honestly
                  differ for one day. */}
              {Number.isFinite(rings[kid.id]) && (
                <span className="school-status-board__rings" title="Rings this week">
                  <RingIcon size="1.1em" label={`${rings[kid.id]} rings this week`} />
                  <span className="school-status-board__rings-count">{rings[kid.id]}</span>
                </span>
              )}
              {/* SKELETON DISCS while the plan is in flight. Three is a guess
                  at the count and deliberately so — the row's height is what
                  has to be right, and it is fixed by the disc size, not by how
                  many there turn out to be. They shimmer so the panel reads as
                  working rather than as broken. */}
              {loading && (
                <ul className="school-status-board__pills" style={{ '--count': 3 }} aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="school-status-board__pill school-status-board__pill--skeleton" />
                  ))}
                </ul>
              )}
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
                         
                        key={`${segment.unitId ?? segment.subject}-${i}`}
                        className="school-status-board__pill"
                        data-state={segment.state}
                        // `data-done` kept alongside `data-state` for anything
                        // still selecting on the boolean; the tri-state is the
                        // one to read.
                        data-done={segment.state === 'passed' ? 'true' : 'false'}
                      >
                        <Icon
                          name={iconFor(segment.subject)}
                          label={`${segment.label}: ${
                            segment.state === 'passed' ? 'done'
                              : segment.state === 'needs-retry' ? 'try again'
                                : 'not done'
                          }`}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
