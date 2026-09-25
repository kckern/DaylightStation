import { IArcadeGameSessionAnnouncer } from '#apps/gaming/ports/IArcadeGameSessionAnnouncer.mjs';
import {
  ARCADE_SESSION_TOPIC, ARCADE_SESSIONS_TOPIC, parseDeviceTopic,
} from '#shared-contracts/media/topics.mjs';

/**
 * Publishes arcade-game-session facts onto the house event bus.
 *
 * Topic: `arcade-session:<deviceId>`, mirroring the `device-state:<deviceId>`
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
export class EventBusArcadeGameSessionAnnouncer extends IArcadeGameSessionAnnouncer {
  #bus; #placementFor; #overlayConfigFor; #identify; #sessions; #logger;

  /**
   * @param {Object} config
   * @param {(content: Object) => Object|null} [config.placementFor] Content →
   *   overlay placement. Absent, messages simply carry no placement and the
   *   film falls back to its own default position.
   * @param {(systemId: string|null) => Object|null} [config.overlayConfigFor]
   *   System id → resolved overlay config. Absent, messages carry no overlay
   *   config and the film falls back to its own default.
   * @param {(userId: string) => Promise<{displayName: string|null}|null>} [config.identify]
   *   User id → how to address them. A slug is an identifier, not a name.
   */
  constructor({
    eventBus, placementFor = null, overlayConfigFor = null, identify = null, sessions = null, logger = console,
  }) {
    super();
    if (!eventBus?.broadcast) throw new Error('EventBusArcadeGameSessionAnnouncer requires an eventBus with broadcast()');
    this.#bus = eventBus;
    this.#placementFor = placementFor;
    this.#overlayConfigFor = overlayConfigFor;
    this.#identify = identify;
    this.#sessions = sessions;
    this.#logger = logger;
    if (sessions && eventBus.onClientSubscription && eventBus.sendToClient) {
      eventBus.onClientSubscription((clientId, topics) => this.#replay(clientId, topics));
    }
  }

  async started(session) {
    await this.#publish('arcade.session.started', session);
  }

  async progress(session, observation) {
    await this.#publish('arcade.session.progress', session, {
      state: observation?.state ?? session.lastState,
      observedAt: observation?.observedAt ?? session.lastObservedAt,
    });
  }

  async ended(session) {
    await this.#publish('arcade.session.ended', session, {
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
      this.#logger.debug?.('arcade.identify.failed', { userId: session.userId, error: error.message });
      return { displayName: null };
    }
  }

  #presentation(session) {
    const content = session.content ?? null;
    let placement = null;
    try {
      placement = this.#placementFor ? this.#placementFor(content) : null;
    } catch (error) {
      this.#logger.warn?.('arcade.placement.failed', {
        sessionId: session.id, error: error.message,
      });
    }
    let overlay = null;
    try {
      overlay = this.#overlayConfigFor ? this.#overlayConfigFor(content?.console) : null;
    } catch (error) {
      this.#logger.warn?.('play.overlay_config.failed', {
        sessionId: session.id, error: error.message,
      });
    }
    return {
      system: content?.console ?? null,
      systemLabel: content?.consoleLabel ?? null,
      placement,
      overlay,
    };
  }

  async #publish(event, session, extra) {
    const payload = await this.#payload(event, session, extra);
    this.#bus.broadcast(ARCADE_SESSION_TOPIC(session.deviceId), payload);
    this.#bus.broadcast(ARCADE_SESSIONS_TOPIC, payload);
    this.#logger.debug?.(event, { sessionId: session.id, deviceId: session.deviceId, playedMs: session.playedMs });
  }

  async #payload(event, session, extra = {}) {
    return {
      event,
      sessionId: session.id,
      deviceId: session.deviceId,
      surface: session.surface,
      userId: session.userId ?? null,
      grantRef: session.grantRef ?? null,
      participants: session.participants ?? [],
      contentId: session.content?.contentId ?? null,
      title: session.content?.title ?? null,
      loadId: session.loadId ?? null,
      loadedAt: session.loadedAt ?? null,
      startedAt: session.startedAt ?? null,
      endedAt: session.endedAt ?? null,
      reason: session.endReason ?? null,
      state: session.lastState ?? null,
      observedAt: session.lastObservedAt ?? null,
      playedMs: session.playedMs,          // cumulative, always
      confidenceMs: session.confidenceMs,  // how precisely that was measured
      status: session.status,
      // High-water count of compatible pads connected during the session.
      controllers: session.controllers ?? null,
      ...this.#presentation(session),
      ...(await this.#identity(session)),
      ...extra,
    };
  }

  async #replay(clientId, topics) {
    try {
      const delivered = new Set();
      for (const topic of topics || []) {
        let open = [];
        if (topic === ARCADE_SESSIONS_TOPIC && this.#sessions?.listOpen) {
          open = await this.#sessions.listOpen();
        } else {
          const parsed = parseDeviceTopic(topic);
          if (parsed?.kind === 'arcade-session' && this.#sessions?.findOpenForDevice) {
            const session = await this.#sessions.findOpenForDevice(parsed.deviceId);
            if (session) open = [session];
          }
        }
        for (const session of open) {
          const key = `${topic}:${session.id}`;
          if (delivered.has(key)) continue;
          delivered.add(key);
          const payload = await this.#payload('arcade.session.progress', session, { replay: true });
          this.#bus.sendToClient(clientId, {
            topic,
            timestamp: new Date().toISOString(),
            ...payload,
          });
        }
      }
    } catch (error) {
      this.#logger.warn?.('arcade.session.replay_failed', { clientId, error: error.message });
    }
  }
}

export default EventBusArcadeGameSessionAnnouncer;
