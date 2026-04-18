import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';

let capturedFilter = null;
let capturedCallback = null;

vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (filter, callback) => {
    capturedFilter = filter;
    capturedCallback = callback;
  },
}));

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
  },
}));

/** Build a minimally-valid command envelope for a given kind + params. */
function env(command, params, overrides = {}) {
  return {
    type: 'command',
    command,
    params: params ?? {},
    commandId: overrides.commandId ?? 'c1',
    targetDevice: overrides.targetDevice ?? 'tv-1',
    ...overrides,
  };
}

describe('useScreenCommands (structured envelope)', () => {
  let actionBus;

  beforeEach(() => {
    capturedFilter = null;
    capturedCallback = null;
    actionBus = { emit: vi.fn() };
  });

  function mountOk(extraConfig = {}) {
    const config = {
      commands: true,
      guardrails: { device: 'tv-1', ...(extraConfig.guardrails || {}) },
      ...extraConfig,
    };
    return renderHook(() => useScreenCommands(config, actionBus, 'screen-a'));
  }

  // ------------------------------------------------------------------
  // Transport
  // ------------------------------------------------------------------

  describe('transport', () => {
    it.each([
      ['play',      { command: 'play' }],
      ['pause',     { command: 'pause' }],
      ['stop',      { command: 'stop' }],
      ['skipNext',  { command: 'skipNext' }],
      ['skipPrev',  { command: 'skipPrev' }],
    ])('dispatches transport %s', (action, expectedPayload) => {
      mountOk();
      act(() => capturedCallback(env('transport', { action })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:playback',
        { ...expectedPayload, commandId: 'c1' },
      );
    });

    it('dispatches transport seekAbs with value', () => {
      mountOk();
      act(() => capturedCallback(env('transport', { action: 'seekAbs', value: 42 })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:seek-abs',
        { value: 42, commandId: 'c1' },
      );
    });

    it('dispatches transport seekRel with value', () => {
      mountOk();
      act(() => capturedCallback(env('transport', { action: 'seekRel', value: -10 })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:seek-rel',
        { value: -10, commandId: 'c1' },
      );
    });
  });

  // ------------------------------------------------------------------
  // Queue ops
  // ------------------------------------------------------------------

  describe('queue', () => {
    it('dispatches queue play-now with contentId', () => {
      mountOk();
      act(() => capturedCallback(env('queue', { op: 'play-now', contentId: 'plex:1' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:queue-op',
        { op: 'play-now', contentId: 'plex:1', commandId: 'c1' },
      );
    });

    it('dispatches queue remove with queueItemId', () => {
      mountOk();
      act(() => capturedCallback(env('queue', { op: 'remove', queueItemId: 'q-123' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:queue-op',
        { op: 'remove', queueItemId: 'q-123', commandId: 'c1' },
      );
    });

    it('dispatches queue reorder with from/to', () => {
      mountOk();
      act(() => capturedCallback(env('queue', { op: 'reorder', from: 'q-1', to: 'q-5' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:queue-op',
        { op: 'reorder', from: 'q-1', to: 'q-5', commandId: 'c1' },
      );
    });

    it('dispatches queue clear', () => {
      mountOk();
      act(() => capturedCallback(env('queue', { op: 'clear' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:queue-op',
        { op: 'clear', commandId: 'c1' },
      );
    });
  });

  // ------------------------------------------------------------------
  // Config
  // ------------------------------------------------------------------

  describe('config', () => {
    it('dispatches config setting shuffle', () => {
      mountOk();
      act(() => capturedCallback(env('config', { setting: 'shuffle', value: true })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:config-set',
        { setting: 'shuffle', value: true, commandId: 'c1' },
      );
    });

    it('dispatches config setting repeat', () => {
      mountOk();
      act(() => capturedCallback(env('config', { setting: 'repeat', value: 'all' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:config-set',
        { setting: 'repeat', value: 'all', commandId: 'c1' },
      );
    });

    it('dispatches config setting shader and also emits display:shader', () => {
      mountOk();
      act(() => capturedCallback(env('config', { setting: 'shader', value: 'wave' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:config-set',
        { setting: 'shader', value: 'wave', commandId: 'c1' },
      );
      expect(actionBus.emit).toHaveBeenCalledWith(
        'display:shader',
        { shader: 'wave' },
      );
      expect(actionBus.emit).toHaveBeenCalledTimes(2);
    });

    it('dispatches config setting volume and also emits display:volume', () => {
      mountOk();
      act(() => capturedCallback(env('config', { setting: 'volume', value: 75 })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:config-set',
        { setting: 'volume', value: 75, commandId: 'c1' },
      );
      expect(actionBus.emit).toHaveBeenCalledWith(
        'display:volume',
        { level: 75 },
      );
      expect(actionBus.emit).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------------------------------
  // Adopt snapshot
  // ------------------------------------------------------------------

  describe('adopt-snapshot', () => {
    it('dispatches adopt-snapshot with snapshot payload', () => {
      const snapshot = createIdleSessionSnapshot({ sessionId: 's-1', ownerId: 'tv-1' });
      mountOk();
      act(() => capturedCallback(env('adopt-snapshot', { snapshot, autoplay: false })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:adopt-snapshot',
        { snapshot, autoplay: false, commandId: 'c1' },
      );
    });

    it('defaults autoplay to true when not provided', () => {
      const snapshot = createIdleSessionSnapshot({ sessionId: 's-1', ownerId: 'tv-1' });
      mountOk();
      act(() => capturedCallback(env('adopt-snapshot', { snapshot })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:adopt-snapshot',
        { snapshot, autoplay: true, commandId: 'c1' },
      );
    });
  });

  // ------------------------------------------------------------------
  // System
  // ------------------------------------------------------------------

  describe('system', () => {
    it('dispatches system reset -> escape', () => {
      mountOk();
      act(() => capturedCallback(env('system', { action: 'reset' })));
      expect(actionBus.emit).toHaveBeenCalledWith('escape', {});
    });

    it('dispatches system sleep -> display:sleep', () => {
      mountOk();
      act(() => capturedCallback(env('system', { action: 'sleep' })));
      expect(actionBus.emit).toHaveBeenCalledWith('display:sleep', {});
    });

    it('dispatches system reload -> calls window.location.reload', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });
      mountOk();
      act(() => capturedCallback(env('system', { action: 'reload' })));
      expect(reloadMock).toHaveBeenCalled();
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('handles system wake (no-op if action not in actionMap — no throw)', () => {
      mountOk();
      // The action is valid per contracts (SYSTEM_ACTIONS includes 'wake').
      // The handler may emit display:wake OR no-op — either way, no throw.
      expect(() => {
        act(() => capturedCallback(env('system', { action: 'wake' })));
      }).not.toThrow();
    });
  });

  // ------------------------------------------------------------------
  // Targeting & broadcast suppression
  // ------------------------------------------------------------------

  describe('targeting and suppression', () => {
    it('ignores envelopes with mismatched targetDevice', () => {
      mountOk();
      act(() => capturedCallback(env('transport', { action: 'play' }, { targetDevice: 'tv-other' })));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('ignores envelopes targeting a different screen', () => {
      mountOk();
      act(() => capturedCallback(env('transport', { action: 'play' }, { targetScreen: 'screen-b' })));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('passes envelopes targeting the matching screen', () => {
      mountOk();
      act(() => capturedCallback(env('transport', { action: 'play' }, { targetScreen: 'screen-a' })));
      expect(actionBus.emit).toHaveBeenCalledWith(
        'media:playback',
        { command: 'play', commandId: 'c1' },
      );
    });

    it('ignores messages where topic === playback_state', () => {
      mountOk();
      // Playback state broadcasts carry `topic: 'playback_state'` without a
      // `command` field — they are status updates, not commands.
      act(() => capturedCallback({ topic: 'playback_state', state: 'playing' }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Validation rejections
  // ------------------------------------------------------------------

  describe('validation rejection', () => {
    it('rejects envelopes missing commandId (no emit)', () => {
      mountOk();
      act(() => capturedCallback({
        type: 'command',
        targetDevice: 'tv-1',
        command: 'transport',
        params: { action: 'play' },
        // commandId omitted
      }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('rejects envelopes with unknown command kind (no emit)', () => {
      mountOk();
      act(() => capturedCallback({
        type: 'command',
        targetDevice: 'tv-1',
        commandId: 'c1',
        command: 'bogus-kind',
        params: {},
      }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('rejects flat legacy { playback: "play" } shape (no emit)', () => {
      mountOk();
      act(() => capturedCallback({ playback: 'play' }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('rejects flat legacy { play: "contentId" } shape (no emit)', () => {
      mountOk();
      act(() => capturedCallback({ play: 'plex:12345' }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('rejects flat legacy { menu: "scripture" } shape (no emit)', () => {
      mountOk();
      act(() => capturedCallback({ menu: 'scripture' }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('rejects flat legacy { volume: 50 } shape (no emit)', () => {
      mountOk();
      act(() => capturedCallback({ volume: 50 }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('rejects flat legacy { shader: "wave" } shape (no emit)', () => {
      mountOk();
      act(() => capturedCallback({ shader: 'wave' }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Enable / disable
  // ------------------------------------------------------------------

  describe('enablement', () => {
    it('does nothing when disabled (wsConfig.commands !== true)', () => {
      renderHook(() => useScreenCommands({ commands: false }, actionBus, 'screen-a'));
      // Filter must reject everything, including valid envelopes.
      expect(capturedFilter).not.toBeNull();
      expect(capturedFilter(env('transport', { action: 'play' }))).toBe(false);
    });

    it('does nothing when config is undefined', () => {
      renderHook(() => useScreenCommands(undefined, actionBus, 'screen-a'));
      expect(capturedFilter).not.toBeNull();
      expect(capturedFilter(env('transport', { action: 'play' }))).toBe(false);
    });

    it('filter accepts valid command envelopes when enabled', () => {
      mountOk();
      expect(capturedFilter(env('transport', { action: 'play' }))).toBe(true);
    });

    it('filter rejects flat-shape messages when enabled', () => {
      mountOk();
      expect(capturedFilter({ playback: 'play' })).toBe(false);
      expect(capturedFilter({ menu: 'scripture' })).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Guardrails
  // ------------------------------------------------------------------

  describe('guardrails', () => {
    it('blocks messages from guardrail topics', () => {
      renderHook(() => useScreenCommands(
        { commands: true, guardrails: { device: 'tv-1', blocked_topics: ['fitness'] } },
        actionBus,
        'screen-a',
      ));
      act(() => capturedCallback({ topic: 'fitness', ...env('transport', { action: 'play' }) }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });

    it('blocks messages from guardrail sources', () => {
      renderHook(() => useScreenCommands(
        { commands: true, guardrails: { device: 'tv-1', blocked_sources: ['mqtt'] } },
        actionBus,
        'screen-a',
      ));
      act(() => capturedCallback({ source: 'mqtt', ...env('transport', { action: 'play' }) }));
      expect(actionBus.emit).not.toHaveBeenCalled();
    });
  });
});
