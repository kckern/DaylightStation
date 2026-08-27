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
 * @typedef {object} GateVerdict
 * @property {boolean} blocked          playback may not proceed
 * @property {string}  reason           stable id for logs ('checkpoint', 'governance', …)
 * @property {number|null} [seekCeiling] furthest seekable position (s); null/absent = unclamped
 */

export const PAUSE_REASON = Object.freeze({
  SEEKING: 'SEEKING',
  GATE: 'PAUSED_GATE',
  BUFFERING: 'PAUSED_BUFFERING',
  USER: 'PAUSED_USER',
  PLAYING: 'PLAYING'
});

const truthy = (value) => Boolean(value);

/** Legacy alias: a `governance` slot becomes one gate named 'governance'. */
const governanceAsGate = (governance = {}) => ({
  blocked: truthy(
    governance.blocked
    ?? governance.paused
    ?? governance.locked
    ?? governance.videoLocked
  ),
  reason: 'governance',
  seekCeiling: null
});

export const resolvePause = ({
  seeking = {},
  gates = [],
  governance = null,
  resilience = {},
  user = {}
} = {}) => {
  // `gates = []` only defaults on undefined; callers hand us governor state that
  // can legitimately be null before it has resolved, so normalize rather than throw.
  const supplied = Array.isArray(gates) ? gates : [];
  const allGates = governance ? [...supplied, governanceAsGate(governance)] : supplied;

  // A ceiling is a standing rule, not a pause side-effect: it composes regardless
  // of whether any gate is blocked, so a caller can keep clamping seeks while
  // playback runs freely up to the ceiling.
  const seekCeiling = allGates.reduce(
    (min, g) => (Number.isFinite(g?.seekCeiling) ? (min == null ? g.seekCeiling : Math.min(min, g.seekCeiling)) : min),
    null
  );
  const base = { gate: null, seekCeiling };

  // Seeking is highest priority — suppress all pause while the video is mid-seek
  // to prevent pause/resume thrashing from gate events during seeks (this was the
  // fitness governance-challenge lesson; it applies to every gate).
  if (truthy(seeking.active)) {
    return { paused: false, reason: PAUSE_REASON.SEEKING, ...base };
  }

  // Any blocked gate pauses; the FIRST blocked one in array order names the
  // decision, so the reported reason is stable for logs and overlays.
  const blockedGate = allGates.find((g) => truthy(g?.blocked));
  if (blockedGate) {
    return { paused: true, reason: PAUSE_REASON.GATE, gate: blockedGate.reason ?? 'gate', seekCeiling };
  }

  // Note: resilience.stalled is NOT included - stalled state triggers reload, not pause
  // Pausing during stall interferes with reload recovery (e.g., after governance unlock)
  const resiliencePaused = truthy(
    resilience.requiresPause
    ?? resilience.buffering
    ?? resilience.waiting
  );
  if (resiliencePaused) {
    return { paused: true, reason: PAUSE_REASON.BUFFERING, ...base };
  }

  const userPaused = truthy(user.paused ?? user.pauseIntent === 'user');
  if (userPaused) {
    return { paused: true, reason: PAUSE_REASON.USER, ...base };
  }

  return { paused: false, reason: PAUSE_REASON.PLAYING, ...base };
};

export default resolvePause;
