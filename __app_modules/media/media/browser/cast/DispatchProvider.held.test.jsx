import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DispatchProvider } from './DispatchProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { PeekContext } from '../peek/PeekContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

function makeController() {
  return createLocalSessionController({ clientId: 'screen', persistedSnapshot: {
    sessionId: 'movie-session', state: 'paused', position: 321,
    currentItem: { contentId: 'plex:1', format: 'video', title: 'Movie' },
    queue: { items: [{ contentId: 'plex:1', queueItemId: 'q1', format: 'video' }, { contentId: 'plex:2', queueItemId: 'q2', format: 'video' }], currentIndex: 0, upNextCount: 0 },
    config: { repeat: 'off', shuffle: false, volume: 50, playbackRate: 1, shader: null },
    meta: { ownerId: 'screen', updatedAt: '2026-10-26T00:00:00Z' },
  } });
}
it.each(['local', 'screen'])('held tray Retry uses the %s owner without replaying Play', async targetId => {
  const controller = makeController();
  let retries = 0;
  controller.setPlayerHandle({ retryMediaResilience: () => { retries++; return { ok: true }; } });
  controller.onPlayerError({ code: 'resilience-exhausted' });
  const before = controller.getSnapshot();
  const target = controller.recoveryIdentity.getTarget();
  const wrapper = ({ children }) => <LocalSessionContext.Provider value={{ controller }}>
    <PeekContext.Provider value={{ getController: () => controller }}><DispatchProvider>{children}</DispatchProvider></PeekContext.Provider>
  </LocalSessionContext.Provider>;
  const { result } = renderHook(useDispatch, { wrapper });
  let id;
  act(() => { id = result.current.recordLocal({ kind: 'playback', phase: 'waiting', targetId,
    item: before.currentItem, command: { kind: 'retry', target, item: before.currentItem } }); });
  await act(async () => { await result.current.retry(id); });
  expect(retries).toBe(1);
  expect(controller.getSnapshot()).toMatchObject({ state: 'paused', position: 321, currentItem: before.currentItem, queue: before.queue, config: before.config });
  expect(controller.recoveryIdentity.getTarget().visitId).toBe(target.visitId);
});
