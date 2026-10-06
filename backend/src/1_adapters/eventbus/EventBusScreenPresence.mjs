/**
 * EventBusScreenPresence — browsers running the Media app publish
 * `playback_state` frames under their registered identity (see
 * EventBusPlaybackStateRelay). Each one is also a sign of life for the screen
 * registry: it registers the browser on first sight and refreshes lastSeen.
 *
 * Only an identity matching the connection's own `identify` claim counts (the
 * same rule the relay applies), and each browser is reported at most once per
 * `intervalMs` (default 60 s).
 */
export class EventBusScreenPresence {
  #bus;
  #onSeen;
  #clock;
  #intervalMs;
  #logger;
  /** @type {Map<string, number>} */
  #last = new Map();

  /**
   * @param {{eventBus: Object, onSeen: ({id, name, room}) => Promise<void>, clock?: {now: Function}, intervalMs?: number, logger?: Object}} deps
   */
  constructor({ eventBus, onSeen, clock = Date, intervalMs = 60_000, logger = console }) {
    this.#bus = eventBus;
    this.#onSeen = onSeen;
    this.#clock = clock;
    this.#intervalMs = intervalMs;
    this.#logger = logger;
  }

  attach() {
    this.#bus.onClientMessage((connectionId, message) => {
      if (message?.topic !== 'playback_state' || !message.identity) return;
      const registered = this.#bus.getClientMeta?.(connectionId)?.clientId;
      if (!registered || message.identity.clientId !== registered) return;
      const id = `browser:${registered}`;
      const now = this.#clock.now();
      const last = this.#last.get(id);
      if (last !== undefined && now - last < this.#intervalMs) return;
      this.#last.set(id, now);
      const name = typeof message.identity.name === 'string' ? message.identity.name : null;
      const room = typeof message.identity.room === 'string' ? message.identity.room : null;
      const fail = (error) => this.#logger.warn?.('eventbus.screen_presence.failed', { id, error: error?.message });
      try {
        // A browser publishing playback state is playing (or just was): it counts as a screen.
        Promise.resolve(this.#onSeen({ id, name, room, playing: true })).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }
}

export default EventBusScreenPresence;
