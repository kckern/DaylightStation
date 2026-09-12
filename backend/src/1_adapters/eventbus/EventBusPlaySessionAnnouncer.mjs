import { IPlaySessionAnnouncer } from '#apps/gaming/ports/IPlaySessionAnnouncer.mjs';

/**
 * Publishes play-session facts onto the house event bus.
 *
 * Topic: `play-session:<deviceId>`, mirroring the `device-state:<deviceId>`
 * convention so existing fleet/liveness consumers can absorb it.
 *
 * `playedMs` is always the CUMULATIVE total for the session, never a delta.
 * That is what makes a dropped, duplicated or replayed broadcast harmless: the
 * next message carries the truth, and a consumer that applies the same message
 * twice lands on the same number.
 */
export class EventBusPlaySessionAnnouncer extends IPlaySessionAnnouncer {
  #bus; #logger;

  constructor({ eventBus, logger = console }) {
    super();
    if (!eventBus?.broadcast) throw new Error('EventBusPlaySessionAnnouncer requires an eventBus with broadcast()');
    this.#bus = eventBus;
    this.#logger = logger;
  }

  async started(session) {
    this.#publish('play.session.started', session, {
      surface: session.surface,
      userId: session.userId,
      contentId: session.content?.contentId ?? null,
      title: session.content?.title ?? null,
      startedAt: session.startedAt,
    });
  }

  async progress(session, observation) {
    this.#publish('play.session.progress', session, {
      state: observation?.state ?? session.lastState,
      observedAt: observation?.observedAt ?? session.lastObservedAt,
    });
  }

  async ended(session) {
    this.#publish('play.session.ended', session, {
      endedAt: session.endedAt,
      reason: session.endReason,
    });
  }

  #publish(event, session, extra) {
    const topic = `play-session:${session.deviceId}`;
    this.#bus.broadcast(topic, {
      event,
      sessionId: session.id,
      deviceId: session.deviceId,
      playedMs: session.playedMs,          // cumulative, always
      confidenceMs: session.confidenceMs,  // how precisely that was measured
      status: session.status,
      ...extra,
    });
    this.#logger.debug?.(event, { sessionId: session.id, deviceId: session.deviceId, playedMs: session.playedMs });
  }
}

export default EventBusPlaySessionAnnouncer;
