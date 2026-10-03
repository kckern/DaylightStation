// RELY.7a / RELY.5a at the bridge: a restored session never mounts the
// Player until an explicit Play, and a terminal Player failure reaches the
// controller as a failure rather than as a normal end.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { createLocalSessionController } from './LocalSessionController.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

let latestProps = null;
const mounts = vi.fn();
vi.mock('../../Player/Player.jsx', () => ({
  default: React.forwardRef(function MockPlayer(props, ref) {
    latestProps = props;
    React.useImperativeHandle(ref, () => ({
      play: () => {}, pause: () => {}, seek: () => {}, getMediaElement: () => null,
      getMountedContentId: () => props.play?.contentId ?? null,
    }));
    React.useEffect(() => { mounts(props.play); }, []);
    return <audio data-testid="mock-player" />;
  }),
}));

const { PlayerBridge } = await import('./PlayerBridge.jsx');

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });
const restored = {
  sessionId: 'old', state: 'playing', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 },
  position: 321,
  queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 40, playbackRate: 1 },
  meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
};

function mount(controller) {
  return render(
    <LocalSessionContext.Provider value={{ controller }}>
      <PlayerHostProvider><PlayerBridge /></PlayerHostProvider>
    </LocalSessionContext.Provider>,
  );
}

beforeEach(() => { latestProps = null; mounts.mockClear(); });

describe('PlayerBridge recovery', () => {
  it('does not mount the Player for a restored session until Play, then starts at the restored spot', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    const view = mount(controller);
    expect(view.queryByTestId('mock-player')).toBeNull();
    expect(mounts).not.toHaveBeenCalled();
    act(() => { controller.transport.play(); });
    expect(view.getByTestId('mock-player')).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(mounts.mock.calls[0][0]).toEqual(expect.objectContaining({ contentId: 'plex:1', seconds: 321 }));
  });

  it('reports a terminal Player failure to the controller as a failure', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    mount(controller);
    act(() => { controller.transport.play(); });
    const spy = vi.spyOn(controller, 'onPlayerError');
    act(() => { latestProps.onError({ kind: 'resilience-exhausted', reason: 'stall', attempts: 3 }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ code: 'resilience-exhausted' }));
    expect(controller.problems.get()).toEqual(expect.objectContaining({ kind: 'skipped', item: expect.objectContaining({ contentId: 'plex:1' }) }));
  });

  it('ignores a non-terminal media error that resilience may still recover', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    mount(controller);
    act(() => { controller.transport.play(); });
    const spy = vi.spyOn(controller, 'onPlayerError');
    act(() => { latestProps.onError({ kind: 'media-error', code: 2 }); });
    expect(spy).not.toHaveBeenCalled();
  });
});
