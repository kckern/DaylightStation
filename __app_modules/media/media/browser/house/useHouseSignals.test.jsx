// RQ-HOUSE-04 start status on every row (device-start:* + GET start-status)
// and RQ-HOUSE-07 "Started by" (GET /started-by, re-read when what plays changes).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const wsHandlers = vi.hoisted(() => ({ kinds: new Map() }));
vi.mock("../net/ws.js", () => ({
  onStatus: cb => { wsHandlers.status = cb; return () => { wsHandlers.status = null; }; },
  subscribeTopicKind: (kind, cb) => { wsHandlers.kinds.set(kind, cb); return () => wsHandlers.kinds.delete(kind); },
  parseDeviceTopic: (topic) => { const i = topic.indexOf(':'); return { kind: topic.slice(0, i), deviceId: topic.slice(i + 1) }; },
}));

import { useStartStatuses, useStartedByAll, useStartedBy } from "./useHouseSignals.js";

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
function StartedByProbe({ api, playingKey, pollMs }) {
  startedBy = useStartedByAll(playingKey, { api, pollMs });
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

  it('lets slow attribution finish across ticks for the current playback', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const pending = [];
    const api = { startedByAll: vi.fn(() => new Promise(resolve => pending.push(resolve))) };
    const answer = name => ({ items: [{ deviceId: 'livingroom-tv', startedBy: { name } }] });
    try {
      const { rerender } = render(<StartedByProbe api={api} playingKey="first" pollMs={100} />);
      await act(async () => vi.advanceTimersByTime(250));
      expect(pending).toHaveLength(1);
      await act(async () => pending[0](answer('First source')));
      expect(screen.getByTestId('b')).toHaveTextContent('First source');

      await act(async () => vi.advanceTimersByTime(100));
      expect(pending).toHaveLength(2);
      rerender(<StartedByProbe api={api} playingKey="second" pollMs={100} />);
      expect(screen.getByTestId('b').textContent).toBe('-');
      expect(pending).toHaveLength(3);
      await act(async () => pending[1](answer('Retired source')));
      await act(async () => vi.advanceTimersByTime(250));
      expect(pending).toHaveLength(3);
      await act(async () => pending[2](answer('Current source')));
      expect(screen.getByTestId('b')).toHaveTextContent('Current source');
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
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

it('refreshes the same screen and title once after a socket interruption', async () => {
  const api = { startedBy: vi.fn()
    .mockResolvedValueOnce({ startedBy: { name: 'Kitchen button' } })
    .mockResolvedValueOnce({ startedBy: { name: 'Office remote' } }) };
  const { unmount } = render(<OneProbe api={api} deviceId="office-tv" contentId="plex:1" />);
  await screen.findByText('Kitchen button');
  act(() => {
    for (const connected of [true, false, false, true, true]) wsHandlers.status?.({ connected });
  });
  await screen.findByText('Office remote');
  expect(api.startedBy.mock.calls).toEqual([['fleet:office-tv'], ['fleet:office-tv']]);
  unmount();
  expect(wsHandlers.status).toBeNull();
});

it('recovers a failed offline read on a visible poll and hides attribution when recovery fails', async () => {
  vi.useFakeTimers();
  const source = { startedBy: { name: 'Current source' } };
  const api = { startedBy: vi.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(source)
    .mockRejectedValueOnce(new Error('unavailable')) };
  try {
    render(<OneProbe api={api} deviceId="office-tv" contentId="plex:1" />);
    await act(async () => wsHandlers.status({ connected: false }));
    expect(screen.getByTestId('o')).toHaveTextContent('-');
    act(() => wsHandlers.status({ connected: true }));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId('o')).toHaveTextContent('Current source');
    await act(async () => {
      wsHandlers.status({ connected: false });
      wsHandlers.status({ connected: true });
    });
    expect(screen.getByTestId('o')).toHaveTextContent('-');
    expect(api.startedBy).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it('defers hidden Peek reads and reconnects until visible, and ignores an unselected or local screen', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const api = { startedBy: vi.fn().mockResolvedValue({ startedBy: { name: 'Office remote' } }) };
  try {
    const { rerender } = render(<OneProbe api={api} deviceId="office-tv" contentId="plex:1" />);
    act(() => {
      for (const connected of [true, false, true]) wsHandlers.status?.({ connected });
    });
    expect(api.startedBy).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await screen.findByText('Office remote');
    for (const deviceId of [null, 'local']) {
      rerender(<OneProbe api={api} deviceId={deviceId} contentId="plex:1" />);
      expect(wsHandlers.status).toBeNull();
      expect(screen.getByTestId('o')).toHaveTextContent('-');
    }
    expect(api.startedBy).toHaveBeenCalledTimes(1);
  } finally {
    visibility.mockRestore();
  }
});

it('refreshes house attribution on foreground return and drops an older answer', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let release;
  const item = name => ({ items: [{ deviceId: 'fleet:livingroom-tv', startedBy: { name } }] });
  const api = { startedByAll: vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce(item('Current source')) };
  try {
    const { rerender } = render(<StartedByProbe api={api} playingKey="a" />);
    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    rerender(<StartedByProbe api={api} playingKey="b" />);
    expect(api.startedByAll).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await screen.findByText('Current source');
    await act(async () => { release(item('Previous source')); });
    expect(screen.getByText('Current source')).toBeVisible();
  } finally {
    visibility.mockRestore();
  }
});

it('drops a pending single-screen attribution when the screen is deselected', async () => {
  let release;
  const api = { startedBy: vi.fn(() => new Promise(resolve => { release = resolve; })) };
  const { rerender } = render(<OneProbe api={api} deviceId="office-tv" contentId="plex:1" />);
  rerender(<OneProbe api={api} deviceId={null} contentId={null} />);
  await act(async () => { release({ startedBy: { name: 'Former screen' } }); });
  expect(screen.getByTestId('o').textContent).toBe('-');
});

it('recovers missed start status once per reconnect and keeps a newer live update', async () => {
  let finish;
  const api = { startStatus: vi.fn()
    .mockResolvedValueOnce({ status: null })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })) };
  const { unmount } = render(<StatusProbe api={api} ids={['tv', 'browser:1']} />);
  act(() => {
    for (const connected of [false, true, true, false, false, true, true]) wsHandlers.status({ connected });
  });
  expect(api.startStatus.mock.calls).toEqual([['tv'], ['tv']]);
  act(() => wsHandlers.kinds.get('device-start')({ topic: 'device-start:tv', phase: 'started', updatedAt: '2026-10-01T10:00:00Z' }));
  await act(async () => finish({ status: { phase: 'starting', updatedAt: '2026-10-01T09:59:00Z' } }));
  expect(screen.getByTestId('s')).toHaveTextContent('tv=started');
  unmount();
  expect(wsHandlers.status).toBeNull();
});

it('hides the former playback source as soon as the playing item changes', async () => {
  const api = { startedByAll: vi.fn()
    .mockResolvedValueOnce({ items: [{ deviceId: 'livingroom-tv', startedBy: { name: 'Former source' } }] })
    .mockImplementationOnce(() => new Promise(() => {})) };
  const { rerender } = render(<StartedByProbe api={api} playingKey="first track" />);
  await screen.findByText('Former source');
  rerender(<StartedByProbe api={api} playingKey="second track" />);
  expect(screen.getByTestId('b').textContent).toBe('-');
});

it('clears start history lost at the server and preserves a live event after the read began', async () => {
  const pending = new Map();
  const api = { startStatus: vi.fn(async id => ({ status: { phase: 'failed' } })) };
  render(<StatusProbe api={api} ids={['left', 'right']} />);
  await screen.findByText('left=failed,right=failed');
  api.startStatus.mockImplementation(id => new Promise(resolve => pending.set(id, resolve)));
  act(() => {
    for (const connected of [true, false, true]) wsHandlers.status({ connected });
    wsHandlers.kinds.get('device-start')({ topic: 'device-start:right', phase: 'started' });
  });
  await act(async () => { for (const finish of pending.values()) finish({ status: null }); });
  expect(screen.getByTestId('s')).toHaveTextContent('left=-,right=started');
});

it.each([undefined, '2026-10-01T10:00:00Z'])('keeps live status when a later HTTP reply has no newer timestamp (%s)', async updatedAt => {
  let finish;
  const api = { startStatus: vi.fn(() => new Promise(resolve => { finish = resolve; })) };
  render(<StatusProbe api={api} ids={['tv']} />);
  act(() => wsHandlers.kinds.get('device-start')({ topic: 'device-start:tv', phase: 'started', updatedAt }));
  await act(async () => finish({ status: { phase: 'starting', updatedAt } }));
  expect(screen.getByTestId('s')).toHaveTextContent('tv=started');
});
