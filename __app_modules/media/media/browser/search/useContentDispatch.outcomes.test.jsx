// RELY.1a — every play/add confirms through the one outcome system, the same
// way whichever control started it; Mantine toasts are not a second voice.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => ({ view: 'home', params: {}, push: vi.fn() }) }));
const dispatchToTarget = vi.fn(() => Promise.resolve(['d-1']));
const recordLocal = vi.fn(() => 'local-attempt');
const resolveLocal = vi.fn();
vi.mock("../cast/useDispatch.js", () => ({
  useDispatch: () => ({ dispatchToTarget, dispatches: new Map(), retry: vi.fn(), recordLocal, resolveLocal }),
}));
let selectedOverrides = {};
vi.mock('../quality/PlaybackQualityProvider.jsx', () => ({ usePlaybackQuality: () => ({ getOverrides: id => selectedOverrides[id] ?? {} }) }));
let controller;
vi.mock("../controller/useSessionController.js", () => ({
  useSessionController: () => ({ controller, queue: controller?.queue, config: controller?.config }),
}));
let aim = { targetIds: [], mode: 'fork' };
vi.mock("../cast/useCastTarget.js", () => ({ useCastTarget: () => aim }));
vi.mock("../fleet/useFleetContext.js", () => ({ useFleetContext: () => ({ devices: [{ id: 'office-tv', name: 'Office TV' }] }) }));
const notificationsShow = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: (...a) => notificationsShow(...a), hide: vi.fn() } }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { createLocalSessionController } from "../session/LocalSessionController.js";
import { useContentDispatch } from "./useContentDispatch.js";

beforeEach(() => {
  vi.clearAllMocks();
  selectedOverrides = {};
  aim = { targetIds: [], mode: 'fork' };
  controller = createLocalSessionController({ clientId: 'outcome-client' });
  controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
});

describe('useContentDispatch outcomes', () => {
  it('a local Play records one quiet confirmation naming the item, with Undo, and no toast', async () => {
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatch('plex:55854', { title: 'Arrival', format: 'video' }); await Promise.resolve(); });
    expect(recordLocal).toHaveBeenCalledTimes(1);
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'play', phase: 'running', item: expect.objectContaining({ contentId: 'plex:55854', title: 'Arrival' }),
      undo: expect.objectContaining({ operationId: expect.any(String), run: expect.any(Function) }),
    }));
    expect(resolveLocal).toHaveBeenCalledWith('local-attempt', expect.objectContaining({ phase: 'confirmed' }));
    expect(notificationsShow).not.toHaveBeenCalled();
  });

  it('a local Add from a different control confirms the same way', async () => {
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatchLeafVerb('add', 'plex:697368', { title: 'Disclosure Day', format: 'video' }); await Promise.resolve(); });
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'add', phase: 'running', item: expect.objectContaining({ title: 'Disclosure Day' }) }));
    expect(resolveLocal).toHaveBeenCalledWith('local-attempt', expect.objectContaining({ phase: 'confirmed', ordinal: 1 }));
    expect(notificationsShow).not.toHaveBeenCalled();
  });

  it('an aimed Play leaves confirmation to the dispatch outcome, not a toast', async () => {
    aim = { targetIds: ['office-tv'], mode: 'fork' };
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatch('plex:55854', { title: 'Arrival', format: 'video' }); await Promise.resolve(); });
    expect(dispatchToTarget).toHaveBeenCalled();
    expect(notificationsShow).not.toHaveBeenCalled();
    expect(recordLocal).not.toHaveBeenCalled();
  });

  it('a rejected local action is reported as a failed outcome', async () => {
    controller.execute = vi.fn(() => ({ ok: false, code: 'ITEM_ACTION_FAILED', reason: 'This screen is busy' }));
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatchLeafVerb('add', 'plex:697368', { title: 'Disclosure Day', format: 'video' }); await Promise.resolve(); await Promise.resolve(); });
    expect(resolveLocal).toHaveBeenCalledWith('local-attempt', expect.objectContaining({ phase: 'failed', reason: 'This screen is busy' }));
    expect(notificationsShow).not.toHaveBeenCalled();
  });
});


describe('selected quality dispatch', () => {
  it('attaches per-item overrides to local playback and preserves them in the queue', async () => {
    selectedOverrides = { 'plex:42': { maxResolution: '720', maxVideoBitrate: 4000, transcode: 'force', adaptive: false } };
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatch('plex:42', { title: 'Movie', format: 'video' }); });
    expect(controller.getSnapshot().currentItem).toMatchObject(selectedOverrides['plex:42']);
    expect(controller.getSnapshot().queue.items[0]).toMatchObject(selectedOverrides['plex:42']);
    await act(async () => { result.current.dispatchLeafVerb('add', 'plex:43', { title: 'Other', format: 'video' }); });
    expect(controller.getSnapshot().queue.items[1]).not.toHaveProperty('maxResolution');
  });
  it('sends selected overrides in the remote item action', async () => {
    selectedOverrides = { 'plex:42': { maxResolution: '720', adaptive: false } };
    aim = { targetIds: ['office-tv'], mode: 'fork' };
    const { result } = renderHook(() => useContentDispatch());
    await act(async () => { result.current.dispatch('plex:42', { title: 'Movie', format: 'video' }); });
    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({ itemAction: expect.objectContaining({ item: expect.objectContaining(selectedOverrides['plex:42']) }) }));
  });
});
