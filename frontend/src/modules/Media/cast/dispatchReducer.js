// frontend/src/modules/Media/cast/dispatchReducer.js
// The one outcome store for /media (RELY.1a–RELY.6a, PR-6). Every record is
// one attempt at one target, keyed by attemptId and carrying its targetId:
//
//   { attemptId, targetId, kind, phase, item, command, snapshot, reason,
//     createdAt, updatedAt }
//
// plus the legacy dispatch fields (dispatchId/deviceId/status/steps/...) the
// tray and older callers read. `command` is the frozen replay input: Retry
// replays exactly it, at exactly that target, never a sibling or "the latest".
//
// Far records (a remote screen) live from INITIATED until the UI explicitly
// REMOVEs them. Crucially, an entry is NOT torn down the moment the HTTP load
// succeeds: the backend's playback watchdog reports a trailing `playback`
// step up to ~90s later, and that late STEP must land on the (still-present)
// entry so the tray can show honest post-cast confirmation. A late step only
// lands when it names the same target (a homeline topic for another screen
// never updates this attempt).
//
// Local records (this device) are recorded through LOCAL/LOCAL_RESOLVED and
// render quietly; local playback problems (failed/skipped) do not.
//
// Replacement rules:
//   - a newer confirmation of the same kind for the same target replaces
//     settled confirmations of that kind (they don't pile up);
//   - one "may not have started" notice per screen: a newer one replaces it;
//   - failures are never replaced — each keeps its own Retry.

export const initialDispatchState = Object.freeze({ byId: new Map() });

/**
 * Normalize the trailing playback-watchdog status into a resolution.
 * Backend emits 'confirmed' when playback.log matches the dispatched content
 * (WakeAndLoadService) and 'timeout' when it never does; 'done'/'ok' are
 * accepted as confirmation aliases. Unknown statuses resolve nothing.
 * @returns {'confirmed'|'timeout'|null}
 */
export function normalizePlaybackStatus(status) {
  if (status === 'timeout' || status === 'failed') return 'timeout';
  if (status === 'confirmed' || status === 'done' || status === 'ok') return 'confirmed';
  return null;
}

// Steps that run before anything is delivered to the receiver. A failure
// there means the press never reached the screen: a terminal "Not sent".
const UNDELIVERED_STEPS = new Set(['power', 'verify', 'prepare', 'input']);
const UNDELIVERED_ERROR = /\b(offline|not found|not connected|no (?:receiver|subscriber)s?|unreachable)\b/i;

export function isUndelivered({ error, failedStep } = {}) {
  if (failedStep && UNDELIVERED_STEPS.has(failedStep)) return true;
  return typeof error === 'string' && UNDELIVERED_ERROR.test(error);
}

/** Phase of any record, for rendering: running | sent | confirmed |
 *  unconfirmed | failed | not-sent | skipped. */
export function outcomePhase(d) {
  if (!d) return null;
  if (d.distance === 'here' || d.distance === 'direct') return d.phase ?? 'confirmed';
  if (d.status === 'failed') return isUndelivered(d) ? 'not-sent' : 'failed';
  if (d.status !== 'success') return 'running';
  const outcome = d.outcome ?? d.playback;
  if (outcome === 'confirmed') return 'confirmed';
  if (outcome === 'timeout') return 'unconfirmed';
  return 'sent';
}

const SETTLED_CONFIRMATIONS = new Set(['confirmed', 'sent']);

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function frozenCopy(value) {
  if (value == null) return null;
  // Replay inputs are JSON wire values (content ids, options, snapshots) —
  // functions are not part of an attempt's identity.
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function now() {
  return new Date().toISOString();
}

function withPhase(record) {
  return { ...record, phase: outcomePhase(record) };
}

/** Drop settled confirmations of the same kind on the same target. */
function supersedeConfirmations(byId, { attemptId, targetId, kind }) {
  for (const [id, record] of byId) {
    if (id === attemptId) continue;
    if (record.targetId !== targetId || record.kind !== kind) continue;
    if (SETTLED_CONFIRMATIONS.has(record.phase)) byId.delete(id);
  }
}

/** Keep only the newest "may not have started" notice for a screen. */
function supersedeUnconfirmed(byId, { attemptId, targetId }) {
  for (const [id, record] of byId) {
    if (id !== attemptId && record.targetId === targetId && record.phase === 'unconfirmed') byId.delete(id);
  }
}

function update(state, attemptId, patch, { targetId } = {}) {
  const prev = state.byId.get(attemptId);
  if (!prev) return state;
  // A late update must locate its exact {attemptId, targetId}.
  if (targetId != null && prev.targetId !== targetId) return state;
  const next = new Map(state.byId);
  const record = withPhase({ ...prev, ...patch(prev), updatedAt: now() });
  next.set(attemptId, record);
  if (record.phase === 'unconfirmed' && prev.phase !== 'unconfirmed') supersedeUnconfirmed(next, record);
  if (record.phase === 'confirmed' && prev.phase !== 'confirmed') supersedeConfirmations(next, record);
  return { ...state, byId: next };
}

export function reduceDispatch(state, action) {
  switch (action.type) {
    case 'INITIATED': {
      const { dispatchId, deviceId, contentId, mode, title, operation, command, snapshot, undo } = action;
      const resolvedOperation = operation ?? 'play-now';
      const kind = action.kind ?? (resolvedOperation === 'add' ? 'add' : snapshot ? 'move' : 'play');
      const createdAt = now();
      const next = new Map(state.byId);
      const record = withPhase({
        attemptId: dispatchId,
        targetId: deviceId,
        kind,
        item: { contentId: contentId ?? null, title: title ?? null },
        command: frozenCopy(command ?? null),
        snapshot: frozenCopy(snapshot ?? null),
        reason: null,
        createdAt,
        updatedAt: createdAt,
        distance: 'far',
        undo: undo ?? null,
        // PLAY.4a: this play continued from a saved spot; its confirmation
        // offers Start over.
        ...(action.startOver === true ? { startOver: true, resumedFrom: action.resumedFrom ?? null } : {}),
        // Legacy dispatch fields.
        dispatchId,
        deviceId,
        contentId,
        title: title ?? null,        // human content title for the tray
        mode,
        operation: resolvedOperation,
        status: 'running',
        steps: [],
        playback: null,              // trailing watchdog: 'confirmed' | 'timeout' | null
        outcome: null,
        error: null,
        failedStep: null,
        totalElapsedMs: null,
        initiatedAt: createdAt,
      });
      supersedeConfirmations(next, record);
      next.set(dispatchId, record);
      return { ...state, byId: next };
    }
    case 'STEP': {
      const { dispatchId, step, status, elapsedMs, error, targetId } = action;
      return update(state, dispatchId, (prev) => {
        // A `playback` step is the watchdog resolving — it can (and usually
        // does) arrive AFTER the dispatch already SUCCEEDED. Record it as a
        // resolution field, not just a step append, so the tray can react.
        const resolution = step === 'playback' ? normalizePlaybackStatus(status) : null;
        const outcomeResolution = (step === 'playback' || step === 'queue')
          ? normalizePlaybackStatus(status)
          : null;
        return {
          steps: [...prev.steps, { step, status, elapsedMs, error: error ?? null, ts: now() }],
          // PLAY.10a: the screen's Add only took this Play as an add; it is
          // reported (and resolved by its queue step) as an add.
          ...(action.appliedAs === 'add' ? { kind: 'add', operation: 'add', appliedAs: 'add' } : {}),
          ...(resolution ? { playback: resolution } : {}),
          ...(outcomeResolution ? {
            outcome: outcomeResolution,
            reason: outcomeResolution === 'timeout' ? 'playback-unconfirmed' : prev.reason,
            outcomeIdentity: {
              sessionId: action.sessionId ?? null,
              ownerId: action.ownerId ?? null,
              ownerInstanceId: action.ownerInstanceId ?? null,
              playbackRevision: action.playbackRevision ?? null,
              queueRevision: action.queueRevision ?? null,
              queueLength: action.queueLength ?? null,
              ordinal: action.ordinal ?? null,
              count: action.count ?? null,
            },
          } : {}),
        };
      }, { targetId });
    }
    case 'SUCCEEDED': {
      const { dispatchId, totalElapsedMs } = action;
      return update(state, dispatchId, () => ({
        status: 'success', totalElapsedMs: totalElapsedMs ?? null,
        ...(action.appliedAs === 'add' ? { kind: 'add', operation: 'add', appliedAs: 'add' } : {}),
      }));
    }
    case 'FAILED': {
      const { dispatchId, error, failedStep } = action;
      return update(state, dispatchId, () => ({
        status: 'failed', error: error ?? 'unknown', failedStep: failedStep ?? null, reason: error ?? 'unknown',
      }));
    }
    case 'SCREEN_STATE': {
      // RELY.3a/AC4: an unconfirmed start clears once that screen itself
      // reports the same item playing.
      const { targetId, state: screenState, contentId } = action;
      if (screenState !== 'playing' || !contentId) return state;
      let next = state;
      for (const record of state.byId.values()) {
        if (record.targetId !== targetId || record.phase !== 'unconfirmed') continue;
        if (record.kind !== 'play' || record.item?.contentId !== contentId) continue;
        next = update(next, record.attemptId, () => ({ outcome: 'confirmed', reason: 'screen-reported-playing' }));
      }
      return next;
    }
    case 'LOCAL': {
      const { attemptId, kind, phase, item, command, reason, replacement, undo, ordinal, count } = action;
      // A direct edit of another screen's queue (Remote) has no wake
      // progress; it is recorded like a local one but names that screen.
      const targetId = action.targetId ?? 'local';
      const createdAt = now();
      const next = new Map(state.byId);
      const record = {
        attemptId,
        targetId,
        targetName: action.targetName ?? null,
        kind,
        phase: phase ?? 'confirmed',
        item: { contentId: item?.contentId ?? null, title: item?.title ?? null },
        command: frozenCopy(command ?? null),
        snapshot: null,
        reason: reason ?? null,
        replacement: replacement ? { contentId: replacement.contentId ?? null, title: replacement.title ?? null } : null,
        ordinal: ordinal ?? null,
        count: count ?? null,
        undo: undo ?? null,
        ...(action.startOver === true ? { startOver: true, resumedFrom: action.resumedFrom ?? null } : {}),
        createdAt,
        updatedAt: createdAt,
        distance: targetId === 'local' ? 'here' : 'direct',
        // Legacy fields so every consumer can key rows the same way.
        dispatchId: attemptId,
        deviceId: targetId,
        contentId: item?.contentId ?? null,
        title: item?.title ?? null,
        steps: [],
      };
      // Only SETTLED confirmations are replaced: a running action still owns
      // its Undo and may yet resolve to a failure that must be shown.
      if (record.phase === 'running' || record.phase === 'confirmed') {
        for (const [id, prior] of next) {
          if (prior.targetId === targetId && prior.kind === kind && prior.phase === 'confirmed') next.delete(id);
        }
      }
      next.set(attemptId, record);
      return { ...state, byId: next };
    }
    case 'LOCAL_RESOLVED': {
      const { attemptId, phase, reason, ordinal, count } = action;
      const prev = state.byId.get(attemptId);
      if (!prev || prev.distance === 'far') return state;
      const next = new Map(state.byId);
      next.set(attemptId, {
        ...prev,
        phase,
        reason: reason ?? prev.reason,
        ordinal: ordinal ?? prev.ordinal,
        count: count ?? prev.count ?? null,
        updatedAt: now(),
      });
      if (phase === 'confirmed') {
        for (const [id, prior] of next) {
          if (id !== attemptId && prior.targetId === prev.targetId && prior.kind === prev.kind
            && prior.phase === 'confirmed' && prior.createdAt <= prev.createdAt) next.delete(id);
        }
      }
      return { ...state, byId: next };
    }
    case 'REMOVED': {
      if (!state.byId.has(action.dispatchId)) return state;
      const next = new Map(state.byId);
      next.delete(action.dispatchId);
      return { ...state, byId: next };
    }
    default:
      return state;
  }
}

export default reduceDispatch;
