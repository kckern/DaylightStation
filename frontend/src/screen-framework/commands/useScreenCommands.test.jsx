import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';

let capturedFilter = null;
let capturedCallback = null;

vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (filter, callback) => {
    capturedFilter = filter;
    capturedCallback = callback;
  },
}));

describe('useScreenCommands', () => {
  let actionBus;

  beforeEach(() => {
    capturedFilter = null;
    capturedCallback = null;
    actionBus = { emit: vi.fn() };
  });

  it('emits menu:open on WS menu command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ menu: 'scripture' }));
    expect(actionBus.emit).toHaveBeenCalledWith('menu:open', { menuId: 'scripture' });
  });

  it('emits escape on WS reset command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ action: 'reset' }));
    expect(actionBus.emit).toHaveBeenCalledWith('escape', {});
  });

  it('emits media:playback on WS playback command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ playback: 'next' }));
    expect(actionBus.emit).toHaveBeenCalledWith('media:playback', { command: 'next' });
  });

  it('emits media:play on WS content command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ play: 'plex:12345' }));
    expect(actionBus.emit).toHaveBeenCalledWith('media:play', { contentId: 'plex:12345' });
  });

  it('emits media:queue when queue key is present', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ queue: 'plex:67890' }));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue', { contentId: 'plex:67890' });
  });

  it('resolves legacy collection keys (hymn, scripture, etc.)', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ hymn: '113' }));
    expect(actionBus.emit).toHaveBeenCalledWith('media:play', { contentId: 'hymn:113' });
  });

  it('blocks messages from guardrail topics', () => {
    renderHook(() => useScreenCommands(
      { commands: true, guardrails: { blocked_topics: ['fitness', 'sensor'] } },
      actionBus
    ));
    act(() => capturedCallback({ topic: 'fitness', data: {} }));
    expect(actionBus.emit).not.toHaveBeenCalled();
  });

  it('blocks messages from guardrail sources', () => {
    renderHook(() => useScreenCommands(
      { commands: true, guardrails: { blocked_sources: ['mqtt'] } },
      actionBus
    ));
    act(() => capturedCallback({ source: 'mqtt', data: {} }));
    expect(actionBus.emit).not.toHaveBeenCalled();
  });

  it('blocks sensor-like messages', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));
    act(() => capturedCallback({ equipmentId: 'hr-monitor', data: {} }));
    expect(actionBus.emit).not.toHaveBeenCalled();
  });

  it('does not subscribe when commands is false', () => {
    renderHook(() => useScreenCommands({ commands: false }, actionBus));
    expect(capturedFilter).toBeNull();
  });

  it('does not subscribe when config is undefined', () => {
    renderHook(() => useScreenCommands(undefined, actionBus));
    expect(capturedFilter).toBeNull();
  });
});
