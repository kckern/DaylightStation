// frontend/src/modules/Media/shell/screenHandleModel.js
// STEER.1a/AC4 (RQ-STEER-01): besides this device's own playback, the handle
// covers the screen the person most recently sent to or steered — so pausing
// the TV when the phone rings is one tap. This picks which screen that is.
export const HANDLE_ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

/**
 * @param {Object} p
 * @param {string|null} p.lastSteeredId  the screen most recently steered (acked command / confirmed send)
 * @param {string[]} p.aimIds            the aimed screens (where the next tap would send)
 * @param {(id: string) => ({ snapshot?: Object, offline?: boolean }|null)} p.entryFor
 * @param {(id: string) => boolean} [p.isLocal]  this device's own session, never a second handle
 * @returns {{ deviceId: string, why: 'steered'|'aimed' }|null}
 */
export function pickHandleScreen({ lastSteeredId = null, aimIds = [], entryFor, isLocal = () => false }) {
  const usable = (id) => {
    if (typeof id !== 'string' || !id || isLocal(id)) return false;
    const entry = entryFor(id);
    return !!entry && !entry.offline && HANDLE_ACTIVE_STATES.has(entry.snapshot?.state) && !!entry.snapshot?.currentItem;
  };
  if (usable(lastSteeredId)) return { deviceId: lastSteeredId, why: 'steered' };
  const aimed = (aimIds ?? []).find(usable);
  return aimed ? { deviceId: aimed, why: 'aimed' } : null;
}

// Addendum item 1 (2026-11-26): one bar follows the play. After PLAY to a
// screen, the handle represents that start — "▶ <title> · <screen>",
// Starting → Playing, or what went wrong with Retry / Play here — and then
// the screen's own session. These pick the start it represents and say what
// state it is in; the bar binds the screen's session controller itself.
const FAR_PLAY_KINDS = new Set(['play', 'shuffle', 'playNow', 'move']);
const LIVE_PHASES = new Set(['running', 'sent', 'confirmed', 'unconfirmed', 'failed', 'not-sent']);

function phaseOf(record) {
  if (record.phase) return record.phase;
  if (record.status === 'failed') return 'failed';
  if (record.status !== 'success') return 'running';
  const outcome = record.outcome ?? record.playback;
  return outcome === 'confirmed' ? 'confirmed' : outcome === 'timeout' ? 'unconfirmed' : 'sent';
}

/**
 * The newest start on another screen that the handle should follow: a play,
 * shuffle or move to a far screen (never an add, never this device).
 * @param {Iterable<Object>} records  DispatchProvider outcome records
 * @returns {Object|null}
 */
export function pickHandlePlay(records) {
  let newest = null;
  for (const record of records ?? []) {
    if (!record || record.distance !== 'far') continue;
    if (record.operation === 'add' || !FAR_PLAY_KINDS.has(record.kind)) continue;
    if (!LIVE_PHASES.has(phaseOf(record))) continue;
    if (!newest || String(record.createdAt ?? '') >= String(newest.createdAt ?? '')) newest = record;
  }
  return newest;
}

/** Did the screen start something else over our start (a new session, or another single item)? */
function preemptedBy(record, snapshot) {
  const item = snapshot?.currentItem;
  if (!item) return null;
  const ours = record.item?.contentId ?? record.contentId ?? null;
  const ourSession = record.outcomeIdentity?.sessionId ?? null;
  if (ourSession && typeof snapshot.sessionId === 'string' && snapshot.sessionId) {
    return snapshot.sessionId !== ourSession ? item : null;
  }
  // Without session ids, only a single-item play can be told apart: a
  // collection or a move legitimately moves on to other items.
  const singleItem = record.kind === 'play' && !record.command?.shuffle && !record.snapshot;
  if (!singleItem || !ours || item.contentId === ours) return null;
  const queued = (snapshot.queue?.items ?? []).some((q) => q?.contentId === ours);
  return queued ? null : item;
}

/**
 * What the handle says about a start on a screen.
 * @param {{ record: Object, entry: ({ snapshot?: Object, offline?: boolean }|null), seenActive?: boolean }} p
 * @returns {{ status: 'starting'|'playing'|'paused'|'failed'|'preempted'|'ended', phase: string, other?: Object }}
 */
export function handlePlayView({ record, entry = null, seenActive = false }) {
  const phase = phaseOf(record);
  const snapshot = entry && !entry.offline ? entry.snapshot ?? null : null;
  const active = !!snapshot?.currentItem && HANDLE_ACTIVE_STATES.has(snapshot.state);
  const ours = record.item?.contentId ?? record.contentId ?? null;
  const playingOurs = active && (snapshot.currentItem.contentId === ours
    || (!!record.outcomeIdentity?.sessionId && snapshot.sessionId === record.outcomeIdentity.sessionId));
  const sessionState = snapshot?.state === 'paused' ? 'paused' : 'playing';
  if (phase === 'failed' || phase === 'not-sent') return { status: 'failed', phase };
  if (phase === 'running' || phase === 'sent') return { status: 'starting', phase };
  if (phase === 'unconfirmed') return playingOurs ? { status: sessionState, phase } : { status: 'failed', phase };
  // Confirmed: follow the screen's own session from here.
  if (active) {
    const other = preemptedBy(record, snapshot);
    if (other) return { status: 'preempted', phase, other };
    return { status: sessionState, phase };
  }
  // Confirmed, the screen has not reported yet (the fleet lags the watchdog):
  // still Playing. Once it had reported and is now idle, the play is over.
  return seenActive ? { status: 'ended', phase } : { status: 'playing', phase };
}
