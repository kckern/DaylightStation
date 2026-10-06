// RQ-AUTO-05 (AUTO.4a): recent routine starts with outcome + plain reason,
// and routines flagged ahead of time.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { RoutineHistoryView } from './RoutineHistoryView.jsx';
import { HouseApiError } from './houseApi.js';

const wrap = (api) => render(<MantineProvider><RoutineHistoryView api={api} /></MantineProvider>);

describe('RoutineHistoryView', () => {
  it('lists each start with when, screen, what and outcome, and flags routines ahead of time', async () => {
    const api = {
      routineHistory: vi.fn(async () => ({ items: [
        { at: new Date().toISOString(), routine: { id: 'automation:k4', name: 'Kitchen Button 4: Slow TV' }, deviceId: 'fleet:livingroom-tv',
          screenName: 'Living Room TV', what: { key: 'queue', value: 'slow-tv' }, outcome: 'failed', reason: 'Living Room TV did not turn on' },
        { at: new Date().toISOString(), routine: { id: 'automation:k1', name: 'Kitchen Button 1' }, deviceId: 'fleet:livingroom-tv',
          screenName: 'Living Room TV', what: { key: 'queue', value: 'morning-program' }, outcome: 'started', played: { title: 'Bluey' } },
      ] })),
      routineFlags: vi.fn(async () => ({ items: [
        { routine: { id: 'automation:k1', name: 'Kitchen Button 1' }, deviceId: 'browser:x', screenName: 'Kitchen tablet', problem: 'unreachable', severity: 'warn', reason: "Kitchen tablet isn't open right now" },
        { routine: { id: 'automation:k2', name: 'Kitchen Button 2' }, deviceId: 'fleet:livingroom-tv', screenName: 'Living Room TV', problem: 'off', severity: 'info', reason: 'Living Room TV is off; the routine will turn it on' },
      ] })),
    };
    wrap(api);
    const runs = await screen.findAllByTestId('routine-run');
    expect(runs[0]).toHaveTextContent('Kitchen Button 4: Slow TV');
    expect(runs[0]).toHaveTextContent('Living Room TV — slow-tv');
    expect(within(runs[0]).getByTestId('routine-run-outcome')).toHaveTextContent('Failed: Living Room TV did not turn on');
    expect(within(runs[1]).getByTestId('routine-run-outcome')).toHaveTextContent('Played');
    expect(runs[1]).toHaveTextContent('Living Room TV — Bluey');
    expect(screen.getByTestId('routine-flag-automation:k1')).toHaveTextContent("Needs attention: Kitchen tablet isn't open right now");
    expect(screen.getByTestId('routine-flag-automation:k2')).toHaveTextContent('Living Room TV is off; the routine will turn it on');
  });

  it('says plainly when nothing ran, and when the history could not load', async () => {
    const api = { routineHistory: vi.fn(async () => ({ items: [] })), routineFlags: vi.fn(async () => ({ items: [] })) };
    const { unmount } = wrap(api);
    expect(await screen.findByTestId('routine-history-empty')).toBeInTheDocument();
    unmount();
    wrap({ routineHistory: vi.fn(async () => { throw new HouseApiError('down', { transient: true }); }), routineFlags: vi.fn(async () => ({ items: [] })) });
    await waitFor(() => expect(screen.getByTestId('routine-history-error')).toBeInTheDocument());
  });
});
