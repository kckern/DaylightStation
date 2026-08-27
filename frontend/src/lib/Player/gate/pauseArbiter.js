/**
 * Pause arbitration for media playback.
 *
 * Playback can be blocked by more than one governor at a time (fitness
 * `GovernanceEngine`, school comprehension checkpoints, …). There is no shared
 * base class for those — the abstraction IS the verdict shape below. Each
 * governor produces a `GateVerdict`; this module composes N of them into ONE
 * decision, so callers never have to know how many governors exist or which
 * one is live.
 *
 * ## `blocked` vs `paused` — two different questions
 *
 * - **`blocked`** — a gate says no. A STANDING FACT about permission, true
 *   whenever some gate refuses, regardless of what the player is doing.
 * - **`paused`** — act on it NOW. The transport instruction for this tick.
 *
 * They diverge during a seek: mid-seek we suppress the pause (see the seeking
 * rule below) but the gate has not released, so `paused:false` while
 * `blocked:true`. Collapsing the two would make a blocking checkpoint
 * indistinguishable from a released one for the duration of the seek — an
 * enforcement layer reading only `paused` would call `play()` mid-seek and
 * re-pause on seek end, reintroducing the exact thrash the seeking rule exists
 * to prevent.
 *
 * So: enforcement acts on `paused`; anything asking "may this proceed at all"
 * (seek clamps, overlays, agenda/reporting) reads `blocked`.
 *
 * @typedef {object} GateVerdict
 * @property {boolean} blocked          playback may not proceed
 * @property {string}  id               stable id for logs ('checkpoint', 'governance', …)
 * @property {number|null} [seekCeiling] furthest seekable position (s); null/absent = unclamped
 *
 * @typedef {object} PauseDecision
 * @property {boolean} paused            act now: the transport should be paused this tick
 * @property {string}  reason            a `PAUSE_REASON` value naming what decided it
 * @property {boolean} blocked           standing fact: some gate refuses, seek or not
 * @property {string|null} gate          id of the first blocking gate; null when none blocks
 * @property {number|null} seekCeiling   min of all non-null ceilings; null = unclamped
 */

export const PAUSE_REASON = Object.freeze({
  SEEKING: 'SEEKING',
  GATE: 'PAUSED_GATE',
  BUFFERING: 'PAUSED_BUFFERING',
  USER: 'PAUSED_USER',
  PLAYING: 'PLAYING'
});

const truthy = (value) => Boolean(value);

/**
 * @param {object} [input]
 * @param {{active?: boolean}} [input.seeking]
 * @param {GateVerdict[]} [input.gates]
 * @param {object} [input.resilience]
 * @param {object} [input.user]
 * @returns {PauseDecision}
 */
export const resolvePause = ({
  seeking = {},
  gates = [],
  resilience = {},
  user = {}
} = {}) => {
  // Destructuring defaults fire on `undefined` ONLY. Every slot here arrives from a
  // caller's live state (`useMediaGate` forwards `player: { seeking, resilience, user }`
  // straight through) and each can legitimately be null before its source resolves, so
  // normalize rather than throw on the first property read.
  const allGates = Array.isArray(gates) ? gates : [];
  const seek = seeking || {};
  const health = resilience || {};
  const viewer = user || {};

  // A ceiling is a standing rule, not a pause side-effect: it composes regardless
  // of whether any gate is blocked, so a caller can keep clamping seeks while
  // playback runs freely up to the ceiling.
  const seekCeiling = allGates.reduce(
    (min, g) => (Number.isFinite(g?.seekCeiling) ? (min == null ? g.seekCeiling : Math.min(min, g.seekCeiling)) : min),
    null
  );

  // Computed ABOVE the seeking check on purpose: `blocked`, `gate` and
  // `seekCeiling` are standing facts that must survive every early return.
  // The FIRST blocking gate in array order names the decision, so the reported
  // gate is stable for logs and overlays.
  const blockedGate = allGates.find((g) => truthy(g?.blocked));
  const base = {
    blocked: Boolean(blockedGate),
    // `||` not `??`: an empty-string id must fall back too, or it reads as a
    // falsy gate name downstream while `blocked` is true.
    gate: blockedGate ? (blockedGate.id || 'gate') : null,
    seekCeiling
  };

  // Seeking is highest priority — suppress the pause ACTION while the video is
  // mid-seek to prevent pause/resume thrashing from gate events during seeks
  // (this was the fitness governance-challenge lesson; it applies to every gate).
  // Note this suppresses `paused` only: `blocked` above still reports the truth.
  if (truthy(seek.active)) {
    return { paused: false, reason: PAUSE_REASON.SEEKING, ...base };
  }

  if (blockedGate) {
    return { paused: true, reason: PAUSE_REASON.GATE, ...base };
  }

  // Note: resilience.stalled is NOT included - stalled state triggers reload, not pause
  // Pausing during stall interferes with reload recovery (e.g., after governance unlock)
  const resiliencePaused = truthy(
    health.requiresPause
    ?? health.buffering
    ?? health.waiting
  );
  if (resiliencePaused) {
    return { paused: true, reason: PAUSE_REASON.BUFFERING, ...base };
  }

  const userPaused = truthy(viewer.paused ?? viewer.pauseIntent === 'user');
  if (userPaused) {
    return { paused: true, reason: PAUSE_REASON.USER, ...base };
  }

  return { paused: false, reason: PAUSE_REASON.PLAYING, ...base };
};

export default resolvePause;
