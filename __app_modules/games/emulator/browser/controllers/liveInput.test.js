import { it, expect } from 'vitest';
import { readPads, displayName, describePress, attributePads, padsSignature, dropTwins } from './liveInput.js';

const gp = (index, id, pressedIdx = [], axes = [0, 0, 0, 0]) => ({
  index, id, connected: true, axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIdx.includes(i), value: pressedIdx.includes(i) ? 1 : 0 })),
});

it('reads live pads, skips the TV remote and empty slots', () => {
  const pads = readPads([gp(0, 'wireless wireless 2.4G Mouse (Vendor: 093a Product: 2510)', [0]), gp(1, '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)', [9]), null, gp(3, 'NVIDIA SHIELD Remote', [0])]);
  expect(pads).toHaveLength(1);
  expect(pads[0]).toMatchObject({ index: 1, player: 1, name: '8Bitdo SN30 Pro', active: true });
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
  expect(attributePads(pads, [{ address: 'P', name: '8Bitdo SN30 Pro+' }]).size).toBe(0); // whole names only
  const both = readPads([gp(0, '8Bitdo SN30 Pro', [0]), gp(1, '8Bitdo SN30 Pro')]);
  expect(attributePads(both, one).size).toBe(0); // two pads, one row: which is it? say nothing
});

it('hides a phantom twin that mirrors every press, but keeps a real identical pad', () => {
  const memory = { twins: new Set(), real: new Set() };
  const id = '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)';
  expect(dropTwins(readPads([gp(1, id), gp(2, id)]), memory)).toHaveLength(2); // idle: cannot tell yet
  const mirrored = dropTwins(readPads([gp(1, id, [0]), gp(2, id, [0])]), memory);
  expect(mirrored.map((p) => [p.index, p.player])).toEqual([[1, 1]]);
  expect(dropTwins(readPads([gp(1, id), gp(2, id)]), memory)).toHaveLength(1); // stays hidden
  const real = { twins: new Set(), real: new Set() };
  dropTwins(readPads([gp(1, id), gp(2, id, [3])]), real);
  expect(dropTwins(readPads([gp(1, id, [0]), gp(2, id, [0])]), real)).toHaveLength(2); // pressed alone once: real
});

it('skips HID receivers Chromium misreports as gamepads', () => {
  expect(readPads([{ index: 0, id: 'Some Presenter', connected: true, axes: [0, 0], buttons: Array(8).fill({ pressed: false }) }])).toHaveLength(0);
  expect(readPads([{ index: 0, id: 'Odd HID', connected: true, axes: [], buttons: Array(8).fill({ pressed: false }) }])).toHaveLength(0);
});
