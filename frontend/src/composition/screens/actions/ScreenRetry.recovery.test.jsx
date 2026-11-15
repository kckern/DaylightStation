import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Player from '../../../../../__capabilities/playback/browser/player/Player.jsx';
import { __resetPlayerQueueOpRegistryForTests } from '../../../../../__capabilities/playback/browser/player/lib/queueOpRegistry.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../../../../../__capabilities/playback/browser/player/lib/recoveryLedger.js';
import { recoverySessionKey } from '../../../../../__capabilities/playback/browser/contracts.mjs';
import { ScreenActionHandler } from './ScreenActionHandler.jsx';
import { ScreenOverlayProvider } from '../../../../../__capabilities/screen-host/browser/overlays.mjs';
import { getActionBus, resetActionBus } from '../../../../../__capabilities/screen-host/browser/input.mjs';
import { useCommandAckPublisher } from '../../../../../__capabilities/screen-host/browser/publishers/useCommandAckPublisher.js';
import { wsService } from '../../../services/WebSocketService.js';
import { createRemoteSessionController } from '../../../../../__app_modules/media/media/browser/peek/RemoteSessionController.js';
import { createAckRouter } from '../../../../../__app_modules/media/media/browser/peek/ackRouter.js';
import { createFleetStore } from '../../../../../__app_modules/media/media/browser/fleet/fleetStore.js';
import { DispatchProvider } from '../../../../../__app_modules/media/media/browser/cast/DispatchProvider.jsx';
import { useDispatch } from '../../../../../__app_modules/media/media/browser/cast/useDispatch.js';
import { PeekContext } from '../../../../../__app_modules/media/media/browser/peek/PeekContext.js';

// Isolate only actual IO/rendering. Player/ledger, screen handler/registry,
// ACK publisher/router, remote controller and tray dispatcher all stay real.
vi.mock('../../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ items: [] }) }));
vi.mock('../../../../../__capabilities/playback/browser/player/components/SinglePlayer.jsx', () => ({ SinglePlayer: () => <div /> }));
vi.mock('../../../../../__app_modules/media/media/browser/menu.mjs', () => ({ default: () => null }));
vi.mock('../../../../../__app_modules/media/media/browser/net/ws.js', () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));

let now, ledger;
beforeEach(() => {
  now = 100000; resetActionBus(); __resetPlayerQueueOpRegistryForTests();
  ledger = createRecoveryLedger({ now: () => now }); _setSharedLedgerForTests(ledger);
  wsService.send.mockReset();
});
afterEach(() => { cleanup(); _setSharedLedgerForTests(null); });
const movie = { contentId: 'plex:movie', format: 'video', title: 'Movie' };
const acks = () => wsService.send.mock.calls.map(([message]) => message).filter(message => message.topic === 'device-ack');
function AckHost() { useCommandAckPublisher({ deviceId: 'tv', actionBus: getActionBus() }); return null; }

async function harness() {
  const owner = React.createRef(); const router = createAckRouter();
  const remote = createRemoteSessionController({ deviceId: 'tv', fleetStore: createFleetStore(), ackRouter: router,
    randomUuid: () => 'retry-command', http: async (_url, body) => {
      getActionBus().emit('media:playback', { command: body.action, commandId: body.commandId, target: body.value });
      return { ok: true };
    } });
  wsService.send.mockImplementation(message => { if (message.topic === 'device-ack') router.resolve(message); });
  let tray;
  function Probe() { tray = useDispatch(); return null; }
  render(<PeekContext.Provider value={{ getController: () => remote }}><DispatchProvider>
    <ScreenOverlayProvider><AckHost /><ScreenActionHandler /><Player ref={owner} play={[movie]} /><Probe /></ScreenOverlayProvider>
  </DispatchProvider></PeekContext.Provider>);
  await waitFor(() => expect(owner.current?.getQueueSnapshot().items).toHaveLength(1));
  const target = owner.current.getRecoveryTarget();
  let row;
  act(() => { row = tray.recordLocal({ kind: 'playback', phase: 'waiting', targetId: 'tv', item: movie, command: { kind: 'retry', item: movie, target } }); });
  return { owner, target, row, remote, getTray: () => tray };
}

it.each(['PLAYBACK_CHANGED', 'rolling-cap'])('screen Retry carries actual %s rejection to ACK and keeps the held tray row', async code => {
  const h = await harness();
  if (code === 'PLAYBACK_CHANGED') act(() => h.owner.current.getRecoveryIdentity().beginVisit());
  else {
    const sessionKey = recoverySessionKey(h.target);
    for (let i = 0; i < 6; i++) {
      if (i === 3) ledger.userReset(sessionKey);
      const action = ledger.reserveAction({ sessionKey, actor: 'resilience', reason: 'fixture', actionId: `spent-${i}` });
      expect(action.allowed).toBe(true);
      ledger.completeAction({ sessionKey, actionId: action.actionId }); now += 4000;
    }
  }
  await act(async () => { await h.getTray().retry(h.row); });
  expect(acks()).toHaveLength(1);
  expect(acks()[0]).toMatchObject({ commandId: 'retry-command', ok: false, code });
  expect(h.getTray().outcomes.has(h.row)).toBe(true);
  expect(h.owner.current.getQueueSnapshot().items).toHaveLength(1);
  h.remote.destroy();
});

it('screen Retry acknowledges only after owner admission and then removes the held row', async () => {
  const h = await harness(); let pending;
  act(() => { pending = h.getTray().retry(h.row); });
  expect(acks()).toHaveLength(0);
  await act(async () => { await pending; });
  expect(acks()).toHaveLength(1);
  expect(acks()[0]).toMatchObject({ commandId: 'retry-command', ok: true });
  expect(ledger.snapshot(recoverySessionKey(h.target))).toMatchObject({ count: 1, rollingCount: 1 });
  expect(h.getTray().outcomes.has(h.row)).toBe(false);
  h.remote.destroy();
});
