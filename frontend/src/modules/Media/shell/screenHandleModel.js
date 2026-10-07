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
