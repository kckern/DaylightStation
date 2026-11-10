import { useCallback, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { consumePass, refundPass, errorBody, REFUND_WITHIN_MS } from '../../earlyPass.js';

/**
 * One early-pass game, from the first frame of the game to the relock.
 *
 * Lives in `Games()`, above the routes, because the pass outlives the game
 * host: once the game ends the host unmounts, and the screen that says "games
 * lock again" has to know the pass was spent.
 *
 * TWO SOURCES OF "A PASS IS OPEN", in order:
 *
 *  - Before the game starts, only the LIVE access answer (`via: 'pass'`). If
 *    the pass ends while the child sits on the picker or the challenge, the
 *    next access read drops `via` and the lock comes straight back: no game
 *    ever runs on a dead pass.
 *  - Once the game has mounted (`markStarted`), the pass is LATCHED (`held`).
 *    From then on the routes stay open whatever access says, so the refresh
 *    that follows a consume cannot cut a finished game off mid-result.
 *
 * ONE TERMINAL PATH. Every way a pass game ends — rematch, exit, crash, an
 * unmount the host did not start, a profile switch — goes through `end`,
 * which marks the pass relocked AND settles it. Nothing can settle without
 * relocking, so no path leaves a spent pass behind an open picker.
 *
 * EXACTLY ONE TERMINAL CALL PER PASS. Consume and refund are idempotent on
 * the server, but firing both would let whichever lands first decide. The
 * guard is a ref keyed by pass id, set before the request leaves.
 *
 * SETTLE MODES. `'force-consume'` always consumes (a board game's durable
 * completion, a profile switch, any end after a completion). `'by-play-time'`
 * refunds under the pass's own refund window (`pass.refundWithinMs`, from the
 * server; `REFUND_WITHIN_MS` only when the server sends none) less a 5 s
 * network margin, and consumes otherwise. A window of null or 0 never refunds. `playedMs` runs from
 * the game's own mount; a pass that never reached a game played 0 ms. A
 * refund the server refuses as `PASS_NOT_ACTIVE` (already ended elsewhere) is
 * only logged; any other refund failure (`PASS_REFUND_CLOSED`, a 5xx, the
 * network) tries ONE consume, and if that fails too it is logged and left.
 * Nothing retries.
 *
 * ENDED SURVIVES A RELOAD. Every ended pass id is also written to
 * localStorage, per learner (`piano.earlyPass.ended.{learnerId}`, id -> when
 * it ended, pruned after a day). On a fresh mount a stored id reads as ended:
 * the screen relocks and no game starts, even while the server still says the
 * pass is active (a consume that never landed). The server ends it anyway
 * after its `max_active_ms`. Every storage access is wrapped: storage that
 * throws or is empty only loses this guard.
 */
/** How much sooner than the server's window the kiosk stops asking for a refund: the request's trip. */
export const REFUND_NETWORK_MARGIN_MS = 5_000;
const ENDED_KEY = (learnerId) => `piano.earlyPass.ended.${learnerId}`;
const ENDED_KEEP_MS = 24 * 60 * 60 * 1000;

/** The stored ended ids for a learner (`{passId: endedAtMs}`), pruned; `{}` when storage cannot say. */
function readEnded(learnerId, nowMs) {
  if (!learnerId) return {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(ENDED_KEY(learnerId)) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, at]) => Number.isFinite(at) && nowMs - at < ENDED_KEEP_MS));
  } catch {
    return {};
  }
}

function rememberEnded(learnerId, passId, nowMs) {
  if (!learnerId || !passId) return;
  try {
    const next = { ...readEnded(learnerId, nowMs), [passId]: nowMs };
    window.localStorage.setItem(ENDED_KEY(learnerId), JSON.stringify(next));
  } catch { /* the in-memory guard still holds for this screen */ }
}

/** The refund window to settle against: the server's, else the fallback; null when there is none. */
function refundWindow(pass) {
  const ms = pass?.refundWithinMs === undefined ? REFUND_WITHIN_MS : pass.refundWithinMs;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Whether an access answer is a VERDICT on the pass: a ready read that is
 * not `indeterminate`, and (when school says incomplete) one whose bank read
 * landed with a readable pass. A failed poll, a loading frame, an
 * indeterminate day or a failed bank read says nothing about the pass.
 */
function speaksForPass(access) {
  if (access?.status !== 'ready' || access.state === 'indeterminate') return false;
  if (access.state !== 'incomplete') return true;
  return Boolean(access.pass) && access.pass.state !== 'unknown';
}

export default function useEarlyPassSession({ learnerId, access }) {
  const log = useMemo(() => getLogger().child({ component: 'piano-early-pass' }), []);
  // STICKY for the same player across answers that are not a verdict. A
  // network blip on the 15s poll during the challenge used to drop the pass,
  // unmount the host and refund at 0 ms — the day's one pass gone to a
  // timeout. It is dropped only by a ready read that says it is not active.
  // Adjusted during render (React's sanctioned derive-from-props pattern), so
  // no frame ever renders the host without it.
  //
  // Every pass that has ended is remembered for the life of this screen
  // (`endedIds`), and neither the live answer, the sticky copy nor the latch
  // can ever resolve to one again: two kids each holding a pass, switching
  // back and forth through `loading` frames, must not reopen a spent pass.
  const endedIds = useRef(new Set());
  // The stored ended ids, read once per learner (a reload's memory).
  const stored = useRef({ learnerId: undefined, ids: {} });
  if (stored.current.learnerId !== learnerId) {
    stored.current = { learnerId, ids: readEnded(learnerId, Date.now()) };
    for (const id of Object.keys(stored.current.ids)) endedIds.current.add(id);
  }
  const [sticky, setSticky] = useState(null);
  const freshAnswer = access?.via === 'pass' && access.pass?.passId && learnerId
    ? { passId: access.pass.passId, learnerId, pass: access.pass }
    : null;
  const fresh = freshAnswer && !endedIds.current.has(freshAnswer.passId) ? freshAnswer : null;
  // A live pass this screen never ended but a reload remembers: relock it.
  const reloadedEnded = freshAnswer && !fresh && Object.prototype.hasOwnProperty.call(stored.current.ids, freshAnswer.passId) ? freshAnswer : null;
  let live = fresh;
  if (fresh) {
    if (sticky?.passId !== fresh.passId || sticky?.learnerId !== fresh.learnerId) setSticky(fresh);
  } else if (sticky && sticky.learnerId === learnerId && !speaksForPass(access) && !endedIds.current.has(sticky.passId)) {
    live = sticky;
  } else if (sticky && sticky.learnerId === learnerId) {
    setSticky(null);
  }
  const [held, setHeld] = useState(null);
  // learnerId -> the pass id that relocked them. Per player, so switching
  // back to a child whose pass ended shows their relock, whoever played since.
  const [relockedBy, setRelockedBy] = useState({});
  if (reloadedEnded && relockedBy[learnerId] !== reloadedEnded.passId) {
    setRelockedBy((map) => ({ ...map, [learnerId]: reloadedEnded.passId }));
  }
  const [outcome, setOutcome] = useState(null);

  // Refs mirror what the callbacks need at call time, which is often after
  // the render that created them (an unmount, a resolved save).
  const heldRef = useRef(held);
  heldRef.current = held;
  const liveRef = useRef(live);
  liveRef.current = live;
  const learnerRef = useRef(learnerId);
  learnerRef.current = learnerId;
  const refreshRef = useRef(access?.refresh);
  refreshRef.current = access?.refresh;
  const settledIds = useRef(new Set());
  const completedIds = useRef(new Set());
  // passId -> when its game mounted.
  const startedAt = useRef(new Map());
  const pendingLeave = useRef(null);

  const isEnded = (pass) => Boolean(pass) && endedIds.current.has(pass.passId);
  const heldMine = held && held.learnerId === learnerId && !isEnded(held) ? held : null;
  const relockedId = relockedBy[learnerId] ?? null;
  const relocked = Boolean(relockedId);
  const holding = !relocked && Boolean(heldMine || live);
  const started = !relocked && Boolean(heldMine);
  const current = holding ? (heldMine ?? live) : null;
  const passId = current?.passId ?? null;
  // Whether the relocked pass ever reached a game: "Good game!" only then.
  const played = relocked && startedAt.current.has(relockedId);

  /** The pass a terminal call is about: this player's latched or live pass, else one latched for another player. */
  const target = useCallback(() => {
    const latched = heldRef.current && !endedIds.current.has(heldRef.current.passId) ? heldRef.current : null;
    if (latched && latched.learnerId === learnerRef.current) return latched;
    return liveRef.current ?? latched ?? null;
  }, []);

  const markStarted = useCallback(() => {
    const pass = liveRef.current;
    if (!pass || startedAt.current.has(pass.passId) || endedIds.current.has(pass.passId)) return;
    startedAt.current.set(pass.passId, Date.now());
    heldRef.current = pass;
    setHeld(pass);
  }, []);

  const playedMs = useCallback((id) => (startedAt.current.has(id)
    ? Math.max(0, Date.now() - startedAt.current.get(id))
    : 0), []);

  const settle = useCallback(async (mode, reason, pass = target()) => {
    if (!pass || settledIds.current.has(pass.passId)) return null;
    settledIds.current.add(pass.passId);
    const { passId: id, learnerId: owner } = pass;
    const ms = playedMs(id);
    const windowMs = refundWindow(pass.pass);
    const facts = { learnerId: owner, passId: id, playedMs: ms, reason, mode, refundWithinMs: windowMs };
    try {
      if (mode === 'by-play-time' && windowMs != null && ms < windowMs - REFUND_NETWORK_MARGIN_MS) {
        try {
          const res = await refundPass(owner, id, ms, reason);
          log.info('piano.early-pass.refunded', { ...facts, refunded: res?.refunded ?? null, duplicate: res?.duplicate === true });
          setOutcome('refunded');
          return 'refunded';
        } catch (error) {
          const code = errorBody(error)?.code ?? null;
          log.warn('piano.early-pass.refused', { ...facts, action: 'refund', status: error?.status ?? null, code });
          if (code === 'PASS_NOT_ACTIVE') return null;
        }
      }
      try {
        const res = await consumePass(owner, id, ms);
        log.info('piano.early-pass.consumed', { ...facts, duplicate: res?.duplicate === true });
        setOutcome('consumed');
        return 'consumed';
      } catch (error) {
        log.warn('piano.early-pass.refused', {
          ...facts, action: 'consume', status: error?.status ?? null, code: errorBody(error)?.code ?? null,
        });
        return null;
      }
    } finally {
      try { refreshRef.current?.(); } catch { /* the relock stands either way */ }
    }
  }, [log, playedMs, target]);

  /**
   * THE terminal transition: relock the pass's owner, then settle. `pass`
   * defaults to the current target; the host names the PREVIOUS pass
   * explicitly when one player's pass gives way to another's.
   */
  const end = useCallback((mode, reason, pass = target()) => {
    // Once per pass: the host's own unmount follows every relock.
    if (!pass || endedIds.current.has(pass.passId)) return;
    endedIds.current.add(pass.passId);
    rememberEnded(pass.learnerId, pass.passId, Date.now());
    setRelockedBy((map) => ({ ...map, [pass.learnerId]: pass.passId }));
    setSticky((value) => (value?.passId === pass.passId ? null : value));
    // Already settled (a completion consumed it): still re-read access, so
    // nothing keeps answering `via: 'pass'` behind the relock.
    if (settledIds.current.has(pass.passId)) {
      try { refreshRef.current?.(); } catch { /* the relock stands */ }
      return;
    }
    const switched = pass.learnerId !== learnerRef.current;
    const completed = completedIds.current.has(pass.passId);
    settle(switched || completed ? 'force-consume' : mode, switched ? 'switch' : reason, pass);
  }, [settle, target]);

  /**
   * A board game reached its result. Marked synchronously, before its save is
   * awaited, so an exit a moment later consumes instead of refunding.
   */
  const complete = useCallback(() => {
    const pass = target();
    if (pass) completedIds.current.add(pass.passId);
    return pass;
  }, [target]);

  // The host's unmount is deferred one microtask and cancelled by a remount.
  // React runs a StrictMode unmount-remount pair synchronously, so `stay`
  // always lands first; a real unmount finishes before any timer could, and
  // there is no timer to leave behind. NOTE: hiding these routes in React
  // `<Activity mode="hidden">` would run this cleanup and settle the pass.
  const leave = useCallback((reason) => {
    pendingLeave.current = reason;
    queueMicrotask(() => {
      const why = pendingLeave.current;
      pendingLeave.current = null;
      if (why) end('by-play-time', why);
    });
  }, [end]);
  const stay = useCallback(() => { pendingLeave.current = null; }, []);

  return useMemo(() => ({
    holding, relocked, started, played, outcome, passId, pass: current,
    markStarted, complete, settle, end, leave, stay,
  // `current` is rebuilt each render; its id stands for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [holding, relocked, started, played, outcome, passId, markStarted, complete, settle, end, leave, stay]);
}
