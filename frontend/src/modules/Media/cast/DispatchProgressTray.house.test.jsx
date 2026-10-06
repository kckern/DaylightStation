// House-wide outcomes (RQ-STEER-13 and other house actions) carry their own
// sentence: the tray shows it as-is, and lists every screen not reached.
import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const { push, retry, removeDispatch, sendElsewhere, stopAttempt, skipLocal } = vi.hoisted(() => ({
  push: vi.fn(), retry: vi.fn(), removeDispatch: vi.fn(), sendElsewhere: vi.fn(), stopAttempt: vi.fn(), skipLocal: vi.fn(),
}));
const outcomes = new Map();
const DEVICES = [
  { id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv', content_control: { type: 'fkb' } },
  { id: 'kitchen-speaker', name: 'Kitchen Speaker', type: 'speaker', content_control: { type: 'hub' } },
  { id: 'office-tv', name: 'Office TV', type: 'linux-pc', content_control: { type: 'websocket' } },
  { id: 'browser:phone', name: 'Phone', type: 'browser' },
];

vi.mock('./useDispatch.js', () => ({
  useDispatch: () => ({ dispatches: outcomes, outcomes, retry, removeDispatch, sendElsewhere, stopAttempt, skipLocal }),
}));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (id) => ({ device: DEVICES.find(d => d.id === id) ?? null }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: DEVICES }) }));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push }) }));

import { MantineProvider } from '@mantine/core';
import { DispatchProgressTray } from './DispatchProgressTray.jsx';

const record = (overrides) => ({
  steps: [], playback: null, outcome: null, error: null, failedStep: null, operation: 'play-now',
  kind: 'play', distance: 'far', createdAt: '2026-10-02T00:00:00.000Z', ...overrides,
});

describe('DispatchProgressTray house-wide outcomes', () => {
  beforeEach(() => { vi.clearAllMocks(); outcomes.clear(); });

  it('shows a house action in its own words and keeps a partial one until dismissed', () => {
    outcomes.set('q1', record({
      attemptId: 'q1', dispatchId: 'q1', targetId: 'local', deviceId: 'local', distance: 'here', kind: 'pauseAll', phase: 'failed',
      item: { contentId: null, title: null },
      command: { copy: { primary: 'Paused 2 screens', secondary: 'Not paused: Office TV (not reachable)' } },
    }));
    render(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    const row = screen.getByTestId('dispatch-row-q1');
    expect(row).toHaveTextContent('Paused 2 screens');
    expect(row).toHaveTextContent('Not paused: Office TV (not reachable)');
    expect(screen.queryByTestId('dispatch-retry-q1')).toBeNull();
    expect(screen.getByTestId('dispatch-dismiss-q1')).toBeInTheDocument();
    expect(screen.getByTestId('media-outcome-announcer')).toHaveTextContent('Paused 2 screens. Not paused: Office TV (not reachable)');
  });
});
