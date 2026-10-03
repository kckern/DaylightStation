// PLAY.4a — a play that continued from a saved spot carries Start over on its
// own outcome record; Start over restarts the current item on that screen.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const DaylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => DaylightAPI(...a) }));
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { DispatchProvider } from './DispatchProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { PeekContext } from '../peek/PeekContext.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';

const remote = { transport: { restartCurrent: vi.fn(() => Promise.resolve({ ok: true })) } };
const local = { transport: { restartCurrent: vi.fn() }, execute: vi.fn(() => ({ ok: true })) };

function harness() {
  const wrapper = ({ children }) => (
    <LocalSessionContext.Provider value={{ controller: local }}>
      <PeekContext.Provider value={{ getController: () => remote }}>
        <DispatchProvider>{children}</DispatchProvider>
      </PeekContext.Provider>
    </LocalSessionContext.Provider>
  );
  return renderHook(() => useDispatch(), { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('Start over', () => {
  it('records startOver/resumedFrom on a local play and replays the item here from the beginning', async () => {
    const { result } = harness();
    let id;
    act(() => { id = result.current.recordLocal({ kind: 'play', phase: 'confirmed', item: { contentId: 'plex:1', title: 'A' },
      command: { kind: 'playNow', item: { contentId: 'plex:1', title: 'A', format: 'video' } }, startOver: true, resumedFrom: 600 }); });
    expect(result.current.outcomes.get(id)).toMatchObject({ startOver: true, resumedFrom: 600 });
    await act(async () => { await result.current.startOver(id); });
    // A replay at 0 with no server resume works even while the item is still
    // loading, where a seek would be overridden by the pending start offset.
    expect(local.execute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'playNow', item: expect.objectContaining({ contentId: 'plex:1', seconds: 0, resume: false }),
    }));
    expect(local.transport.restartCurrent).not.toHaveBeenCalled();
    expect(result.current.outcomes.has(id)).toBe(false);
    expect([...result.current.outcomes.values()].some(r => r.kind === 'startOver')).toBe(true);
  });

  it('records startOver on a far play and restarts that screen', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const { result } = harness();
    let id;
    await act(async () => {
      [id] = await result.current.dispatchToTarget({ targetIds: ['livingroom-tv'], play: 'plex:1', mode: 'fork', title: 'A', startOver: true, resumedFrom: 600 });
    });
    expect(result.current.outcomes.get(id)).toMatchObject({ startOver: true, resumedFrom: 600 });
    await act(async () => { await result.current.startOver(id); });
    expect(remote.transport.restartCurrent).toHaveBeenCalled();
  });

  it('does nothing for a record that did not resume', async () => {
    const { result } = harness();
    let id;
    act(() => { id = result.current.recordLocal({ kind: 'play', phase: 'confirmed', item: { contentId: 'plex:1' } }); });
    await act(async () => { await result.current.startOver(id); });
    expect(local.transport.restartCurrent).not.toHaveBeenCalled();
  });
});
