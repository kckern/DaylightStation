/**
 * EventBusBrowserPlayback — feeds a BrowserPlaybackTracker from the
 * `playback_state` frames browsers publish about themselves. Only a frame
 * whose identity matches the connection's own `identify` claim counts (the
 * same rule the relay and the presence reader apply).
 */
export class EventBusBrowserPlayback {
  #bus;
  #tracker;

  /** @param {{eventBus: Object, tracker: {observe: Function}}} deps */
  constructor({ eventBus, tracker }) {
    this.#bus = eventBus;
    this.#tracker = tracker;
  }

  attach() {
    this.#bus.onClientMessage((connectionId, message) => {
      if (message?.topic !== 'playback_state' || !message.identity) return;
      const registered = this.#bus.getClientMeta?.(connectionId)?.clientId;
      if (!registered || message.identity.clientId !== registered) return;
      this.#tracker.observe({
        deviceId: `browser:${registered}`,
        state: message.state ?? null,
        contentId: message.currentItem?.contentId ?? null,
        title: message.currentItem?.title ?? null,
        origin: message.origin ?? null,
      });
    });
  }
}

export default EventBusBrowserPlayback;
