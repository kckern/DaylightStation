import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRemoteEmulatorInput } from './useRemoteEmulatorInput.js';


const ADDR = 'AA:BB:CC:00:00:01';
const CONTROLLERS = [{
  id: 'pad_remote', kind: 'remote', address: ADDR,
  buttons: { upper_trigger: 'Trigger1', stick_right: 'StickRight' },
  emulator: { upper_trigger: 'a', stick_right: 'right' },
}];

function fakeBluetooth(inventory = null) {
  const claims = new Map();
  return {
    inventory,
    claims,
    claimRemoteKeys: vi.fn((address, fn) => { claims.set(address, fn); return () => claims.delete(address); }),
    send(key, state) { claims.get(ADDR)?.({ address: ADDR, key, state }); },
  };
}
const logger = () => ({ info: vi.fn(), warn: vi.fn(), sampled: vi.fn() });
// A fake IEmulatorInput port; `pressInput.mock.calls` holds [button, 1|0].
const engine = (ready = true) => {
  const pressInput = vi.fn();
  return {
    pressInput,
    press: (b) => { pressInput(b, 1); return true; },
    release: (b) => { pressInput(b, 0); return true; },
    releaseAll: () => 0,
    isReady: () => ready,
  };
};

function setup({ active = true, bt = fakeBluetooth(), eng = engine(), log = logger() } = {}) {
  const hook = renderHook((props) => useRemoteEmulatorInput(props), {
    initialProps: { bluetooth: bt, controllers: CONTROLLERS, system: 'gb', active, input: eng, logger: log },
  });
  return { ...hook, bt, eng, log };
}

describe('useRemoteEmulatorInput', () => {
  it('claims the mapped remote while playing and drives the core', () => {
    const { bt, eng, log } = setup();
    expect(bt.claimRemoteKeys).toHaveBeenCalledWith(ADDR, expect.any(Function));
    act(() => { bt.send('StickRight', 'down'); bt.send('Trigger1', 'down'); bt.send('Trigger1', 'up'); });
    expect(eng.pressInput.mock.calls).toEqual([['right', 1], ['a', 1], ['a', 0]]);
    expect(log.info).toHaveBeenCalledWith('emulator.remote.input', expect.objectContaining({ first: true, button: 'right' }));
    expect(log.info).toHaveBeenCalledWith('emulator.remote.mount', expect.objectContaining({ remotes: ['pad_remote'], mode: 'claim' }));
  });

  it('does not claim while the game is not playing, and releases held buttons when it stops', () => {
    const { bt, eng, log, rerender } = setup({ active: false });
    expect(bt.claimRemoteKeys).not.toHaveBeenCalled();
    rerender({ bluetooth: bt, controllers: CONTROLLERS, system: 'gb', active: true, input: eng, logger: log });
    act(() => { bt.send('StickRight', 'down'); });
    rerender({ bluetooth: bt, controllers: CONTROLLERS, system: 'gb', active: false, input: eng, logger: log });
    expect(bt.claims.size).toBe(0);
    expect(eng.pressInput.mock.calls).toEqual([['right', 1], ['right', 0]]);
    expect(log.warn).toHaveBeenCalledWith('emulator.remote.stuck-release', expect.objectContaining({ reason: 'inactive', released: 1 }));
  });

  it('releases on window blur, on unmount, and when the remote disconnects', () => {
    const { bt, eng, log, rerender, unmount } = setup();
    act(() => { bt.send('StickRight', 'down'); });
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(eng.pressInput.mock.calls).toEqual([['right', 1], ['right', 0]]);

    act(() => { bt.send('Trigger1', 'down'); });
    const bt2 = { ...bt, inventory: [{ address: ADDR, connected: false }] };
    rerender({ bluetooth: bt2, controllers: CONTROLLERS, system: 'gb', active: true, input: eng, logger: log });
    expect(eng.pressInput.mock.calls.slice(2)).toEqual([['a', 1], ['a', 0]]);
    expect(log.warn).toHaveBeenCalledWith('emulator.remote.stuck-release', expect.objectContaining({ reason: 'disconnected' }));

    act(() => { bt.send('Trigger1', 'down'); });
    unmount();
    expect(eng.pressInput.mock.calls.slice(4)).toEqual([['a', 1], ['a', 0]]);
  });

  it('ignores presses before the core has started', () => {
    const eng = engine(false);
    const { bt } = setup({ eng });
    act(() => { bt.send('Trigger1', 'down'); });
    expect(eng.pressInput).not.toHaveBeenCalled();
  });
});
