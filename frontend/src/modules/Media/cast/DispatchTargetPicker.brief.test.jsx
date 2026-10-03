import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Show briefly (PLAY.8a/AC1): from any item, for any screen. The press is a
// plain play with `brief=1` — never an item action, never a Move.
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
import { buildDispatchUrl } from './dispatchUrl.js';

describe('Show briefly on…', () => {
  beforeEach(() => DaylightAPI.mockReset());

  it('sends a brief play to the chosen screen without asking what happens here', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const complete = vi.fn();
    render(
      <DispatchProvider>
        <DispatchTargetPicker source={{ play: 'plex:77', title: 'Clip', brief: true }} verb="Show briefly" onComplete={complete} />
      </DispatchProvider>,
    );
    fireEvent.click(screen.getByTestId('picker-device-livingroom-tv'));
    expect(screen.queryByTestId('picker-mode-transfer')).toBeNull();
    fireEvent.click(screen.getByTestId('picker-submit'));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));
    const url = new URL(DaylightAPI.mock.calls[0][0], 'http://x/');
    expect(url.pathname).toBe('/api/v1/device/livingroom-tv/load');
    expect(url.searchParams.get('play')).toBe('plex:77');
    expect(url.searchParams.get('brief')).toBe('1');
    expect(url.searchParams.has('itemAction')).toBe(false);
  });

  it('only a play carries brief', () => {
    expect(buildDispatchUrl({ deviceId: 'lr', play: 'plex:1', dispatchId: 'd', brief: true })).toContain('brief=1');
    expect(buildDispatchUrl({ deviceId: 'lr', queue: 'plex:1', dispatchId: 'd', brief: true })).not.toContain('brief=');
    expect(buildDispatchUrl({ deviceId: 'lr', play: 'plex:1', dispatchId: 'd' })).not.toContain('brief=');
  });
});
