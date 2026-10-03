// RQ-HOUSE-04 start status on every row (device-start:* + GET start-status)
// and RQ-HOUSE-07 "Started by" (GET /started-by, re-read when what plays changes).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const wsHandlers = vi.hoisted(() => ({ kinds: new Map() }));
vi.mock('../net/ws.js', () => ({
  subscribeTopicKind: (kind, cb) => { wsHandlers.kinds.set(kind, cb); return () => wsHandlers.kinds.delete(kind); },
  parseDeviceTopic: (topic) => { const i = topic.indexOf(':'); return { kind: topic.slice(0, i), deviceId: topic.slice(i + 1) }; },
}));

import { useStartStatuses, useStartedByAll, useStartedBy } from './useHouseSignals.js';

let statuses;
function StatusProbe({ ids, api }) {
  statuses = useStartStatuses(ids, { api });
  return <div data-testid="s">{ids.map((id) => `${id}=${statuses.get(id)?.phase ?? '-'}`).join(',')}</div>;
}

describe('useStartStatuses', () => {
  beforeEach(() => wsHandlers.kinds.clear());

  it('reads each screen once and then follows device-start broadcasts', async () => {
    const api = { startStatus: vi.fn(async (id) => ({ ok: true, status: id === 'office-tv' ? { deviceId: id, phase: 'failed', updatedAt: '2026-10-03T14:00:00.000Z' } : null })) };
    render(<StatusProbe ids={['office-tv', 'livingroom-tv', 'browser:x']} api={api} />);
    await waitFor(() => expect(screen.getByTestId('s')).toHaveTextContent('office-tv=failed,livingroom-tv=-'));
    expect(api.startStatus).not.toHaveBeenCalledWith('browser:x');
    act(() => wsHandlers.kinds.get('device-start')({ topic: 'device-start:livingroom-tv', deviceId: 'livingroom-tv', phase: 'starting', step: 'power', updatedAt: '2026-10-03T14:01:00.000Z' }));
    expect(screen.getByTestId('s')).toHaveTextContent('livingroom-tv=starting');
  });

  it('ignores an older broadcast arriving after a newer one', async () => {
    const api = { startStatus: vi.fn(async () => ({ ok: true, status: null })) };
    render(<StatusProbe ids={['office-tv']} api={api} />);
    act(() => wsHandlers.kinds.get('device-start')({ topic: 'device-start:office-tv', phase: 'started', updatedAt: '2026-10-03T14:05:00.000Z' }));
    act(() => wsHandlers.kinds.get('device-start')({ topic: 'device-start:office-tv', phase: 'starting', updatedAt: '2026-10-03T14:04:00.000Z' }));
    expect(screen.getByTestId('s')).toHaveTextContent('office-tv=started');
  });
});

let startedBy;
function StartedByProbe({ api, playingKey }) {
  startedBy = useStartedByAll(playingKey, { api });
  return <div data-testid="b">{startedBy.get('livingroom-tv')?.startedBy?.name ?? '-'}</div>;
}

describe('useStartedByAll', () => {
  it('maps the household answer by fleet device id and re-reads when what plays changes', async () => {
    const api = { startedByAll: vi.fn(async () => ({ items: [{ deviceId: 'fleet:livingroom-tv', startedBy: { kind: 'routine', name: 'Kitchen button' }, at: '2026-10-03T14:02:00.000Z' }] })) };
    const { rerender } = render(<StartedByProbe api={api} playingKey="a" />);
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('Kitchen button'));
    rerender(<StartedByProbe api={api} playingKey="b" />);
    await waitFor(() => expect(api.startedByAll).toHaveBeenCalledTimes(2));
  });
});

let one;
function OneProbe({ api, deviceId, contentId }) {
  one = useStartedBy(deviceId, { api, contentId });
  return <div data-testid="o">{one?.startedBy?.name ?? '-'}</div>;
}

describe('useStartedBy', () => {
  it('reads one screen by its registry id', async () => {
    const api = { startedBy: vi.fn(async () => ({ deviceId: 'fleet:office-tv', startedBy: { kind: 'device', name: "Dad's phone" }, at: null })) };
    render(<OneProbe api={api} deviceId="office-tv" contentId="plex:1" />);
    await waitFor(() => expect(screen.getByTestId('o')).toHaveTextContent("Dad's phone"));
    expect(api.startedBy).toHaveBeenCalledWith('fleet:office-tv');
  });
});
