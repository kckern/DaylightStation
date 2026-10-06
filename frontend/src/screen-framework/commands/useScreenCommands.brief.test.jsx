import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';
import { createScreenSessionControls } from '../session/screenSessionControls.js';
import { createScreenPlayerFeatures } from '../session/screenPlayerFeatures.js';

// Show briefly (RQ-PLAY-11, PLAY.8b): which plays go OVER the programme.
let capturedCallback = null;
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, callback) => { capturedCallback = callback; },
}));
vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));

const env = (params, origin) => ({ type: 'command', command: 'queue', params, commandId: 'c1', targetDevice: 'tv-1', ...(origin ? { origin } : {}) });
const doorbell = { kind: 'routine', name: 'Doorbell' };
const phone = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };
const playing = {
  sessionId: 's', state: 'playing', position: 10,
  currentItem: { contentId: 'plex:1', queueItemId: 'q1', format: 'video' },
  queue: { items: [{ contentId: 'plex:1', queueItemId: 'q1', format: 'video' }], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50 }, meta: { ownerId: 'tv-1', updatedAt: 'x' },
};

describe('useScreenCommands — Show briefly', () => {
  let actionBus;
  let controls;
  beforeEach(() => {
    capturedCallback = null;
    actionBus = { emit: vi.fn() };
    controls = createScreenSessionControls({ ownerId: 'tv-1', ports: { getSnapshot: () => playing } });
    controls.attachExtension(createScreenPlayerFeatures({ ownerId: 'tv-1' }));
  });
  const mount = (c = controls) => renderHook(() => useScreenCommands({ commands: true, guardrails: { device: 'tv-1' } }, actionBus, 'screen-a', c));

  it('a camera started by a routine is shown briefly by default (AC2)', () => {
    mount();
    act(() => capturedCallback(env({ op: 'play-now', contentId: 'camera:doorbell' }, doorbell)));
    expect(actionBus.emit).toHaveBeenCalledWith('media:brief', expect.objectContaining({
      kind: 'camera', cameraId: 'doorbell', contentId: 'camera:doorbell', seconds: 30, replace: false, commandId: 'c1', origin: doorbell,
    }));
    expect(actionBus.emit).not.toHaveBeenCalledWith('media:queue-op', expect.anything());
    // Not a replace: no screen note, nothing to put back.
    expect(controls.toPublished().notes).toEqual([]);
  });

  it('a routine can say otherwise: the camera then takes the screen', () => {
    mount();
    act(() => capturedCallback(env({ op: 'play-now', contentId: 'camera:doorbell', brief: '0' }, doorbell)));
    expect(actionBus.emit).toHaveBeenCalledWith('media:brief', expect.objectContaining({ kind: 'camera', seconds: null, replace: true }));
  });

  it('a clip is brief only when asked, for any screen (AC1)', () => {
    mount();
    act(() => capturedCallback(env({ op: 'play-now', contentId: 'plex:77', brief: '1', briefSeconds: '20' }, phone)));
    expect(actionBus.emit).toHaveBeenCalledWith('media:brief', expect.objectContaining({ kind: 'clip', contentId: 'plex:77', seconds: 20 }));
    actionBus.emit.mockClear();
    act(() => capturedCallback({ ...env({ op: 'play-now', contentId: 'plex:78' }, phone), commandId: 'c2' }));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({ op: 'play-now', contentId: 'plex:78' }));
  });

  it('a screen without the player features plays everything as before', () => {
    const plain = createScreenSessionControls({ ownerId: 'tv-1', ports: { getSnapshot: () => playing } });
    mount(plain);
    act(() => capturedCallback(env({ op: 'play-now', contentId: 'plex:77', brief: '1' }, phone)));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({ op: 'play-now', contentId: 'plex:77' }));
    expect(actionBus.emit).not.toHaveBeenCalledWith('media:brief', expect.anything());
  });

  it('another device\'s brief respects Add only; a routine\'s does not', () => {
    controls.applyConfig('addOnly', true);
    mount();
    act(() => capturedCallback(env({ op: 'play-now', contentId: 'plex:77', brief: '1' }, phone)));
    expect(actionBus.emit).toHaveBeenCalledWith('command-handler-error', expect.objectContaining({ code: 'ADD_ONLY', commandId: 'c1' }));
    expect(actionBus.emit).not.toHaveBeenCalledWith('media:brief', expect.anything());
    actionBus.emit.mockClear();
    act(() => capturedCallback({ ...env({ op: 'play-now', contentId: 'camera:doorbell' }, doorbell), commandId: 'c2' }));
    expect(actionBus.emit).toHaveBeenCalledWith('media:brief', expect.objectContaining({ kind: 'camera' }));
  });

  it('a brief from another device leaves a screen note and stamps who started it', () => {
    mount();
    act(() => capturedCallback(env({ op: 'play-now', contentId: 'plex:77', brief: '1' }, phone)));
    expect(controls.toPublished().notes[0]).toMatchObject({ kind: 'brief', label: "Shown briefly by Dad's phone", putBack: null });
    expect(controls.getOrigin()).toEqual(phone);
  });
});
