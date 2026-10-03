import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';
import { createScreenSessionControls } from '../session/screenSessionControls.js';

let capturedCallback = null;
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, callback) => { capturedCallback = callback; },
}));
vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));

const env = (command, params, extra = {}) => ({
  type: 'command', command, params, commandId: extra.commandId ?? 'c1', targetDevice: 'tv-1', ...extra,
});
const phone = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };
const playing = {
  sessionId: 's', state: 'playing', position: 10,
  currentItem: { contentId: 'plex:1', queueItemId: 'q1', format: 'video' },
  queue: { items: [{ contentId: 'plex:1', queueItemId: 'q1', format: 'video' }], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50 }, meta: { ownerId: 'tv-1', updatedAt: 'x' },
};

describe('useScreenCommands — screen session controls', () => {
  let actionBus;
  let controls;
  let snapshot;

  beforeEach(() => {
    capturedCallback = null;
    actionBus = { emit: vi.fn() };
    snapshot = playing;
    controls = createScreenSessionControls({ ownerId: 'tv-1', ports: { getSnapshot: () => snapshot } });
  });

  const mount = () => renderHook(() => useScreenCommands(
    { commands: true, guardrails: { device: 'tv-1' } }, actionBus, 'screen-a', controls,
  ));

  it('turns a remote play-now into an add while Add only is on, and says so', () => {
    controls.applyConfig('addOnly', true);
    mount();
    act(() => capturedCallback(env('queue', { op: 'play-now', contentId: 'plex:9' }, { origin: phone })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({
      op: 'add', contentId: 'plex:9', commandId: 'c1', appliedAs: 'add', requestedOp: 'play-now', origin: phone,
    }));
    expect(controls.toPublished().notes).toEqual([]);
  });

  it('turns a remote item-action Play into an Add while Add only is on', () => {
    controls.applyConfig('addOnly', true);
    mount();
    act(() => capturedCallback(env('queue', {
      op: 'item-action', kind: 'playNow', item: { contentId: 'plex:9' }, operationId: 'op1', tappedAt: 1,
    }, { origin: phone })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({
      op: 'item-action', kind: 'add', appliedAs: 'add', requestedKind: 'playNow',
    }));
  });

  it('plays normally under Add only when nothing is playing (nothing to protect)', () => {
    controls.applyConfig('addOnly', true);
    snapshot = { ...playing, state: 'idle', currentItem: null, queue: { items: [], currentIndex: -1, upNextCount: 0 } };
    mount();
    act(() => capturedCallback(env('queue', { op: 'play-now', contentId: 'plex:9' })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({ op: 'play-now' }));
  });

  it('records a note for a remote replace / pause and stamps the origin, but not for volume', () => {
    mount();
    act(() => capturedCallback(env('config', { setting: 'volume', value: 20 }, { origin: phone })));
    expect(controls.getOrigin()).toBeNull();
    act(() => capturedCallback(env('transport', { action: 'pause' }, { origin: phone, commandId: 'c2' })));
    expect(controls.toPublished().notes[0]).toMatchObject({ kind: 'paused', label: "Paused by Dad's phone" });
    expect(controls.getOrigin()).toEqual(phone);
    expect(actionBus.emit).toHaveBeenCalledWith('media:playback', { command: 'pause', commandId: 'c2', origin: phone });
  });

  it('routes session flags and session actions to the controls host', () => {
    mount();
    act(() => capturedCallback(env('config', { setting: 'endOfQueue', value: 'similar' }, { commandId: 'k1' })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:session-control', {
      kind: 'config', setting: 'endOfQueue', value: 'similar', commandId: 'k1',
    });
    expect(actionBus.emit).not.toHaveBeenCalledWith('media:config-set', expect.anything());
    act(() => capturedCallback(env('session', { action: 'sleep-timer', minutes: 15 }, { commandId: 's1', origin: phone })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:session-control', {
      kind: 'session', action: 'sleep-timer', params: { minutes: 15 }, commandId: 's1', origin: phone,
    });
  });

  it('exempts routine and originless starts from Add only — they play (B5)', () => {
    controls.applyConfig('addOnly', true);
    mount();
    act(() => capturedCallback(env('queue', { op: 'play-now', contentId: 'plex:9' }, { commandId: 'r1', origin: { kind: 'routine', name: 'Morning' } })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({ op: 'play-now', commandId: 'r1' }));
    act(() => capturedCallback(env('queue', { op: 'play-now', contentId: 'plex:8' }, { commandId: 'n1' })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({ op: 'play-now', commandId: 'n1' }));
  });

  it('treats the screen\'s own origin as local: no Add-only rewrite and no note', () => {
    controls.applyConfig('addOnly', true);
    mount();
    act(() => capturedCallback(env('queue', { op: 'play-now', contentId: 'plex:9' }, { origin: { kind: 'device', id: 'fleet:tv-1' } })));
    expect(actionBus.emit).toHaveBeenCalledWith('media:queue-op', expect.objectContaining({ op: 'play-now' }));
    act(() => capturedCallback(env('transport', { action: 'pause' }, { commandId: 'c9', origin: { kind: 'device', id: 'tv-1' } })));
    expect(controls.toPublished().notes).toEqual([]);
  });

  it('a redelivered envelope (same commandId) never bumps a note twice', () => {
    mount();
    const pause = env('transport', { action: 'pause' }, { commandId: 'dup', origin: phone });
    act(() => capturedCallback(pause));
    act(() => capturedCallback(pause));
    expect(controls.toPublished().notes[0].count).toBe(1);
  });
});
