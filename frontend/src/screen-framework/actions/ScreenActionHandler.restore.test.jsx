// media:restore-snapshot — the screen half of Put it back, resume after a
// sleep timer and power-cut re-adoption: bootstrap a playback owner when
// none is mounted, then adopt the snapshot (paused unless autoplay).
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { ScreenOverlayProvider } from '../overlays/ScreenOverlayProvider.jsx';
import { ScreenActionHandler } from './ScreenActionHandler.jsx';
import { SessionSourceProvider } from '../publishers/SessionSourceContext.jsx';
import { __resetPlayerQueueOpRegistryForTests } from '../../modules/Player/lib/queueOpRegistry.js';

vi.mock('../../modules/Menu/MenuStack.jsx', () => ({ default: () => <div data-testid="menu-stack" /> }));
vi.mock('../../modules/Player/Player.jsx', () => ({
  default: React.forwardRef(function MockPlayer(_props, ref) { return <div ref={ref} data-testid="player">Player</div>; }),
}));

const snapshot = {
  sessionId: 'old-session', state: 'paused', position: 321,
  currentItem: { contentId: 'plex:1', queueItemId: 'q1', format: 'video' },
  queue: { items: [{ contentId: 'plex:1', queueItemId: 'q1' }, { contentId: 'plex:2', queueItemId: 'q2' }], currentIndex: 0, upNextCount: 0, executionOrder: ['q1', 'q2'] },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'tv', updatedAt: 'x', playbackOwner: { ownerInstanceId: 'stale' }, queueOwner: { ownerInstanceId: 'stale' } },
};

function setup() {
  const owner = () => (document.querySelector('[data-testid="player"]') ? { ownerInstanceId: 'p' } : null);
  const source = {
    ownerId: 'tv',
    getActionOwner: owner,
    capture: () => ({ snapshot: null, identity: owner() }),
    adopt: vi.fn(() => ({ ok: true })),
    applyQueue: vi.fn(),
  };
  const results = vi.fn();
  getActionBus().subscribe('media:restore-snapshot-result', results);
  const view = render(
    <ScreenOverlayProvider>
      <SessionSourceProvider source={source}>
        <ScreenActionHandler />
      </SessionSourceProvider>
    </ScreenOverlayProvider>,
  );
  return { source, results, view };
}

describe('ScreenActionHandler — media:restore-snapshot', () => {
  beforeEach(() => { resetActionBus(); __resetPlayerQueueOpRegistryForTests(); });

  it('mounts a player when idle and adopts the snapshot paused, minus stale owner proof', async () => {
    const { source, results, view } = setup();
    act(() => getActionBus().emit('media:restore-snapshot', { snapshot, autoplay: false, reason: 'power-restore', requestId: 'r1' }));
    await view.findByTestId('player');
    await waitFor(() => expect(results).toHaveBeenCalledWith({ requestId: 'r1', ok: true }));
    const [adopted, options] = source.adopt.mock.calls[0];
    expect(adopted).toMatchObject({ position: 321, queue: { currentIndex: 0 } });
    expect(adopted.meta).not.toHaveProperty('playbackOwner');
    expect(adopted.meta).not.toHaveProperty('queueOwner');
    expect(options).toMatchObject({ autoplay: false });
  });

  it('reports a failed adoption', async () => {
    const { source, results } = setup();
    source.adopt.mockReturnValue({ ok: false, code: 'INVALID_SNAPSHOT' });
    act(() => getActionBus().emit('media:restore-snapshot', { snapshot, autoplay: true, requestId: 'r2' }));
    await waitFor(() => expect(results).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r2', ok: false, code: 'INVALID_SNAPSHOT' })));
  });

  it('refuses to adopt when a start arrived after the restore began (WakeAndLoad play-now in the window)', async () => {
    const { source, results } = setup();
    act(() => getActionBus().emit('media:restore-snapshot', { snapshot, autoplay: false, reason: 'power-restore', requestId: 'r3' }));
    act(() => getActionBus().emit('media:queue-op', { op: 'play-now', contentId: 'plex:new', commandId: 'wake-1' }));
    await waitFor(() => expect(results).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r3', ok: false, code: 'RESTORE_SUPERSEDED' })));
    expect(source.adopt).not.toHaveBeenCalled();
  });

  it('a power restore refuses when the owner already holds an item at adopt time', async () => {
    const { source, results } = setup();
    source.getSnapshot = () => ({ currentItem: { contentId: 'plex:new' } });
    act(() => getActionBus().emit('media:restore-snapshot', { snapshot, autoplay: false, reason: 'power-restore', requestId: 'r4' }));
    await waitFor(() => expect(results).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r4', ok: false, code: 'RESTORE_SUPERSEDED' })));
    expect(source.adopt).not.toHaveBeenCalled();
  });
});

describe('ScreenActionHandler — media:adopt-snapshot (§6.2.4)', () => {
  beforeEach(() => { resetActionBus(); __resetPlayerQueueOpRegistryForTests(); });

  it('an idle screen adopts a moved snapshot (PLACE.9a): mounts a player and adopts it, playing', async () => {
    const { source, view } = setup();
    act(() => getActionBus().emit('media:adopt-snapshot', { snapshot: { ...snapshot, state: 'playing' }, autoplay: true, commandId: 'move-1:adopt' }));
    await view.findByTestId('player');
    await waitFor(() => expect(source.adopt).toHaveBeenCalled());
    const [adopted, options] = source.adopt.mock.calls[0];
    expect(adopted).toMatchObject({ position: 321, currentItem: { contentId: 'plex:1' } });
    expect(adopted.meta).not.toHaveProperty('playbackOwner');
    expect(options).toMatchObject({ autoplay: true });
  });
});
