/**
 * useScanCeremony — the on-screen acknowledgement for a scan on the locked
 * self-service panel (Slice D, omr-grading-integrity design). Subscribes to
 * the SAME `omr` topic `schoolPrintScanConsumer.mjs` (Slice C) already
 * re-broadcasts the four terminal scan outcomes on — `scan-graded`,
 * `scan-review`, `scan-unresolved`, `scan-refused` — plus `reader-error`,
 * which `omrRelay.mjs` broadcasts on the same topic for a reader-level
 * failure (a sheet that never made it to grading at all).
 *
 * KC's requirement: "a scan must always be acknowledged on screen." Success
 * already prints a receipt, so the failure paths are what matter here — a
 * child scanning alone has no other feedback channel, so every one of these
 * five events must land as plain, child-readable words, never a blame or a
 * bare code.
 *
 * `agenda-suppressed` (Slice G, 2026-08-22-omr-grading-integrity) joins the
 * same five: a repeat NFC card tap inside the agenda print cooldown
 * (`nfcTapIngress.mjs` broadcasting `ResolvePersonalCard`'s
 * `agenda_suppressed` outcome) gets NO paper, but this is that tap's only
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
 *   scan-graded       → success  "Scored!"                 "{n} of {m} right — your sheet is printing."
 *   scan-review       → warn     "Needs a grown-up"         "{count} had two answers filled in. Ask a grown-up to check it."
 *   scan-unresolved   → error    "Couldn't read that sheet" "The student number didn't come through. Try scanning again, slowly."
 *   scan-refused      → error    "That sheet doesn't match" "This paper doesn't line up with what's on file. Ask a grown-up."
 *   reader-error      → error    "Scanner hiccup"           "The scanner didn't catch that. Feed the sheet again."
 *   agenda-suppressed → warn     "Already printed"          "You already have today's agenda — check your desk."
 *
 * `scan-review`'s payload (`schoolPrintScanConsumer.mjs`) carries a COUNT
 * (`pendingReview`) and an `itemId` list (`items`), never a friendly question
 * number — so the copy names how many questions need a look rather than
 * inventing a "{q}" the wire doesn't actually carry.
 */
function buildCeremony(payload) {
  const at = typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now();
  switch (payload?.event) {
    case 'scan-graded': {
      // ROW counts (`schoolPrintScanConsumer.mjs`'s session-sourced
      // correctCount/totalCount), the same numbers the gradebook and report
      // card use — never the card's points aggregate.
      const { correctCount, totalCount } = payload;
      const hasScore = typeof correctCount === 'number' && typeof totalCount === 'number';
      return {
        tone: 'success',
        title: 'Scored!',
        detail: hasScore
          ? `${correctCount} of ${totalCount} right — your sheet is printing.`
          : 'Your sheet is printing.',
        at,
      };
    }
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
    default:
      return null;
  }
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

  // Unmount cleanup: nothing left running past the component's lifetime.
  useEffect(() => clearTimer, [clearTimer]);

  return { current, clear };
}

export default useScanCeremony;
