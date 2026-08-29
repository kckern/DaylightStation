/** Translates media command frames into MediaQueueCommandService calls. */
export class EventBusMediaCommandIngress {
  constructor({ eventBus, commands, logger = console }) {
    Object.assign(this, { eventBus, commands, logger });
  }

  attach() {
    this.eventBus.onClientMessage((clientId, message) => {
      if (message.topic !== 'media:command') return;
      const { action, contentId, householdId } = message;
      this.logger.info?.('eventbus.media.command', { clientId, action, contentId });
      Promise.resolve(this.commands.execute({ action, contentId, householdId }))
        .then((outcome) => {
          if (outcome.kind === 'unknown_action') {
            this.logger.warn?.('eventbus.media.unknown-action', { action });
          }
        })
        .catch((error) => {
          this.logger.error?.('eventbus.media.command.error', { action, error: error.message });
        });
    });
  }
}

/** Relays playback-state transport frames to the device-specific monitor topic. */
export class EventBusPlaybackStateRelay {
  constructor({ eventBus, logger = console }) {
    Object.assign(this, { eventBus, logger });
  }

  attach() {
    this.eventBus.onClientMessage((clientId, message) => {
      if (message.topic !== 'playback_state') return;
      const broadcastId = message.deviceId || message.clientId;
      if (!broadcastId) return;
      this.logger.debug?.('eventbus.playback_state.relay', { from: clientId, broadcastId, state: message.state });
      this.eventBus.broadcast(`playback:${broadcastId}`, message);
    });
  }
}
