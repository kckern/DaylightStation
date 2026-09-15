import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekProvider } from './PeekProvider.jsx';
import { usePeek } from './usePeek.js';

let steeringCallback = null;

vi.mock('../net/ws.js', () => ({ subscribeTopicKind: vi.fn(() => () => {}) }));
vi.mock('./RemoteSessionController.js', () => ({
  createRemoteSessionController: vi.fn((options) => {
    steeringCallback = options.onSteeringActivity;
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
});
