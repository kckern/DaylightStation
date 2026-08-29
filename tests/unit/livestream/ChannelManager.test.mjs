// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ChannelManager } from '../../../backend/src/3_applications/livestream/ChannelManager.mjs';

// Adapters are injected as factories by the composition root; tests inject mocks.
function makeMockRuntime() {
  return {
    dispose: vi.fn(),
    play: vi.fn(),
    stopSource: vi.fn(),
    playSilence: vi.fn(),
    playAmbientLoop: vi.fn(),
    openListener: vi.fn(() => ({ clientId: 'client-1', pipeTo: vi.fn(), close: vi.fn() })),
  };
}

describe('ChannelManager', () => {
  let manager;
  let mockBroadcast;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    mockBroadcast = vi.fn();
    manager = new ChannelManager({
      broadcastEvent: mockBroadcast,
      createChannelRuntime: vi.fn(() => makeMockRuntime()),
      loadProgram: vi.fn(),
      clock: () => new Date('2026-08-28T12:00:00.000Z'),
      random: () => 0.5,
      scheduler: { after: () => () => {} },
      logger: mockLogger,
    });
  });

  afterEach(() => {
    manager.destroyAll();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a named channel', () => {
      manager.create('yoto', { bitrate: 96, ambient: 'silence' });
      const channels = manager.listChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0].name).toBe('yoto');
    });

    it('throws if channel name already exists', () => {
      manager.create('yoto', {});
      expect(() => manager.create('yoto', {})).toThrow(/already exists/);
    });

    it('starts the FFmpeg encoder', () => {
      manager.create('yoto', {});
      const status = manager.getStatus('yoto');
      expect(status).toBeTruthy();
      expect(status.name).toBe('yoto');
    });
  });

  describe('destroy', () => {
    it('stops and removes a channel', () => {
      manager.create('yoto', {});
      manager.destroy('yoto');
      expect(manager.listChannels()).toHaveLength(0);
    });

    it('throws if channel does not exist', () => {
      expect(() => manager.destroy('nonexistent')).toThrow(/not found/);
    });
  });

  describe('queue', () => {
    it('adds files to channel queue', () => {
      manager.create('yoto', {});
      manager.queueFiles('yoto', ['/audio/a.mp3', '/audio/b.mp3']);
      const status = manager.getStatus('yoto');
      expect(status.queueLength).toBe(2);
    });

    it('broadcasts queue update', () => {
      manager.create('yoto', {});
      manager.queueFiles('yoto', ['/audio/a.mp3']);
      expect(mockBroadcast).toHaveBeenCalledWith(
        'livestream:yoto',
        expect.objectContaining({ name: 'yoto' })
      );
    });
  });

  describe('forcePlay', () => {
    it('sets force track on channel', () => {
      manager.create('yoto', {});
      manager.forcePlay('yoto', '/audio/urgent.mp3');
      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('skip', () => {
    it('triggers next track', () => {
      manager.create('yoto', {});
      manager.queueFiles('yoto', ['/audio/a.mp3', '/audio/b.mp3']);
      manager.skip('yoto');
      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('openListener', () => {
    it('returns a semantic listener subscription', () => {
      manager.create('yoto', {});
      const { pipeTo, close, clientId } = manager.openListener('yoto');
      expect(typeof pipeTo).toBe('function');
      expect(typeof close).toBe('function');
      expect(typeof clientId).toBe('string');
    });

    it('throws if channel does not exist', () => {
      expect(() => manager.openListener('nope')).toThrow(/not found/);
    });
  });

  describe('sendInput', () => {
    it('stores input choice on channel', () => {
      manager.create('yoto', {});
      expect(() => manager.sendInput('yoto', 'a')).not.toThrow();
    });
  });

  describe('listChannels', () => {
    it('returns all channels as JSON', () => {
      manager.create('yoto', { bitrate: 96 });
      manager.create('office', { bitrate: 128 });
      const list = manager.listChannels();
      expect(list).toHaveLength(2);
      expect(list.map(c => c.name).sort()).toEqual(['office', 'yoto']);
    });
  });
});
