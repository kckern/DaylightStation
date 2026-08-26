/**
 * useScanCeremony — the on-screen acknowledgement for a scan on the locked
 * self-service panel (Slice D, omr-grading-integrity design). Subscribes to
 * the SAME `omr` topic `schoolPrintScanConsumer.mjs` (Slice C) already
 * re-broadcasts the terminal scan outcomes on — `scan-graded`,
 * `scan-review`, `scan-unresolved`, `scan-refused`, `scan-stale-sheet`,
 * `scan-not-recorded`, `scan-rows-unmarked` — plus `reader-error`, which `omrRelay.mjs` broadcasts
 * on the same topic for a reader-level failure (a sheet that never made it to
 * grading at all).
 *
 * KC's requirement: "a scan must always be acknowledged on screen." Success
 * already prints a receipt, so the failure paths are what matter here — a
 * child scanning alone has no other feedback channel, so every one of these
 * events must land as plain, child-readable words, never a blame or a bare
 * code. `scan-not-recorded` is the backstop that makes "every" literal: a
 * sheet that reaches the consumer and produces no ceremony of its own gets
 * that one, so no scan can end in silence.
 *
 * THE CEREMONY IS A FALLBACK, NOT A RECEIPT (2026-08-25).
 *
 * That "success already prints a receipt" clause used to be background; it is
 * now the rule. When a graded scan's result receipt REACHES PAPER, the paper
 * in the child's hand is the feedback, and this hook shows nothing: the
 * on-screen score was redundant, and a wall panel in a shared room announcing
 * "4 of 10" is a grade read out loud to whoever is standing there. The
 * ceremony survives for the case where the sheet was read but the outcome
 * never reached paper, and there it says *"I got your sheet, but something
 * else went wrong"* — deliberately WITHOUT the score, because the child's
 * next move is to fetch a grown-up, not to learn their mark from a wall.
 *
 * Only `scan-graded` is ever suppressed, and only on an explicit
 * `printed === true` from `schoolPrintScanConsumer.mjs` (which sources it
 * from `CloseSessionOutcome`'s `{printed, printReason}` — the same pair
 * `ReceiptPrinting.print()` returns). Every OTHER outcome shows regardless of
 * what `printed` says, because those are precisely the cases where nothing
 * came out of any printer and the screen is the only feedback that exists.
 * A missing `printed` (an older backend, a payload from anywhere else) shows
 * the ceremony too: silence is only ever correct when paper is KNOWN to have
 * arrived.
 *
 * A SECOND TOPIC, deliberately. `piano-lesson-complete` arrives on the
 * `school` bus (published by `PianoLessonCeremonyBridge`) rather than `omr`,
 * because it is not a scan and filing it under the scanner's topic would
 * make the bus lie about where events come from. It is handled here anyway:
 * the requirement — "a child working alone must SEE that it counted" — is
 * identical, and one banner system is easier to keep honest than two.
 * `story-read` (broadcast by `RecordStoryRead` when a story finishes on the
 * living-room TV) joins it on that topic for exactly the same reason.
 *
 * `agenda-suppressed` (Slice G, 2026-08-22-omr-grading-integrity) joins the
 * same five: a repeat NFC card tap inside the agenda print cooldown
 * (`learnerCardActions.mjs`'s print-agenda handler broadcasting
 * `ResolvePersonalCard`'s `agenda_suppressed` outcome) gets NO paper, but this
 * is that tap's only
 * acknowledgement — the exact rule the original five exist for, just off a
 * different source event.
 *
 * Follows the exact `useWebSocketSubscription` pattern `useSchoolLaunch.js`
 * uses for the same bus — no new transport. A message this hook cannot make
 * sense of (wrong event name, or any other traffic on `omr`) is the common
 * case, not an error, and is silently ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { schoolLog } from '../schoolLog.js';
import getLogger from '../../../lib/logging/Logger.js';

const TOPIC = 'omr';
// The School bus carries acknowledgements that are not scans — today the daily
// piano requirement being satisfied, which happens at the piano rather than at
// the scanner but must still land on the Portal's panel.
const SCHOOL_TOPIC = 'school';
const AUTO_CLEAR_MS = 12000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'scan-ceremony' });
  return _logger;
}

/**
 * Map one `omr` broadcast payload to a ceremony the panel can render, or
 * `null` if the payload isn't one of the outcomes this hook knows.
 *
 * Copy table (design brief, Slice D; `agenda-suppressed` added Slice G):
 *   scan-graded       → (nothing when the receipt printed — the paper says it)
 *   scan-graded       → warn     "I got your sheet"         "It's marked, but nothing printed. Tell a grown-up."
 *   scan-review       → warn     "Needs a grown-up"         "{count} had two answers filled in. Ask a grown-up to check it."
 *   scan-unresolved   → error    "Couldn't read that sheet" "The student number didn't come through. Try scanning again, slowly."
 *   scan-refused      → error    "That sheet doesn't match" "This paper doesn't line up with what's on file. Ask a grown-up."
 *   scan-not-recorded → error    "Already done"             "I read that sheet, but there was nothing new to mark."
 *   scan-rows-unmarked→ error    "Nothing filled in yet"    "Your new questions are rows {start}–{end}. Fill them in, then scan again."
 *   reader-error      → error    "Scanner hiccup"           "The scanner didn't catch that. Feed the sheet again."
 *   agenda-suppressed → warn     "Already printed"          "You already have today's agenda — check your desk."
 *   story-read        → success  "Story read!"              "{title} — that's another book today."
 *
 * `scan-review`'s payload (`schoolPrintScanConsumer.mjs`) carries a COUNT
 * (`pendingReview`) and an `itemId` list (`items`), never a friendly question
 * number — so the copy names how many questions need a look rather than
 * inventing a "{q}" the wire doesn't actually carry.
 */
function buildCeremony(payload) {
  const at = typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now();
  switch (payload?.event) {
    case 'scan-graded':
      // `receiptPrinted()` has already sent the printed case away; anything
      // reaching here is a sheet that was READ AND MARKED but whose result
      // never made it onto paper. No score: the child cannot act on a number
      // here, and the one thing they can act on is fetching a grown-up.
      // `warn` rather than `error` — nothing about their work went wrong.
      return {
        tone: 'warn',
        title: 'I got your sheet',
        detail: "It's marked, but nothing printed. Tell a grown-up.",
        at,
      };
    case 'scan-review': {
      const count = typeof payload.pendingReview === 'number'
        ? payload.pendingReview
        : (Array.isArray(payload.items) ? payload.items.length : 1);
      const noun = count === 1 ? 'One question' : `${count} questions`;
      return {
        tone: 'warn',
        title: 'Needs a grown-up',
        detail: `${noun} had two answers filled in. Ask a grown-up to check it.`,
        at,
      };
    }
    case 'scan-unresolved':
      return {
        tone: 'error',
        title: "Couldn't read that sheet",
        detail: "The student number didn't come through. Try scanning again, slowly.",
        at,
        code: payload.code ?? null,
      };
    case 'scan-refused':
      return {
        tone: 'error',
        title: "That sheet doesn't match",
        detail: "This paper doesn't line up with what's on file. Ask a grown-up.",
        at,
        code: payload.code ?? null,
      };
    case 'scan-not-recorded':
      // The sheet read fine and the child did nothing wrong — it had simply
      // already been marked, so there was no new work to bank and no score to
      // report. Before this existed the pipeline just went quiet here, which
      // is the one thing a scanner may never do (2026-08-25: three sheets fed,
      // room silent). `error` on the operator's call: it is not a score, and
      // the double-buzz is what says "that did not add anything" without
      // pretending a grade happened.
      return {
        tone: 'error',
        title: 'Already done',
        detail: 'I read that sheet, but there was nothing new to mark.',
        at,
      };
    case 'scan-rows-unmarked': {
      // The child's live worksheet got zero marks while the card's older,
      // already-graded rows still carry theirs — a cumulative card fed before
      // today's rows were filled in (2026-08-26, four sheets, silent room).
      //
      // `error`, not `warn`: this is the low double-buzz that says "that did
      // not work". A child glancing away from the screen has to be able to
      // tell from the SOUND alone that feeding the card achieved nothing —
      // that audible half is the entire reason this event exists, because the
      // backend used to return without broadcasting and the room stayed quiet.
      //
      // NOT `scan-refused`, whose copy sends the child to find a grown-up:
      // there is nothing wrong here and nothing an adult needs to resolve. The
      // fix is entirely the child's, and naming the row range is what makes it
      // actionable — on a cumulative card there is no other way to tell which
      // block of rows is this morning's.
      // A cumulative card can carry more than one unmarked live worksheet
      // (final review MINOR 4) — `rowRanges` names every one of them;
      // `rowRange` (the first) is kept as the fallback for a payload from an
      // older backend that never learned the plural shape.
      const ranges = Array.isArray(payload.rowRanges) && payload.rowRanges.length
        ? payload.rowRanges
        : (payload.rowRange ? [payload.rowRange] : []);
      const rowsText = ranges
        .filter((r) => typeof r?.start === 'number' && typeof r?.end === 'number')
        .map((r) => `rows ${r.start}–${r.end}`)
        .join(' and ');
      // A missing or malformed range must never cost the ceremony itself —
      // that would reproduce the silence this event was added to end.
      const rows = rowsText ? `Your new questions are ${rowsText}. ` : '';
      return {
        tone: 'error',
        title: 'Nothing filled in yet',
        detail: `${rows}Fill them in, then scan again.`,
        at,
      };
    }
    case 'scan-stale-sheet':
      // Every allocation on this card is retired — the paper in the child's
      // hand is an old printout, not a broken one. `warn` rather than
      // `error` because nothing malfunctioned and the fix is self-service:
      // scan the card, get a fresh sheet. Deliberately NOT `scan-refused`,
      // which sends the child to find a grown-up they do not need.
      return {
        tone: 'warn',
        title: 'That sheet is out of date',
        detail: 'Scan your card to print a fresh one, then try again.',
        at,
        code: payload.code ?? null,
      };
    case 'reader-error':
      return {
        tone: 'error',
        title: 'Scanner hiccup',
        detail: "The scanner didn't catch that. Feed the sheet again.",
        at,
      };
    case 'agenda-suppressed':
      // Not an error — the tap worked and the printer is fine, there is
      // simply nothing new to say yet. `warn` is the closest existing tone
      // ("pause — go get someone" per scanCeremonySound.js), which fits: the
      // next move for a child seeing this is to go look at their desk, not
      // to retry the tap.
      return {
        tone: 'warn',
        title: 'Already printed',
        detail: 'You already have today’s agenda — check your desk.',
        at,
      };
    case 'story-read':
      // A story finished at the living-room TV and the read is now in the
      // reading log. It reaches this panel for the same reason
      // `piano-lesson-complete` does — the work happened in another room, and
      // the child's day-board lives here — so it shares the same banner rather
      // than growing a second one.
      //
      // It names the BOOK and nothing else: no count, no target, no "1 of 2".
      // The reading screen in the living room already told the child where they
      // are, and a wall panel in a shared room announcing how far behind
      // somebody is on their reading is the same mistake as reading a grade out
      // loud (see the header). `success` — good news climbs.
      //
      // Never suppressed. `printed` is a graded-sheet concept; nothing about a
      // story read ever reaches paper, so there is no receipt to defer to.
      return {
        tone: 'success',
        title: 'Story read!',
        detail: payload.title
          ? `${payload.title} — that's another book today.`
          : "That's another book today.",
        at,
      };
    case 'piano-lesson-complete':
      // Not a scan at all: the child finished their assigned Hoffman lesson
      // at the piano and the day's music requirement is satisfied. It shares
      // this hook because it shares the need — an acknowledgement the child
      // can see from across the room — and because a second banner system
      // would be a second thing to keep consistent. `success` so it rings the
      // rising pair, the same "good news climbs" cue a graded sheet gets.
      return {
        tone: 'success',
        title: 'Piano done!',
        detail: payload.lesson
          ? `${payload.lesson} — that's your music for today.`
          : "That's your music for today.",
        at,
      };
    default:
      return null;
  }
}

/**
 * Did this outcome already reach the child ON PAPER?
 *
 * Scoped HARD to `scan-graded` on purpose. It is the only outcome that prints
 * anything — every other one is a sheet that produced no paper by definition —
 * so widening this predicate (or letting a stray `printed: true` on a
 * `scan-refused` payload through it) would silence exactly the events the
 * ceremony exists for. The check is `=== true`, never truthiness: an absent
 * field means "nobody told us", which is not the same as "yes".
 */
function receiptPrinted(payload) {
  return payload?.event === 'scan-graded' && payload.printed === true;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.autoClearMs] - how long a ceremony stays on screen
 *   before it self-clears (~12s, per the brief). A new scan always replaces
 *   whatever is currently showing and restarts the clock.
 * @returns {{ current: {tone,title,detail,at,code?}|null, clear: () => void }}
 */
export function useScanCeremony({ autoClearMs = AUTO_CLEAR_MS } = {}) {
  const [current, setCurrent] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    clearTimer();
    setCurrent(null);
  }, [clearTimer]);

  const handle = useCallback((payload) => {
    if (receiptPrinted(payload)) {
      // A SILENT SCREEN IS NOT A SILENT SYSTEM. The banner is suppressed
      // because paper carried the news, but the scan still has to be
      // traceable — otherwise "the panel showed nothing" becomes
      // indistinguishable from "the scan never arrived", which is the exact
      // ambiguity this whole ceremony was built to remove. `info`, not
      // `debug`: debug events are never shipped to the production log store,
      // so a debug line here would leave a suppressed scan with no trace at
      // all in the one place anyone would go looking. Whatever ceremony was
      // already up stays up — this event has nothing to say and so replaces
      // nothing.
      schoolLog.scan('scan-graded', { suppressed: 'receipt-printed' });
      return;
    }
    const ceremony = buildCeremony(payload);
    if (!ceremony) {
      logger().debug('ceremony-ignored', { event: payload?.event });
      return;
    }
    // A new scan always replaces whatever is showing — never queues, never
    // merges — so the panel only ever names the most recent thing that
    // happened.
    clearTimer();
    setCurrent(ceremony);
    schoolLog.scan(payload.event, { tone: ceremony.tone, title: ceremony.title, code: ceremony.code ?? null });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCurrent(null);
    }, autoClearMs);
  }, [autoClearMs, clearTimer]);

  useWebSocketSubscription(TOPIC, handle, [handle]);
  // Same handler, second topic. `buildCeremony` returns null for anything it
  // does not recognise, so ordinary School traffic on this bus is ignored the
  // same way ordinary `omr` traffic already is.
  useWebSocketSubscription(SCHOOL_TOPIC, handle, [handle]);

  // Unmount cleanup: nothing left running past the component's lifetime.
  useEffect(() => clearTimer, [clearTimer]);

  return { current, clear };
}

export default useScanCeremony;
