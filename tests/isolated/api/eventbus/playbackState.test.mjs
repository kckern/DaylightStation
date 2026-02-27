// tests/isolated/api/eventbus/playbackState.test.mjs
// Tests for the playback_state WebSocket relay handler (4.2.8)
import { jest } from '@jest/globals';

/**
 * Creates a mock eventBus and registers the playback_state handler
 * (extracted from app.mjs) so we can test it in isolation.
 */
function createMockEventBus() {
  const messageHandlers = [];
  const broadcasts = [];

  return {
    onClientMessage(handler) {
      messageHandlers.push(handler);
    },
    broadcast(topic, payload) {
      broadcasts.push({ topic, payload });
    },
    // Test helpers
    simulateClientMessage(clientId, message) {
      for (const handler of messageHandlers) {
        handler(clientId, message);
      }
    },
    getBroadcasts() {
      return broadcasts;
    },
    clearBroadcasts() {
      broadcasts.length = 0;
    },
  };
}

function createMockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/**
 * Registers the playback_state relay handler on the given eventBus.
 * This mirrors the handler in app.mjs exactly.
 */
function registerPlaybackStateHandler(eventBus, rootLogger) {
  eventBus.onClientMessage((clientId, message) => {
    if (message.topic !== 'playback_state') return;
    const broadcastId = message.deviceId || message.clientId;
    if (!broadcastId) return;
    rootLogger.debug?.('eventbus.playback_state.relay', { from: clientId, broadcastId, state: message.state });
    eventBus.broadcast(`playback:${broadcastId}`, message);
  });
}

describe('playback_state WebSocket relay handler (4.2.8)', () => {
  let eventBus;
  let rootLogger;

  beforeEach(() => {
    eventBus = createMockEventBus();
    rootLogger = createMockLogger();
    registerPlaybackStateHandler(eventBus, rootLogger);
  });

  test('rebroadcasts with deviceId when present', () => {
    const message = {
      topic: 'playback_state',
      deviceId: 'shield-tv-01',
      clientId: 'ws-client-abc',
      state: 'playing',
      contentId: 'plex:12345',
    };

    eventBus.simulateClientMessage('ws-client-abc', message);

    const broadcasts = eventBus.getBroadcasts();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].topic).toBe('playback:shield-tv-01');
    expect(broadcasts[0].payload).toBe(message);
  });

  test('falls back to clientId when no deviceId', () => {
    const message = {
      topic: 'playback_state',
      clientId: 'ws-client-xyz',
      state: 'paused',
    };

    eventBus.simulateClientMessage('ws-client-xyz', message);

    const broadcasts = eventBus.getBroadcasts();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].topic).toBe('playback:ws-client-xyz');
    expect(broadcasts[0].payload).toBe(message);
  });

  test('ignores messages with topic !== playback_state', () => {
    const mediaCommand = {
      topic: 'media:command',
      action: 'play',
      contentId: 'plex:999',
    };

    const randomTopic = {
      topic: 'some:other:topic',
      data: 'irrelevant',
    };

    eventBus.simulateClientMessage('client-1', mediaCommand);
    eventBus.simulateClientMessage('client-2', randomTopic);

    const broadcasts = eventBus.getBroadcasts();
    expect(broadcasts).toHaveLength(0);
  });

  test('ignores playback_state messages with no broadcastId', () => {
    const message = {
      topic: 'playback_state',
      state: 'stopped',
      // no deviceId, no clientId
    };

    eventBus.simulateClientMessage('ws-conn-1', message);

    const broadcasts = eventBus.getBroadcasts();
    expect(broadcasts).toHaveLength(0);
  });

  test('logs relay with correct metadata', () => {
    const message = {
      topic: 'playback_state',
      deviceId: 'office-speaker',
      clientId: 'ws-client-42',
      state: 'playing',
    };

    eventBus.simulateClientMessage('ws-client-42', message);

    expect(rootLogger.debug).toHaveBeenCalledWith(
      'eventbus.playback_state.relay',
      { from: 'ws-client-42', broadcastId: 'office-speaker', state: 'playing' }
    );
  });

  test('prefers deviceId over clientId for broadcast topic', () => {
    const message = {
      topic: 'playback_state',
      deviceId: 'device-A',
      clientId: 'client-B',
      state: 'buffering',
    };

    eventBus.simulateClientMessage('client-B', message);

    const broadcasts = eventBus.getBroadcasts();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].topic).toBe('playback:device-A');
  });
});
