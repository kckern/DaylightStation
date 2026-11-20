// useFitnessBluetooth.test.jsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
const sampled = vi.fn();
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    info() {}, debug() {}, warn: (...a) => warn(...a), error() {}, sampled: (...a) => sampled(...a), child() { return this; },
  }),
}));

import { useFitnessBluetooth, BT_TOPICS } from './useFitnessBluetooth.js';

describe('useFitnessBluetooth', () => {
  let sent;
  const setup = () => renderHook(() => useFitnessBluetooth({ send: (m) => sent.push(m) }));
  beforeEach(() => { sent = []; warn.mockReset(); sampled.mockReset(); vi.useFakeTimers(); vi.setSystemTime(100000); });
  afterEach(() => vi.useRealTimers());

  it('lists the topics it handles', () => {
    expect(BT_TOPICS).toEqual(['bt_inventory', 'bt.pair.progress', 'bt.remove.result', 'bt.scan.progress']);
  });

  it('stores the inventory and asks for it on request', () => {
    const { result } = setup();
    act(() => { expect(result.current.handleMessage({ topic: 'bt_inventory', devices: [{ address: 'A' }] })).toBe(true); });
    expect(result.current.bluetooth.inventory).toEqual([{ address: 'A' }]);
    act(() => result.current.bluetooth.requestInventory());
    expect(sent[0].topic).toBe('bt.inventory.request');
    expect(result.current.handleMessage({ topic: 'fitness' })).toBe(false);
  });

  it('a search runs: start, scanning, nearby, stop', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.startScan(); });
    expect(sent[0]).toMatchObject({ topic: 'bt.scan.request', action: 'start', requestId: id });
    expect(result.current.bluetooth.scan.phase).toBe('starting');
    act(() => { result.current.handleMessage({ topic: 'bt.scan.progress', requestId: id, phase: 'scanning', durationMs: 60000 }); });
    act(() => { result.current.handleMessage({ topic: 'bt.scan.progress', requestId: id, phase: 'nearby', devices: [{ address: 'A' }] }); });
    expect(result.current.bluetooth.scan).toMatchObject({ phase: 'scanning', endsAt: 160000, devices: [{ address: 'A' }] });
    expect(sampled).toHaveBeenCalledWith('fitness.bt.scan-nearby', expect.objectContaining({ requestId: id, count: 1 }), expect.any(Object));
    act(() => result.current.bluetooth.stopScan('user'));
    expect(sent[1]).toEqual({ topic: 'bt.scan.request', requestId: id, action: 'stop' });
    expect(result.current.bluetooth.scan.phase).toBe('stopping');
    // The satellite's done ends it.
    act(() => { result.current.handleMessage({ topic: 'bt.scan.progress', requestId: id, phase: 'done', reason: 'stopped' }); });
    expect(result.current.bluetooth.scan).toMatchObject({ phase: 'done', reason: 'stopped' });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current.bluetooth.scan.reason).toBe('stopped');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a Stop before any answer ends as stopped, never as an outdated satellite', () => {
    const { result } = setup();
    act(() => result.current.noteHealth());
    act(() => { result.current.bluetooth.startScan(); });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => result.current.bluetooth.stopScan('back'));
    expect(result.current.bluetooth.scan.optimistic).toBe(false);
    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current.bluetooth.scan).toMatchObject({ phase: 'done', reason: 'stopped' });
    expect(warn).not.toHaveBeenCalledWith('fitness.bt.scan-no-response', expect.anything());
  });

  it('a slow first answer (up to 8 s: the satellite stops a stuck search first) is not "outdated"', () => {
    const { result } = setup();
    act(() => result.current.noteHealth());
    let id;
    act(() => { id = result.current.bluetooth.startScan(); });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.bluetooth.scan.phase).toBe('starting');
    act(() => { result.current.handleMessage({ topic: 'bt.scan.progress', requestId: id, phase: 'scanning', durationMs: 60000 }); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.bluetooth.scan.phase).toBe('scanning');
  });

  it('a search whose done never arrives ends 5 s after its end time', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.startScan(); });
    act(() => { result.current.handleMessage({ topic: 'bt.scan.progress', requestId: id, phase: 'scanning', durationMs: 10000 }); });
    act(() => { vi.advanceTimersByTime(14000); });
    expect(result.current.bluetooth.scan.phase).toBe('scanning');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.bluetooth.scan).toMatchObject({ phase: 'done', reason: 'no-response', devices: [] });
  });

  it('a bus reconnect ends an unfinished search (its done may have been lost)', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.startScan(); });
    act(() => { result.current.handleMessage({ topic: 'bt.scan.progress', requestId: id, phase: 'scanning', durationMs: 60000 }); });
    act(() => result.current.resetAfterReconnect());
    expect(result.current.bluetooth.scan).toMatchObject({ phase: 'done', reason: 'interrupted' });
    act(() => result.current.resetAfterReconnect());
    expect(result.current.bluetooth.scan.reason).toBe('interrupted');
  });

  it('no answer from a live satellite means it needs an update (warn)', () => {
    const { result } = setup();
    act(() => result.current.noteHealth());
    act(() => { result.current.bluetooth.startScan(); });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current.bluetooth.scan).toMatchObject({ phase: 'done', reason: 'satellite-outdated' });
    expect(warn).toHaveBeenCalledWith('fitness.bt.scan-no-response', expect.objectContaining({ reason: 'satellite-outdated' }));
  });

  it('no answer and no health means the box is not answering', () => {
    const { result } = setup();
    act(() => { result.current.bluetooth.startScan(); });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current.bluetooth.scan.reason).toBe('no-response');
  });

  it('an old search timer never touches a newer search', () => {
    const { result } = setup();
    act(() => { result.current.bluetooth.startScan(); });
    act(() => { vi.advanceTimersByTime(6000); });
    let id2;
    act(() => { id2 = result.current.bluetooth.startScan(); });
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.bluetooth.scan).toMatchObject({ requestId: id2, phase: 'starting' });
  });

  it('pairAddress sends an address request with the matched controller and merges progress', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.pairAddress({ address: 'aa:bb:cc:11:22:33', controllerId: 'pad', label: 'Pad', pin: '1234' }); });
    expect(sent[0]).toMatchObject({ topic: 'bt.pair.request', mode: 'address', address: 'AA:BB:CC:11:22:33', durationMs: 30000,
      targets: [{ id: 'pad', label: 'Pad', pin: '1234' }] });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'passkey', passkey: '012345', entered: 0 }); });
    expect(result.current.bluetooth.pairing).toMatchObject({ phase: 'passkey', passkey: '012345', mode: 'address' });
  });

  it('a pair request with no answer ends as no-response (warn)', () => {
    const { result } = setup();
    act(() => { result.current.bluetooth.pairAddress({ address: 'AA:BB:CC:11:22:33' }); });
    act(() => { vi.advanceTimersByTime(15000); });
    expect(result.current.bluetooth.pairing).toMatchObject({ phase: 'done', reason: 'no-response', mode: 'address',
      device: { address: 'AA:BB:CC:11:22:33' } });
    expect(warn).toHaveBeenCalledWith('fitness.bt.pair-no-response', expect.any(Object));
  });

  it('an address request answered by an old satellite warns once', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.pairAddress({ address: 'AA:BB:CC:11:22:33' }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'scanning', durationMs: 30000 }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'done', paired: [] }); });
    expect(result.current.bluetooth.pairing.satelliteOutdated).toBe(true);
    expect(warn.mock.calls.filter(([e]) => e === 'fitness.bt.satellite-outdated')).toHaveLength(1);
  });

  it('forget sends bt.remove and records the result', () => {
    const { result } = setup();
    act(() => { result.current.bluetooth.forget('AA:BB:CC:11:22:33'); });
    expect(sent[0]).toMatchObject({ topic: 'bt.remove', address: 'AA:BB:CC:11:22:33' });
    act(() => { result.current.handleMessage({ topic: 'bt.remove.result', address: 'AA:BB:CC:11:22:33', success: true }); });
    expect(result.current.bluetooth.forgetResult).toEqual({ address: 'AA:BB:CC:11:22:33', success: true, error: null });
  });

  it('a pairing whose done never arrives ends after its window plus grace (busy forever otherwise)', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.pairAddress({ address: 'AA:BB:CC:11:22:33' }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'scanning', mode: 'address', durationMs: 30000 }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'pairing', mode: 'address' }); });
    // The helper's own cap is its window + 120 s; the browser waits 10 s more.
    act(() => { vi.advanceTimersByTime(30000 + 129000); });
    expect(result.current.bluetooth.pairing.phase).toBe('pairing');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.bluetooth.pairing).toMatchObject({ phase: 'done', reason: 'no-response', requestId: id });
    expect(warn).toHaveBeenCalledWith('fitness.bt.pair-no-done', expect.objectContaining({ requestId: id }));
  });

  it('a finished pairing is left alone by the watchdog', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.pairAddress({ address: 'AA:BB:CC:11:22:33' }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'scanning', mode: 'address' }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'done', paired: [{ address: 'AA:BB:CC:11:22:33' }] }); });
    act(() => { vi.advanceTimersByTime(200000); });
    expect(result.current.bluetooth.pairing).toMatchObject({ phase: 'done', paired: [{ address: 'AA:BB:CC:11:22:33' }] });
  });

  it('a bus reconnect ends an unfinished pairing too', () => {
    const { result } = setup();
    let id;
    act(() => { id = result.current.bluetooth.pairAddress({ address: 'AA:BB:CC:11:22:33' }); });
    act(() => { result.current.handleMessage({ topic: 'bt.pair.progress', requestId: id, phase: 'pairing', mode: 'address' }); });
    act(() => result.current.resetAfterReconnect());
    expect(result.current.bluetooth.pairing).toMatchObject({ phase: 'done', reason: 'interrupted' });
  });
});
