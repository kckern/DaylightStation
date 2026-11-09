import { it, expect } from 'vitest';
import { readPads, displayName, describePress, attributePads, padsSignature } from './liveInput.js';

const gp = (index, id, pressedIdx = [], axes = [0, 0, 0, 0]) => ({
  index, id, connected: true, axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIdx.includes(i), value: pressedIdx.includes(i) ? 1 : 0 })),
});

it('reads live pads, skips the TV remote and empty slots', () => {
  const pads = readPads([null, gp(1, '8Bitdo SN30 Pro (STANDARD GAMEPAD Vendor: 2dc8)', [9]), gp(0, 'NVIDIA SHIELD Remote', [0])]);
  expect(pads).toHaveLength(1);
  expect(pads[0]).toMatchObject({ index: 1, name: '8Bitdo SN30 Pro', active: true });
  expect(readPads([gp(0, 'Pad', [], [0.2, -0.3, 0, 0])])[0].active).toBe(false); // resting stick inside the deadzone
});

it('names presses by position and stick direction', () => {
  const [pad] = readPads([gp(0, 'Pad', [0, 9], [-1, -1, 0, 0])]);
  expect(describePress(pad)).toBe('bottom face button + Start + stick up-left');
  expect(displayName('')).toBe('Controller');
});

it('changes signature only when what is pressed changes', () => {
  const a = padsSignature(readPads([gp(0, 'Pad', [1])]));
  expect(padsSignature(readPads([gp(0, 'Pad', [1])]))).toBe(a);
  expect(padsSignature(readPads([gp(0, 'Pad', [])]))).not.toBe(a);
});

it('attributes a pad to a row only when one connected row carries its name', () => {
  const pads = readPads([gp(0, '8BitDo SN30 Pro', [0])]);
  const one = [{ address: 'A', name: '8Bitdo SN30 Pro' }, { address: 'K', name: 'Keyboard' }];
  expect([...attributePads(pads, one)]).toEqual([['A', 0]]);
  const two = [{ address: 'A', name: '8Bitdo SN30 Pro' }, { address: 'B', name: '8Bitdo SN30 Pro' }];
  expect(attributePads(pads, two).size).toBe(0);
});
