import { IPlaySessionAnnouncer } from '#apps/gaming/ports/IPlaySessionAnnouncer.mjs';
import { createEmptyQueueSnapshot } from '#shared-contracts/media/shapes.mjs';

/**
 * Projects play sessions into the Fleet's device-state shape.
 *
 * A device playing a game and a device playing a video are the same concept —
 * a device, and what is on it — so this publishes the SAME SessionSnapshot on
 * the SAME `device-state:<deviceId>` topic the media fleet already renders,
 * rather than inventing an arcade view beside it. The fleet needs no special
 * case; a game shows up like anything else.
 *
 * Mirrors the playback hub's fleet bridge, including its liveness contract: an
 * active session re-publishes on every progress tick so the liveness service
 * keeps the device online, and an ended session publishes `idle` once and then
 * goes quiet, letting the device age out exactly as a stopped speaker does.
 *
 * `position` carries seconds of ACTUAL PLAY, not elapsed wall-clock — the same
 * number the meter bills on, so the fleet view and the ledger can never
 * disagree about how long a child has been playing.
 */
export class FleetPlaySessionAnnouncer extends IPlaySessionAnnouncer {
  #bus; #logger;

  constructor({ eventBus, logger = console }) {
    super();
    if (!eventBus?.broadcast) throw new Error('FleetPlaySessionAnnouncer requires an eventBus with broadcast()');
    this.#bus = eventBus;
    this.#logger = logger;
  }

  async started(session) { this.#publish(session, 'playing'); }

  async progress(session, observation) {
    const state = observation?.state === 'playing' ? 'playing' : 'paused';
    this.#publish(session, state);
  }

  async ended(session) { this.#publish(session, 'idle'); }

  #publish(session, state) {
    const contentId = session.content?.contentId ?? null;
    const snapshot = {
      sessionId: session.id,
      state,
      currentItem: (state !== 'idle' && contentId)
        ? {
          contentId,
          format: 'game',
          ...(session.content?.title ? { title: session.content.title } : {}),
        }
        : null,
      // Seconds of observed play — the billed number, never wall-clock.
      position: Math.max(0, Math.round(session.playedMs / 1000)),
      // The canonical factory, not a hand-rolled shape: the contract requires
      // upNextCount and a -1 current index, and a snapshot missing either is
      // rejected by the fleet rather than rendered.
      queue: createEmptyQueueSnapshot(),
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
      meta: { ownerId: session.deviceId, updatedAt: new Date().toISOString() },
    };

    try {
      this.#bus.broadcast(`device-state:${session.deviceId}`, snapshot);
    } catch (error) {
      this.#logger.warn?.('play.fleet.publish_failed', { deviceId: session.deviceId, error: error.message });
    }
  }
}

export default FleetPlaySessionAnnouncer;
