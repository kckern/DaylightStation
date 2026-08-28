/**
 * useCheckpointGate — the school-side gate AUTHORITY for a media lesson.
 *
 * A gated lesson stops at authored positions and will not resume until the
 * child answers. This module decides when that is true. It produces a
 * `GateVerdict` and nothing else: it never touches a media element, never
 * pauses anything, never seeks. `useMediaGate` (decide→enforce) and
 * `mediaGate` (enforce) do that, and the split is what lets a lesson be gated
 * by this AND by household governance at the same time without either knowing
 * the other exists. It is the school counterpart of fitness's
 * `GovernanceEngine`, and like it, it is a producer of verdicts.
 *
 * ## TWIN — keep in step with `backend/src/2_domains/school/mediaCheckpoints.mjs`
 *
 * The arithmetic below is a hand-written copy of that module's `dueCheckpoint`
 * / `seekCeilingFor`, duplicated for the same reason `SUBJECT_IDS` is
 * duplicated between `curriculum/unitValidation.mjs` and
 * `School/home/subjects.js`: frontend code cannot import a backend domain
 * module. The two must change together — the backend is the AUTHORITY (it
 * refuses `media_completed` while checkpoints are outstanding), this copy is
 * what makes the stop happen in front of the child instead of only in the
 * ledger. Three details are load-bearing and are copied deliberately:
 *
 *   1. `at <= position` is INCLUSIVE — a playhead reporting 312.0 has played
 *      the second before it, so the checkpoint authored at 312 has fired.
 *   2. FIRST uncleared, not nearest — a child who seeks to the end still owes
 *      every checkpoint on the way, in order, one at a time.
 *   3. Ids are `cp-<at>`, derived from the authored position, never an index.
 *
 * ## Three decisions, and why
 *
 * **No `useMemo`.** The derivation is a couple of `find`s over at most
 * `MAX_CHECKPOINTS` (20) entries, and its main input — `position` — changes
 * several times a second, so a memo would recompute on nearly every render
 * that matters while adding a deps array and a comparison to every one that
 * does not. It would also be a false promise of stability: callers build
 * `clearedIds` from a fetched array, so the memo would miss on identity alone.
 * Nothing downstream needs the identity anyway. `useMediaGate` stabilizes the
 * DECISION by comparing five scalar fields, so a fresh verdict object per
 * render cannot cause a re-application (that hook's §4 explains why it had to
 * be done there and not here — no input shape can churn past a value compare).
 * And `dueCheckpoint` is the AUTHORED entry itself, not a wrapper, so it is
 * already reference-stable for as long as the checkpoint list is — a consumer
 * may put it in a dependency array.
 *
 * **A cleared checkpoint never pulses.** `approaching` warns that playback is
 * about to stop, ~5s out, so nothing stops without warning. It is computed
 * from the first UNCLEARED checkpoint only. The case that decides it is the
 * rewind: a child who answers, chooses "rewind and rewatch" and replays the
 * passage crosses that same position again — pulsing there would promise a
 * stop that cannot come, and the checkpoint-map chrome would be pulsing a node
 * it is simultaneously drawing as ✓. A warning that fires when nothing happens
 * teaches a child to ignore warnings. For the same reason the pulse stops once
 * the checkpoint has actually fired: it is a warning, not a state.
 *
 * **Malformed input never throws, and the safe direction differs per field.**
 * This runs on a kiosk in front of a child, so every branch degrades instead:
 *   - Unknown CLEARANCE (`clearedIds` null, a number, a string) → nothing is
 *     cleared, so the gate re-asks. Same rule, same reason, as the server's
 *     `clearedSetFrom`: for a gate, re-asking is the cheap failure.
 *   - An unusable checkpoint LIST (null, absent, empty, not an array) → no
 *     gate. Blocking here would be a fail-closed with no way out: there is no
 *     question to present, so the child would sit in front of a frozen video
 *     with no overlay and no answer that could release it, and every ungated
 *     lesson (which passes no checkpoints at all) would freeze too. It is also
 *     not the hole it looks like — the backend refuses `media_completed` while
 *     checkpoints are outstanding, so a client that lost its list cannot claim
 *     credit for the lesson. That is where the hard guarantee lives.
 *   - A single entry with no usable `at` is SKIPPED — it cannot be positioned,
 *     so it can never fire and would otherwise deadlock the lesson forever;
 *     its neighbours still gate normally.
 *   - An unknown `position` (before the element reports one) blocks nothing,
 *     but the seek ceiling is still reported — mirroring the server, where the
 *     ceiling is a property of the work owed, not of where the child is.
 */

import { useEffect, useRef } from 'react';
import { GATE_ID } from '../../../lib/Player/gate/gateIds.js';
import getLogger from '../../../lib/logging/Logger.js';

// Lazy module logger — `getLogger()` at import time binds before the app has
// configured the logger (CLAUDE.md, "Module-Level Loggers").
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'school', component: 'checkpoint-gate' });
  return _logger;
}

/**
 * How far ahead the chrome warns. Five seconds is long enough for a child to
 * read the pulse and short enough that it still belongs to the checkpoint it
 * announces.
 */
export const APPROACH_WINDOW_S = 5;

const EMPTY = Object.freeze([]);

const isUsableString = (v) => typeof v === 'string' && v.trim().length > 0;

/** The authored second, or null when this entry cannot be positioned at all. */
const atOf = (cp) => (cp && Number.isFinite(cp.at) ? cp.at : null);

/**
 * The entry's id. Prefer what the payload carries; derive `cp-<at>` only when
 * it carries none — the same spelling the server uses, so a cleared id round
 * trips even against a payload that shipped positions without ids.
 */
const idOf = (cp, at) => (isUsableString(cp.id) ? cp.id : `cp-${at}`);

/** Attach a derived id WITHOUT losing the authored object's identity when it already had one. */
const withId = (cp, id) => (cp.id === id ? cp : { ...cp, id });

/** Tolerant of a Set, an array, or garbage — garbage means nothing is cleared. */
const toClearedSet = (clearedIds) => {
  if (clearedIds instanceof Set) return clearedIds;
  if (Array.isArray(clearedIds)) return new Set(clearedIds.filter(isUsableString));
  return new Set();
};

/**
 * The whole derivation, framework-free — the hook below is a logging wrapper
 * around this. Exported so the arithmetic can be tested without React.
 *
 * @param {object} [input]
 * @param {number} [input.position] playhead in seconds
 * @param {Array<{id?: string, at: number}>} [input.checkpoints] authored list
 * @param {Set<string>|string[]} [input.clearedIds] ids this learner has cleared
 * @returns {{verdict: import('../../../lib/Player/gate/pauseArbiter.js').GateVerdict,
 *            dueCheckpoint: object|null, approaching: boolean}}
 */
export function deriveCheckpointGate({ position, checkpoints, clearedIds } = {}) {
  const cleared = toClearedSet(clearedIds);
  const list = Array.isArray(checkpoints) ? checkpoints : EMPTY;
  const known = Number.isFinite(position);

  // Two independent passes, exactly as the server has two independent
  // functions. Collapsing them into one loop that stops at the first uncleared
  // entry would agree with the server on every ASCENDING list and disagree on
  // an out-of-order one — in the direction of not blocking, which is the
  // direction that lets a child through.
  let due = null;
  let seekCeiling = null;
  for (const raw of list) {
    const at = atOf(raw);
    if (at === null) continue;                       // cannot be positioned; can never fire
    const id = idOf(raw, at);
    if (cleared.has(id)) continue;
    if (seekCeiling === null) seekCeiling = at;
    if (due === null && known && at <= position) due = withId(raw, id);
  }

  const blocked = due !== null;
  const approaching = !blocked
    && known
    && seekCeiling !== null
    && position < seekCeiling
    && (seekCeiling - position) <= APPROACH_WINDOW_S;

  return {
    // `id`, NOT `reason` — the arbiter reads `id` and falls back to the string
    // 'gate' without it, which produces a gate that blocks correctly and is
    // anonymous in the logs. See pauseArbiter's `GateVerdict`.
    verdict: { blocked, id: GATE_ID.CHECKPOINT, seekCeiling },
    dueCheckpoint: due,
    approaching
  };
}

/**
 * React binding. Adds exactly one thing to `deriveCheckpointGate`: an EDGE log.
 * Logging inside the derivation would emit several times a second as the
 * playhead ticks; on this kiosk the log store is the only record of why a
 * lesson stopped, and a per-tick stream is not a record.
 *
 * @param {object} [opts] same shape as `deriveCheckpointGate`, plus:
 * @param {object} [opts.logger] logger override — pass the lesson's child
 *   logger so gate events inherit its session-log routing.
 */
export function useCheckpointGate({ position, checkpoints, clearedIds, logger: injectedLogger } = {}) {
  const result = deriveCheckpointGate({ position, checkpoints, clearedIds });
  const { verdict, dueCheckpoint } = result;

  const loggerRef = useRef(injectedLogger);
  loggerRef.current = injectedLogger;

  // Which checkpoint we last announced as blocking. Not derived state — it is
  // the memory that turns a per-render truth into an edge.
  const announcedRef = useRef(null);

  const dueId = dueCheckpoint ? dueCheckpoint.id : null;
  const dueAt = dueCheckpoint ? dueCheckpoint.at : null;
  const { seekCeiling } = verdict;

  useEffect(() => {
    if (announcedRef.current === dueId) return;
    const log = loggerRef.current || logger();
    if (announcedRef.current) {
      log.info('checkpoint.gate.released', { checkpointId: announcedRef.current, seekCeiling });
    }
    if (dueId) {
      log.info('checkpoint.gate.blocked', { checkpointId: dueId, at: dueAt, seekCeiling });
    }
    announcedRef.current = dueId;
  }, [dueId, dueAt, seekCeiling]);

  return result;
}

export default useCheckpointGate;
