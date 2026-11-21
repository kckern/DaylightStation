import { describe, expect, it, vi } from 'vitest';
import { BluetoothRemoteDirectionSource } from './BluetoothRemoteDirectionSource.js';
import { IRemoteDirectionSource, isRemoteDirectionSource } from './IRemoteDirectionSource.js';

const REMOTE = {
  id: 'r', kind: 'remote', address: 'AA:BB:CC:00:00:01',
  buttons: { call: 'MediaPlayPause', plus: 'AudioVolumeUp' },
  positions: { center: 'call', left: 'plus' }, toward: { front: 'left' },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSource(controllers = [REMOTE]) {
  const listeners = new Set();
  const target = new EventTarget();
  const source = new BluetoothRemoteDirectionSource({
    subscribeRemoteKeys: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    loadControllers: async () => controllers, target,
  });
  const emit = (msg) => [...listeners].forEach((fn) => fn(msg));
  return { source, listeners, target, emit };
}

describe('the remote direction port', () => {
  it('the bare port must be implemented; the adapter is one', () => {
    expect(() => new IRemoteDirectionSource().subscribe(() => {})).toThrow('must be implemented');
    expect(isRemoteDirectionSource(makeSource().source)).toBe(true);
    expect(isRemoteDirectionSource({})).toBe(false);
  });
});

describe('BluetoothRemoteDirectionSource', () => {
  it('reports ready, then tagged presses as rider directions', async () => {
    const { source, emit } = makeSource();
    const events = [];
    source.subscribe((e) => events.push(e));
    await flush();
    emit({ address: 'aa:bb:cc:00:00:01', key: 'AudioVolumeUp', state: 'down' });
    emit({ address: 'AA:BB:CC:00:00:01', key: 'Enter', state: 'down' });
    expect(events).toEqual([
      { type: 'ready', sources: ['AA:BB:CC:00:00:01'] },
      { type: 'press', sourceId: 'AA:BB:CC:00:00:01', direction: 'front', position: 'left', state: 'down' },
    ]);
  });

  it('stops the untagged browser copies while subscribed, and only its own keys', async () => {
    const { source, target, listeners } = makeSource();
    const stop = source.subscribe(() => {});
    await flush();
    const later = vi.fn();
    target.addEventListener('keydown', later);
    const copy = new KeyboardEvent('keydown', { key: 'MediaPlayPause', cancelable: true });
    target.dispatchEvent(copy);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(copy.defaultPrevented).toBe(true);
    expect(later.mock.calls.map(([e]) => e.key)).toEqual(['Enter']);
    stop();
    expect(listeners.size).toBe(0);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause' }));
    expect(later).toHaveBeenCalledTimes(2);
  });

  it('an inventory with no positioned remote is ready with none, and subscribes to nothing', async () => {
    const { source, listeners } = makeSource([{ id: 'pad', address: 'AA:BB:CC:00:00:03' }]);
    const events = [];
    source.subscribe((e) => events.push(e));
    await flush();
    expect(events).toEqual([{ type: 'ready', sources: [] }]);
    expect(listeners.size).toBe(0);
  });
});
