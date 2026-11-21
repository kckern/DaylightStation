import { describe, it, expect } from 'vitest';
import { createRemoteHoldTracker, resolveRemoteEmulatorMaps } from './remoteEmulatorInput.js';
import { IEmulatorInput } from '../ports/IEmulatorInput.js';

// A fake IEmulatorInput: records ['press'|'release', button].
class FakeInput extends IEmulatorInput {
  constructor() { super(); this.calls = []; }
  press(b) { this.calls.push(['press', b]); return true; }
  release(b) { this.calls.push(['release', b]); return true; }
  releaseAll() { return 0; }
  isReady() { return true; }
}

// Fixture inventory: a decoded stick-pad remote, a keyboard remote without an
// emulator map, and an entry with an emulator map but no address.
const REMOTE = {
  id: 'pad_remote', kind: 'remote', label: 'Pad remote', address: 'aa:bb:cc:00:00:01',
  buttons: {
    a: 'ButtonA', b: 'ButtonB', c: 'ButtonC', d: 'ButtonD',
    upper_trigger: 'Trigger1', lower_trigger: 'Trigger2',
    stick_up: 'StickUp', stick_down: 'StickDown', stick_left: 'StickLeft', stick_right: 'StickRight',
  },
  emulator: {
    stick_up: 'up', stick_down: 'down', stick_left: 'left', stick_right: 'right',
    upper_trigger: 'a', lower_trigger: 'b',
    a: 'start', b: 'select', c: 'x', d: 'y',
    systems: { genesis: { d: 'l' } },
  },
};
const CONTROLLERS = [
  REMOTE,
  { id: 'kb_remote', kind: 'remote', address: 'AA:BB:CC:00:00:02', buttons: { plus: 'AudioVolumeUp' } },
  { id: 'no_address', emulator: { a: 'a' } },
];
const ADDR = 'AA:BB:CC:00:00:01';
const msg = (key, state, address = ADDR) => ({ address, name: 'Pad remote', key, state });

describe('resolveRemoteEmulatorMaps', () => {
  it('keys remotes by upper-case address and maps bt.remote.key names to RetroPad indices', () => {
    const maps = resolveRemoteEmulatorMaps(CONTROLLERS, 'gb');
    expect([...maps.keys()]).toEqual([ADDR]);
    const { keys, id } = maps.get(ADDR);
    expect(id).toBe('pad_remote');
    expect(keys.get('StickUp')).toBe('up');
    expect(keys.get('Trigger1')).toBe('a');
    expect(keys.get('Trigger2')).toBe('b');
    expect(keys.get('ButtonA')).toBe('start');
    expect(keys.get('ButtonB')).toBe('select');
    expect(keys.get('ButtonD')).toBe('y');
    expect(keys.size).toBe(10);
  });

  it('merges a per-system override over the base map', () => {
    expect(resolveRemoteEmulatorMaps(CONTROLLERS, 'genesis').get(ADDR).keys.get('ButtonD')).toBe('l');
    expect(resolveRemoteEmulatorMaps(CONTROLLERS, null).get(ADDR).keys.get('ButtonD')).toBe('y');
  });

  it('takes an unlisted physical name as the key itself and drops unknown buttons', () => {
    const maps = resolveRemoteEmulatorMaps([{ address: 'x', emulator: { Enter: 'start', ButtonA: 'turbo' } }]);
    expect([...maps.get('X').keys.entries()]).toEqual([['Enter', 'start']]);
  });

  it('is empty for no or malformed config', () => {
    expect(resolveRemoteEmulatorMaps(undefined).size).toBe(0);
    expect(resolveRemoteEmulatorMaps([null, 'x', { address: 'a', emulator: 'b' }]).size).toBe(0);
  });
});

describe('createRemoteHoldTracker', () => {
  it('refuses anything that is not an IEmulatorInput', () => {
    expect(() => createRemoteHoldTracker({ input: { press() {} } })).toThrow(/IEmulatorInput/);
  });

  const setup = () => {
    const input = new FakeInput();
    const tracker = createRemoteHoldTracker({ input });
    return { input, tracker, maps: resolveRemoteEmulatorMaps(CONTROLLERS, 'gb') };
  };

  it('presses on down and releases on up, exactly once each', () => {
    const { input, tracker, maps } = setup();
    expect(tracker.handle(msg('Trigger1', 'down'), maps).action).toBe('down');
    expect(tracker.handle(msg('Trigger1', 'down'), maps).action).toBe('ignored');
    expect(tracker.handle(msg('Trigger1', 'repeat'), maps).action).toBe('ignored');
    expect(tracker.heldCount()).toBe(1);
    expect(tracker.handle(msg('Trigger1', 'up'), maps).action).toBe('up');
    expect(tracker.handle(msg('Trigger1', 'up'), maps).action).toBe('ignored');
    expect(input.calls).toEqual([['press', 'a'], ['release', 'a']]);
    expect(tracker.heldCount()).toBe(0);
  });

  it('holds the stick direction for as long as it is held, independent of other buttons', () => {
    const { input, tracker, maps } = setup();
    tracker.handle(msg('StickRight', 'down'), maps);
    tracker.handle(msg('Trigger1', 'down'), maps);
    tracker.handle(msg('Trigger1', 'up'), maps);
    expect(input.calls).toEqual([['press', 'right'], ['press', 'a'], ['release', 'a']]);
    tracker.handle(msg('StickRight', 'up'), maps);
    tracker.handle(msg('StickDown', 'down'), maps);
    expect(input.calls.slice(3)).toEqual([['release', 'right'], ['press', 'down']]);
  });

  it('a repeat with no down counts as the down; an up with no down does nothing', () => {
    const { input, tracker, maps } = setup();
    expect(tracker.handle(msg('ButtonA', 'up'), maps).action).toBe('ignored');
    expect(tracker.handle(msg('ButtonA', 'repeat'), maps).action).toBe('down');
    expect(input.calls).toEqual([['press', 'start']]);
  });

  it('two controls on one button: the button stays held until both are up', () => {
    const input = new FakeInput();
    const tracker = createRemoteHoldTracker({ input });
    const maps = resolveRemoteEmulatorMaps([{ address: ADDR, emulator: { ButtonA: 'a', Trigger1: 'a' } }]);
    tracker.handle(msg('ButtonA', 'down'), maps);
    tracker.handle(msg('Trigger1', 'down'), maps);
    tracker.handle(msg('ButtonA', 'up'), maps);
    expect(input.calls).toEqual([['press', 'a']]);
    tracker.handle(msg('Trigger1', 'up'), maps);
    expect(input.calls).toEqual([['press', 'a'], ['release', 'a']]);
  });

  it('ignores other remotes and unmapped keys', () => {
    const { input, tracker, maps } = setup();
    expect(tracker.handle(msg('ButtonA', 'down', 'AA:BB:CC:00:00:02'), maps)).toBeNull();
    expect(tracker.handle(msg('AudioVolumeUp', 'down'), maps)).toBeNull();
    expect(input.calls).toEqual([]);
  });

  it('releaseAll / releaseRemote release every held button so nothing sticks', () => {
    const { input, tracker, maps } = setup();
    tracker.handle(msg('StickLeft', 'down', ADDR.toLowerCase()), maps);
    tracker.handle(msg('Trigger2', 'down'), maps);
    expect(tracker.releaseRemote('aa:bb:cc:00:00:01')).toBe(2);
    expect(input.calls.slice(2)).toEqual([['release', 'left'], ['release', 'b']]);
    expect(tracker.releaseAll()).toBe(0);
    // A late up after the release is ignored; a fresh down presses again.
    expect(tracker.handle(msg('StickLeft', 'up'), maps).action).toBe('ignored');
    tracker.handle(msg('StickLeft', 'down'), maps);
    expect(tracker.releaseAll()).toBe(1);
    expect(input.calls.slice(4)).toEqual([['press', 'left'], ['release', 'left']]);
  });
});
