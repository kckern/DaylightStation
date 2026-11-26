import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';

let capturedCallback = null;
vi.mock('../../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, callback) => { capturedCallback = callback; },
}));
vi.mock('../../../../frontend/src/services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));

const press = (params, commandId = 'p1') => ({
  type: 'command', command: 'input', params, commandId, targetDevice: 'tv-1',
  origin: { kind: 'device', id: 'fleet:phone', name: 'Phone' },
});

describe('useScreenCommands — input (a phone D-pad press)', () => {
  let actionBus; let keys; let onKey; let controls;
  beforeEach(() => {
    keys = [];
    onKey = (e) => keys.push({ key: e.key, gamepad: e.__gamepadSynthetic, remote: e.__remoteSynthetic });
    window.addEventListener('keydown', onKey);
    controls = { stampOrigin: vi.fn(), markHumanInput: vi.fn(), noteRemoteCommand: vi.fn() };
  });
  afterEach(() => window.removeEventListener('keydown', onKey));

  const mount = (consumes) => {
    actionBus = { emit: vi.fn((action) => (action === 'navigate' || action === 'select' || action === 'escape') ? consumes : undefined) };
    renderHook(() => useScreenCommands({ commands: true, guardrails: { device: 'tv-1' } }, actionBus, 'screen-a', controls));
  };

  it('goes to the ActionBus first, and an owner that consumes it gets no keydown', () => {
    mount(true);
    act(() => capturedCallback(press({ action: 'navigate', direction: 'left' })));
    expect(actionBus.emit).toHaveBeenCalledWith('navigate', { direction: 'left' });
    expect(keys).toEqual([]);
    expect(actionBus.emit).toHaveBeenCalledWith('remote:input-delivered', { commandId: 'p1', went: 'bus' });
  });

  it('falls back to a synthetic keydown marked like a gamepad press when nothing consumed it', () => {
    mount(undefined);
    act(() => capturedCallback(press({ action: 'navigate', direction: 'down' })));
    act(() => capturedCallback(press({ action: 'select' }, 'p2')));
    act(() => capturedCallback(press({ action: 'escape' }, 'p3')));
    expect(keys).toEqual([
      { key: 'ArrowDown', gamepad: true, remote: true },
      { key: 'Enter', gamepad: true, remote: true },
      { key: 'Escape', gamepad: true, remote: true },
    ]);
    expect(actionBus.emit).toHaveBeenCalledWith('remote:input-delivered', { commandId: 'p3', went: 'keydown' });
  });

  it('is human input but not provenance: no origin stamp, no screen note', () => {
    mount(true);
    act(() => capturedCallback(press({ action: 'select' })));
    expect(controls.markHumanInput).toHaveBeenCalled();
    expect(controls.stampOrigin).not.toHaveBeenCalled();
    expect(controls.noteRemoteCommand).not.toHaveBeenCalled();
  });

  it('ignores a press for another screen and an invalid press', () => {
    mount(true);
    act(() => capturedCallback({ ...press({ action: 'select' }), targetDevice: 'tv-2' }));
    act(() => capturedCallback(press({ action: 'navigate' })));
    expect(actionBus.emit).not.toHaveBeenCalled();
  });
});
