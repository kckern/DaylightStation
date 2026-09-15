import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekProvider } from './PeekProvider.jsx';
import { usePeek } from './usePeek.js';

let steeringCallback = null;
let deviceAckCallback = null;
let remoteOptions = null;

vi.mock('../net/ws.js', () => ({
  subscribeTopicKind: vi.fn((_kind, callback) => { deviceAckCallback = callback; return () => {}; }),
}));
vi.mock('./RemoteSessionController.js', () => ({
  createRemoteSessionController: vi.fn((options) => {
    steeringCallback = options.onSteeringActivity;
    remoteOptions = options;
    return { destroy: vi.fn() };
  }),
}));

function Probe() {
  const { getController, getSteeringActivity } = usePeek();
  const activity = getSteeringActivity?.('office');
  return (
    <>
      <button type="button" onClick={() => getController('office')}>open remote</button>
      <output data-testid="steering-activity">{activity ? `${activity.playback.sessionId}:${activity.playback.contentId}` : 'none'}</output>
    </>
  );
}

describe('PeekProvider steering activity bridge', () => {
  it('does not mark opening Remote as steering, but exposes a verified command activity record', () => {
    const fleet = { store: {} };
    render(
      <FleetContext.Provider value={fleet}>
        <PeekProvider><Probe /></PeekProvider>
      </FleetContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'open remote' }));
    expect(screen.getByTestId('steering-activity')).toHaveTextContent('none');

    act(() => steeringCallback({
      deviceId: 'office',
      playback: { sessionId: 's-1', contentId: 'plex:1', queueItemId: 'q-1' },
    }));
    expect(screen.getByTestId('steering-activity')).toHaveTextContent('s-1:plex:1');
  });

  it('forwards complete typed handoff acks from the production subscription into the registered router', async () => {
    const fleet = { store: {} };
    render(
      <FleetContext.Provider value={fleet}>
        <PeekProvider><Probe /></PeekProvider>
      </FleetContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'open remote' }));
    const command = { commandId: 'handoff-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'capture' } };
    const pending = remoteOptions.ackRouter.register('handoff-1', { deviceId: 'office', handoffCommand: command });
    act(() => deviceAckCallback({
      deviceId: 'office', commandId: 'handoff-1', ok: false, code: 'HANDOFF_UNSUPPORTED',
      appliedAt: '2026-09-14T00:00:00.000Z',
      handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    }));
    await expect(pending).resolves.toMatchObject({
      deviceId: 'office', code: 'HANDOFF_UNSUPPORTED',
      handoff: { transferId: 'transfer-1', phase: 'failed' },
    });
  });
});
