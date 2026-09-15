import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const DaylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => DaylightAPI(...args) }));
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {} }));
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: [{ id: 'livingroom-tv', name: 'Living Room TV' }] }),
}));
vi.mock('../fleet/useDevice.js', () => ({ useDevice: () => ({ device: { id: 'livingroom-tv', name: 'Living Room TV' }, entry: null }) }));
vi.mock('./useCastTarget.js', () => ({ useCastTarget: () => ({ targetIds: [], mode: 'transfer' }) }));
vi.mock('../logging/mediaLog.js', () => ({ default: new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) }) }));

import { DispatchProvider } from './DispatchProvider.jsx';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';

describe('DispatchTargetPicker → DispatchProvider M0', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
  });

  it('does not silently submit persisted transfer for idle remote Play, but permits explicit Keep', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const complete = vi.fn();
    render(
      <DispatchProvider>
        <DispatchTargetPicker source={{ play: 'plex:1', title: 'Bluey' }} onComplete={complete} />
      </DispatchProvider>,
    );

    fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
    expect(screen.getByTestId('picker-mode-transfer')).toBeDisabled();
    expect(screen.getByTestId('picker-submit')).toBeDisabled();
    expect(DaylightAPI).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('picker-mode-fork'));
    fireEvent.click(screen.getByTestId('picker-submit'));

    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(complete).toHaveBeenCalledWith({ targetIds: ['livingroom-tv'], mode: 'fork' }));
  });

  it('does not dispatch or complete when a snapshot source vanishes before submit', async () => {
    const complete = vi.fn();
    render(
      <DispatchProvider>
        <DispatchTargetPicker source={{ getSnapshot: () => null, title: 'Bluey' }} onComplete={complete} />
      </DispatchProvider>,
    );

    fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
    fireEvent.click(screen.getByTestId('picker-mode-fork'));
    fireEvent.click(screen.getByTestId('picker-submit'));

    expect(await screen.findByTestId('picker-dispatch-failed')).toHaveTextContent('Playback is no longer available');
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
