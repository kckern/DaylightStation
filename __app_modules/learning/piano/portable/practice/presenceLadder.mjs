/**
 * presenceLadder — the rules of the lesson "Are you still there?" check-in
 * ladder (owner, 2026-11-13). Pure; no Node or DOM APIs: the kiosk
 * (useEngagementGate) and the server (calibration CLI, progress store) both
 * import it.
 *
 * A check-in that comes round with no real playing since the last answer asks
 * for more, one rung at a time:
 *   0 one note · 1 one scale · 2 two scales, R then L ·
 *   3 one scale hands together, up and back down · 4 two hands-together scales,
 *   the second in the next key (the ladder stays at 4).
 * Measured practice since the last answer (practice-like notes per minute over
 * the whole interval) drops it to the note; partial playing steps it down one;
 * none climbs one. The wait before a check-in tightens with the rung.
 *
 * Reference: __docs/reference/piano/lesson-engagement.md "The presence ladder".
 */
import { classifyBurst, PRESCHOOL_PRACTICE } from './practiceScore.mjs';
import { scaleSpec, DEFAULT_DRILL_ROOTS } from './goodFaith.mjs';

export const PRESENCE_LADDER_DEFAULTS = Object.freeze({
  practiceNpm: 4,
  partialNotes: 8,
  intervalsSeconds: Object.freeze([90, 90, 75, 60]),
  keepaliveDeadline: true,
  keepaliveFactor: 2,
  notifyTopRung: false,
});

export const PRESENCE_RUNGS = Object.freeze([
  Object.freeze({ rung: 0, kind: 'note' }),
  Object.freeze({ rung: 1, kind: 'scales', count: 1, hands: Object.freeze(['R']) }),
  Object.freeze({ rung: 2, kind: 'scales', count: 2, hands: Object.freeze(['R', 'L']) }),
  Object.freeze({ rung: 3, kind: 'scales', count: 1, hands: Object.freeze(['RL']) }),
  Object.freeze({ rung: 4, kind: 'scales', count: 2, hands: Object.freeze(['RL', 'RL']) }),
]);

export const TOP_RUNG = PRESENCE_RUNGS.length - 1;

/** Answer notes plus this grace never count as evidence (the kiosk's CHECK_IN_GRACE_MS). */
export const ANSWER_GRACE_MS = 3000;

const REPLAY_KEEP = 400;
// Re-check a passed deadline at a note at most this often (the kiosk polls each
// second; past the deadline the evidence turns to none only if the burst turns
// to spam, so a coarser re-check changes nothing measurable and keeps replay fast).
const RECHECK_MS = 5000;

const posNum = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
function posList(v, d) {
  if (!Array.isArray(v) || !v.length) return [...d];
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) return [...d];
  return [...v];
}

/**
 * The validated ladder config from the YAML block
 * `videos.practice.presence_ladder` (snake_case). Anything malformed falls
 * back to its default; every interval is capped at the base idle timeout.
 * Preschool (R2): one note forever, a constant base interval, no deadline.
 */
export function ladderConfig(raw, { baseTimeoutSeconds = 90, preschool = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const D = PRESENCE_LADDER_DEFAULTS;
  const base = posNum(Number(baseTimeoutSeconds), 90);
  const cfg = {
    practiceNpm: posNum(r.practice_npm, D.practiceNpm),
    partialNotes: posNum(r.partial_notes, D.partialNotes),
    intervalsSeconds: posList(r.intervals_seconds, D.intervalsSeconds).map((s) => Math.min(s, base)),
    keepaliveDeadline: bool(r.keepalive_deadline, D.keepaliveDeadline),
    keepaliveFactor: posNum(r.keepalive_factor, D.keepaliveFactor),
    notifyTopRung: bool(r.notify_top_rung, D.notifyTopRung),
    topRung: TOP_RUNG,
  };
  if (preschool) {
    cfg.topRung = 0;
    cfg.intervalsSeconds = [base];
    cfg.keepaliveDeadline = false;
  }
  return Object.freeze({ ...cfg, intervalsSeconds: Object.freeze(cfg.intervalsSeconds) });
}

const clampRung = (rung, cfg) => Math.max(0, Math.min(cfg?.topRung ?? TOP_RUNG, Math.trunc(Number(rung)) || 0));

/**
 * The evidence verdict for one interval (R1): from the last answer + 3 s to
 * the moment the next check-in opens. `judge` is the burst judge's state for
 * an ambiguous burst ({status:'pending'|'answered', legit}) or null.
 * @returns {'practice'|'partial'|'none'|'hold'}
 */
export function classifyInterval({ legitNotes = 0, verdict = null, intervalMs = 0, judge = null } = {}, cfg = ladderConfig()) {
  const n = Math.max(0, Number(legitNotes) || 0);
  if (verdict === 'spam' || n < cfg.partialNotes) return 'none';
  if (judge?.status === 'pending') return 'hold';
  if (judge?.status === 'answered' && judge.legit === false) return 'none';
  const minutes = Math.max(1 / 60, (Number(intervalMs) || 0) / 60000);
  return n / minutes >= cfg.practiceNpm ? 'practice' : 'partial';
}

/** The rung after an interval's evidence. */
export function nextRung(rung, evidence, cfg = ladderConfig()) {
  const r = clampRung(rung, cfg);
  if (evidence === 'practice') return 0;
  if (evidence === 'partial') return Math.max(0, r - 1);
  if (evidence === 'none') return Math.min(cfg.topRung, r + 1);
  return r;
}

/** Seconds of silence (or deadline unit) before the check-in at this rung. */
export function intervalSecondsFor(rung, cfg = ladderConfig()) {
  const list = cfg.intervalsSeconds?.length ? cfg.intervalsSeconds : PRESENCE_LADDER_DEFAULTS.intervalsSeconds;
  const r = Math.max(0, Math.trunc(Number(rung)) || 0);
  return list[Math.min(r, list.length - 1)];
}

/** What the check-in at a rung asks for. */
export function checkInStepFor(rung, { scaleIndex = 0 } = {}, cfg = ladderConfig()) {
  const r = clampRung(rung, cfg);
  const def = PRESENCE_RUNGS[r];
  if (def.kind === 'note') return { kind: 'note', rung: 0 };
  return { kind: 'scales', rung: r, count: def.count, hands: [...def.hands], scaleIndex: Math.max(0, Math.trunc(Number(scaleIndex)) || 0) };
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const fifthAbove = (root) => {
  const i = SHARPS.indexOf(root);
  return i < 0 ? 'G' : SHARPS[(i + 7) % 12];
};

function rotate(list, by) {
  const arr = Array.isArray(list) && list.length ? [...list] : [...DEFAULT_DRILL_ROOTS];
  const k = ((Math.trunc(Number(by)) || 0) % arr.length + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

/**
 * The scale spec a check-in step deals: `count` sets of one rep, up and back
 * down one octave, hands as the rung says. The second set is the next key: the
 * next root in the rotation, or a fifth up when the lesson gives one root.
 */
export function checkInDrillFor(step, { roots, rotation = 0 } = {}) {
  const sets = Math.max(1, Math.trunc(Number(step?.count)) || 1);
  const dealt = rotate(roots, rotation);
  while (dealt.length < sets) dealt.push(fifthAbove(dealt[dealt.length - 1]));
  const hands = Array.isArray(step?.hands) && step.hands.length ? [...step.hands] : ['R'];
  return scaleSpec({ roots: dealt, sets, reps: 1, hands });
}

/** Keys pressed to clear a rung: a note is 1; a one-octave scale up and down is 15 per hand. */
export function rungCostNotes(rung) {
  const def = PRESENCE_RUNGS[Math.max(0, Math.min(TOP_RUNG, Math.trunc(Number(rung)) || 0))];
  if (def.kind === 'note') return 1;
  return def.hands.reduce((sum, h) => sum + 15 * (h === 'RL' ? 2 : 1), 0);
}

/**
 * Deterministic replay of the kiosk ladder over a sitting's human notes, every
 * check-in answered instantly. The idle clock resets on every note (and on the
 * answer); once a check-in has been answered, the keepalive deadline (R5)
 * opens one at answer + keepaliveFactor × interval while the evidence is none.
 * @param {Array<{t:number,note:number,velocity:number}>} events  ms
 * Every sitting starts at rung 0 (owner, 2026-11-13: the run resets on each lesson video).
 * @returns {Array<{atMs, rung, scales, answered:true, minimal, evidence}>}
 */
export function replayLadder(events, playedSec, cfg = ladderConfig(), { preschool = false } = {}) {
  const evs = (Array.isArray(events) ? events : [])
    .filter((e) => e && Number.isFinite(e.t) && Number.isFinite(e.note))
    .slice().sort((a, b) => a.t - b.t);
  const endMs = Math.max(0, Number(playedSec) || 0) * 1000;
  const burstOpts = preschool ? PRESCHOOL_PRACTICE : {};
  const out = [];
  let rung = 0;
  let lastAnsweredAt = null;
  let lastActivity = 0;
  let lastCheckAt = -Infinity;
  let i = 0;

  const evidenceAt = (tMs) => {
    const from = lastAnsweredAt + ANSWER_GRACE_MS;
    // The kiosk's practice meter keeps the most recent ~400 events for since().
    const win = evs.filter((e) => e.t >= from && e.t <= tMs).slice(-REPLAY_KEEP);
    const b = classifyBurst(win, burstOpts);
    return classifyInterval({ legitNotes: b.legitNotes, verdict: b.verdict, intervalMs: tMs - from }, cfg);
  };

  const fire = (tMs) => {
    const evidence = lastAnsweredAt == null ? 'first' : evidenceAt(tMs);
    const to = evidence === 'first' ? 0 : nextRung(rung, evidence, cfg);
    rung = to;
    const step = checkInStepFor(rung, {}, cfg);
    out.push({ atMs: tMs, rung, scales: step.kind === 'scales' ? step.count : 0, answered: true, minimal: evidence === 'none', evidence });
    lastAnsweredAt = tMs;
    lastActivity = tMs;
  };

  for (let guard = 0; guard < 100000; guard++) {
    const intervalMs = intervalSecondsFor(rung, cfg) * 1000;
    const idleAt = lastActivity + intervalMs;
    const deadlineOn = cfg.keepaliveDeadline && lastAnsweredAt != null;
    const deadlineAt = deadlineOn ? lastAnsweredAt + cfg.keepaliveFactor * intervalMs : Infinity;
    const next = i < evs.length ? evs[i].t : Infinity;

    // The deadline has passed: check at the deadline, then at a later note
    // (evidence only changes at a note) at most once per RECHECK_MS.
    if (deadlineAt <= idleAt) {
      const checkAt = Math.max(deadlineAt, lastActivity);
      if (checkAt <= endMs && checkAt < next && checkAt < idleAt && checkAt - lastCheckAt >= RECHECK_MS) {
        lastCheckAt = checkAt;
        if (evidenceAt(checkAt) === 'none') { fire(checkAt); continue; }
      }
    }
    if (next < idleAt) {
      lastActivity = next;
      i += 1;
      continue;
    }
    if (idleAt > endMs) break;
    fire(idleAt);
  }
  return out;
}
