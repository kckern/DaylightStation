// PLAY.4a — a Play that continues from a saved spot marks its outcome with
// Start over; a chosen spot rides the item as an explicit start position.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ view: 'home', params: {}, push: vi.fn() }) }));
const dispatchToTarget = vi.fn(() => Promise.resolve(['d-1']));
const recordLocal = vi.fn(() => 'local-attempt');
const resolveLocal = vi.fn();
vi.mock('../cast/useDispatch.js', () => ({
  useDispatch: () => ({ dispatchToTarget, dispatches: new Map(), retry: vi.fn(), recordLocal, resolveLocal }),
}));
let controller;
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ controller, queue: controller?.queue, config: controller?.config }),
}));
let aim = { targetIds: [], mode: 'fork' };
vi.mock('../cast/useCastTarget.js', () => ({ useCastTarget: () => aim }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { createLocalSessionController } from '../session/LocalSessionController.js';
import { useContentDispatch } from './useContentDispatch.js';

beforeEach(() => {
  vi.clearAllMocks();
  aim = { targetIds: [], mode: 'fork' };
  controller = createLocalSessionController({ clientId: 'spots-client' });
  controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
});

describe('Play from a saved spot', () => {
  it('continuing (server resume) records Start over without forcing a start', async () => {
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatchLeafVerb('playNow', 'plex:1', { title: 'Arrival' }, { resumedFrom: 2040 }); await Promise.resolve(); });
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'play', startOver: true, resumedFrom: 2040 }));
    const item = controller.getSnapshot().queue.items[0];
    expect(item).not.toHaveProperty('seconds');
  });

  it('a chosen spot plays from exactly there', async () => {
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatchLeafVerb('playNow', 'plex:1', { title: 'Arrival' }, { startAt: 4800 }); await Promise.resolve(); });
    expect(controller.getSnapshot().queue.items[0]).toMatchObject({ contentId: 'plex:1', seconds: 4800, resume: false });
    // …and survives into the current item the Player is given.
    expect(controller.getSnapshot().currentItem).toMatchObject({ contentId: 'plex:1', seconds: 4800, resume: false });
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ startOver: true, resumedFrom: 4800 }));
  });

  it('"from the beginning" starts at zero and offers no Start over', async () => {
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatchLeafVerb('playNow', 'plex:1', { title: 'Arrival' }, { startAt: 0 }); await Promise.resolve(); });
    expect(controller.getSnapshot().queue.items[0]).toMatchObject({ seconds: 0, resume: false });
    expect(recordLocal.mock.calls[0][0].startOver).toBeFalsy();
  });

  it('an aimed Play carries the spot and Start over to the far record', async () => {
    aim = { targetIds: ['office-tv'], mode: 'fork' };
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatchLeafVerb('playNow', 'plex:1', { title: 'Arrival' }, { startAt: 4800 }); await Promise.resolve(); });
    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({
      play: 'plex:1', startOver: true, resumedFrom: 4800,
      itemAction: expect.objectContaining({ item: expect.objectContaining({ seconds: 4800, resume: false }) }),
    }));
  });
});
