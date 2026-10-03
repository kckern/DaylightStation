/**
 * LivenessNowPlayingReader — what is on each screen right now, read from the
 * device-state snapshots DeviceLivenessService already caches.
 *
 * "On a screen" means the screen is online and its session holds an item in
 * an active state. Paused counts: a paused film on the living-room TV is
 * still "Now on Living Room TV", and offering it as carry-on elsewhere would
 * fork it.
 *
 * Limits: only surfaces that publish `device-state:<id>` are visible — fleet
 * screens and Bluetooth speaker lanes. A browser playing locally in the Media
 * app does not publish device state, so its playback is not known here.
 */
export const ACTIVE_STATES = Object.freeze(['playing', 'paused', 'buffering', 'loading', 'stalled']);

export class LivenessNowPlayingReader {
  #liveness;

  /**
   * @param {{livenessService: {knownDeviceIds: Function, getLastSnapshot: Function}}} deps
   */
  constructor({ livenessService }) {
    if (typeof livenessService?.knownDeviceIds !== 'function' || typeof livenessService?.getLastSnapshot !== 'function') {
      throw new TypeError('LivenessNowPlayingReader requires livenessService');
    }
    this.#liveness = livenessService;
  }

  /**
   * @returns {Promise<Array<{deviceId:string, screenId:string, contentId:string, state:string, position:number|null}>>}
   */
  async list() {
    const out = [];
    for (const screenId of this.#liveness.knownDeviceIds()) {
      const entry = this.#liveness.getLastSnapshot(screenId);
      if (!entry?.online) continue;
      const snapshot = entry.snapshot || {};
      const contentId = snapshot.currentItem?.contentId;
      if (!contentId || !ACTIVE_STATES.includes(snapshot.state)) continue;
      out.push({
        deviceId: `fleet:${screenId}`,
        screenId,
        contentId,
        state: snapshot.state,
        position: Number.isFinite(snapshot.position) ? snapshot.position : null,
      });
    }
    return out;
  }
}

export default LivenessNowPlayingReader;
