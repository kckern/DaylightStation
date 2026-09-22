import { PLAYBACK_STATE_TOPIC } from '#shared/contracts/media/topics.mjs';
import { validatePlaybackStateBroadcast } from '#shared-contracts/media/envelopes.mjs';

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

/** Relays playback-state transport frames to every Fleet subscriber. */
export class EventBusPlaybackStateRelay {
  constructor({ eventBus, logger = console }) {
    Object.assign(this, { eventBus, logger });
  }

  attach() {
    const byConnection = new Map();
    this.eventBus.onClientMessage((clientId, message) => {
      if (message.topic !== 'playback_state') return;
      const registeredClientId = this.eventBus.getClientMeta?.(clientId)?.clientId;
      const identity = message.identity;
      if (identity) {
        if (!registeredClientId || identity.clientId !== registeredClientId) {
          this.logger.warn?.('eventbus.playback_state.identity-mismatch', { clientId });
          return;
        }
        const deviceId = `browser:${registeredClientId}`;
        const canonical = {
          ...message,
          identity: { ...identity, clientId: registeredClientId, deviceId },
          clientId: registeredClientId,
          deviceId,
          ownerId: registeredClientId,
          displayName: identity.name,
          connected: message.connected !== false,
          lastHeardAt: message.lastHeardAt ?? message.ts ?? new Date().toISOString(),
        };
        if (!validatePlaybackStateBroadcast(canonical).valid) {
          this.logger.warn?.('eventbus.playback_state.invalid', { clientId });
          return;
        }
        byConnection.set(clientId, canonical);
        this.logger.debug?.('eventbus.playback_state.relay', {
          from: clientId, broadcastId: canonical.deviceId, state: canonical.state,
        });
        this.eventBus.broadcast(PLAYBACK_STATE_TOPIC, canonical);
        return;
      }
      this.logger.warn?.('eventbus.playback_state.missing-identity', { clientId });
    });
    this.eventBus.onClientDisconnection?.((clientId) => {
      const last = byConnection.get(clientId);
      if (!last) return;
      byConnection.delete(clientId);
      const ts = new Date().toISOString();
      this.eventBus.broadcast(PLAYBACK_STATE_TOPIC, {
        ...last,
        state: 'stopped',
        currentItem: null,
        position: 0,
        connected: false,
        reason: 'disconnect',
        ts,
        lastHeardAt: last.lastHeardAt ?? ts,
      });
    });
  }
}
