import { IPlaySessionAnnouncer } from '#apps/gaming/ports/IPlaySessionAnnouncer.mjs';

/**
 * Publishes play-session facts onto the house event bus.
 *
 * Topic: `play-session:<deviceId>`, mirroring the `device-state:<deviceId>`
 * convention so existing fleet/liveness consumers can absorb it.
 *
 * Every message also carries the emulated SYSTEM and, with it, where on that
 * system's bezel a countdown may be drawn. The film is a dumb surface: it is
 * told where it may paint rather than having to know that a Game Boy's chrome
 * is thick and an N64's is a sliver. Carrying it on progress as well as on
 * start costs a handful of numbers and means a film that reconnects mid-game
 * knows where to put itself immediately instead of at the next launch.
 *
 * `playedMs` is always the CUMULATIVE total for the session, never a delta.
 * That is what makes a dropped, duplicated or replayed broadcast harmless: the
 * next message carries the truth, and a consumer that applies the same message
 * twice lands on the same number.
 */
export class EventBusPlaySessionAnnouncer extends IPlaySessionAnnouncer {
  #bus; #placementFor; #identify; #logger;

  /**
   * @param {Object} config
   * @param {(content: Object) => Object|null} [config.placementFor] Content →
   *   overlay placement. Absent, messages simply carry no placement and the
   *   film falls back to its own default position.
   * @param {(userId: string) => Promise<{displayName: string|null}|null>} [config.identify]
   *   User id → how to address them. A slug is an identifier, not a name.
   */
  constructor({ eventBus, placementFor = null, identify = null, logger = console }) {
    super();
    if (!eventBus?.broadcast) throw new Error('EventBusPlaySessionAnnouncer requires an eventBus with broadcast()');
    this.#bus = eventBus;
    this.#placementFor = placementFor;
    this.#identify = identify;
    this.#logger = logger;
  }

  async started(session) {
    await this.#publish('play.session.started', session, {
      surface: session.surface,
      userId: session.userId,
      contentId: session.content?.contentId ?? null,
      title: session.content?.title ?? null,
      startedAt: session.startedAt,
    });
  }

  async progress(session, observation) {
    await this.#publish('play.session.progress', session, {
      state: observation?.state ?? session.lastState,
      observedAt: observation?.observedAt ?? session.lastObservedAt,
    });
  }

  async ended(session) {
    await this.#publish('play.session.ended', session, {
      endedAt: session.endedAt,
      reason: session.endReason,
    });
  }

  /**
   * What the emulated system is, and where the film may draw on it.
   *
   * Both are null for a session whose content is not yet known — a game started
   * by hand at the device names itself only once its logs are read. A film that
   * gets no placement keeps its default position rather than guessing.
   */
  /** How to address the player. Never allowed to fail a broadcast. */
  async #identity(session) {
    if (!this.#identify || !session.userId) return { displayName: null };
    try {
      const who = await this.#identify(session.userId);
      return { displayName: who?.displayName ?? null };
    } catch (error) {
      this.#logger.debug?.('play.identify.failed', { userId: session.userId, error: error.message });
      return { displayName: null };
    }
  }

  #presentation(session) {
    const content = session.content ?? null;
    let placement = null;
    try {
      placement = this.#placementFor ? this.#placementFor(content) : null;
    } catch (error) {
      this.#logger.warn?.('play.placement.failed', {
        sessionId: session.id, error: error.message,
      });
    }
    return {
      system: content?.console ?? null,
      systemLabel: content?.consoleLabel ?? null,
      placement,
    };
  }

  async #publish(event, session, extra) {
    const topic = `play-session:${session.deviceId}`;
    this.#bus.broadcast(topic, {
      event,
      sessionId: session.id,
      deviceId: session.deviceId,
      playedMs: session.playedMs,          // cumulative, always
      confidenceMs: session.confidenceMs,  // how precisely that was measured
      status: session.status,
      // How many pads were live at once — a group game is a different thing
      // from a solo one, and the surface should be able to say so.
      controllers: session.controllers ?? null,
      ...this.#presentation(session),
      ...(await this.#identity(session)),
      ...extra,
    });
    this.#logger.debug?.(event, { sessionId: session.id, deviceId: session.deviceId, playedMs: session.playedMs });
  }
}

export default EventBusPlaySessionAnnouncer;
