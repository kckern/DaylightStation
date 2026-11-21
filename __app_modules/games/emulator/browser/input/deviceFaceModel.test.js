import { describe, it, expect } from 'vitest';
import { capActionLabel, faceKind, humanizeControl, padFace, padHeld, positionOfKey, remoteFace, savedFor } from './deviceFaceModel.js';

// Shaped like the garage's input.yml remotes; no device is named in the code.
const ROW_REMOTE = { kind: 'remote', layout: 'row', buttons: { call: 'MediaPlayPause', forward: 'MediaTrackNext', reverse: 'MediaTrackPrevious', plus: 'AudioVolumeUp', minus: 'AudioVolumeDown' } };
const STICK_REMOTE = {
  kind: 'remote', layout: 'stick-pad',
  buttons: { a: 'ButtonA', b: 'ButtonB', c: 'ButtonC', d: 'ButtonD', circle_trigger: 'TriggerCircle', back_trigger: 'TriggerBack', stick_up: 'StickUp', stick_down: 'StickDown', stick_left: 'StickLeft', stick_right: 'StickRight' },
};
const GROUPS = [{ id: 'navigate', label: 'Navigate', actions: [{ id: 'up', label: 'Up' }] }, { id: 'nothing', label: 'Nothing', actions: [{ id: 'none', label: 'Nothing' }] }];

describe('deviceFaceModel', () => {
  it('humanizes control names in sentence case', () => {
    expect(['circle_trigger', 'stickUp', 'a', 'call'].map(humanizeControl)).toEqual(['Circle trigger', 'Stick up', 'A', 'Call']);
  });

  it('layout: row keeps buttons: order', () => {
    const face = remoteFace(ROW_REMOTE);
    expect(face).toMatchObject({ source: 'inventory', layout: 'row' });
    expect(face.caps.map((c) => [c.legend, c.key])).toEqual([
      ['Call', 'MediaPlayPause'], ['Forward', 'MediaTrackNext'], ['Reverse', 'MediaTrackPrevious'], ['Plus', 'AudioVolumeUp'], ['Minus', 'AudioVolumeDown'],
    ]);
  });

  it('layout: stick-pad puts directions on the cross, triggers on top, the rest in the grid', () => {
    const face = remoteFace(STICK_REMOTE);
    expect(face.layout).toBe('stick-pad');
    const role = Object.fromEntries(face.caps.map((c) => [c.key, c.role]));
    expect(role).toMatchObject({ StickUp: 'up', StickDown: 'down', StickLeft: 'left', StickRight: 'right', TriggerCircle: 'top', TriggerBack: 'top', ButtonA: 'grid', ButtonD: 'grid' });
    expect(face.caps.find((c) => c.key === 'StickUp').legend).toBe('Up');
    expect(face.caps.filter((c) => c.role === 'grid').map((c) => c.legend)).toEqual(['A', 'B', 'C', 'D']);
    expect(face.caps.filter((c) => c.role === 'top').map((c) => c.legend)).toEqual(['Circle', 'Back']);
  });

  it('positions: a five-key cross as mounted, named by position, printed name small, saved by position', () => {
    const mounted = { ...ROW_REMOTE, positions: { up: 'reverse', down: 'forward', left: 'plus', right: 'minus', center: 'call' } };
    const face = remoteFace(mounted);
    expect(face).toMatchObject({ layout: 'cross', by: 'position' });
    expect(face.caps.map((c) => [c.slot, c.legend, c.printed, c.key])).toEqual([
      ['up', 'Up', 'Reverse', 'MediaTrackPrevious'], ['left', 'Left', 'Plus', 'AudioVolumeUp'], ['center', 'Centre', 'Call', 'MediaPlayPause'],
      ['right', 'Right', 'Minus', 'AudioVolumeDown'], ['down', 'Down', 'Forward', 'MediaTrackNext'],
    ]);
    expect(positionOfKey(mounted, 'MediaTrackNext')).toBe('down');
    expect(face.toward).toEqual({});
    expect(remoteFace({ ...mounted, toward: { front: 'left', rear: 'right' } }).toward).toEqual({ left: 'front', right: 'rear' });
    expect(positionOfKey(ROW_REMOTE, 'MediaTrackNext')).toBeNull();
    const entry = { positions: { up: 'next' }, buttons: { MediaTrackPrevious: 'none' } };
    expect(capActionLabel(face.caps[0], savedFor(entry, face), [{ actions: [{ id: 'next', label: 'Next' }] }])).toBe('Next');
    expect(savedFor(entry, remoteFace(ROW_REMOTE))).toBe(entry.buttons);
  });

  it("an emulator: map puts each keycap's game button under it when nothing is set; a set action wins", () => {
    const face = remoteFace({ ...STICK_REMOTE, emulator: { a: 'b', stick_up: 'up', circle_trigger: 'start' } });
    const cap = (k) => face.caps.find((c) => c.key === k);
    expect(capActionLabel(cap('ButtonA'), null, GROUPS)).toBe('Game: B');
    expect(capActionLabel(cap('StickUp'), null, GROUPS)).toBe('Game: Up');
    expect(capActionLabel(cap('TriggerCircle'), null, GROUPS)).toBe('Game: Start');
    expect(capActionLabel(cap('ButtonB'), null, GROUPS)).toBe('Not set');
    expect(capActionLabel(cap('ButtonA'), { ButtonA: 'up' }, GROUPS)).toBe('Up');
  });

  it('no layout hint: a wrapped grid in buttons: order; stick-pad with no direction falls back to a grid', () => {
    expect(remoteFace({ buttons: { x: 'KeyX', y: 'KeyY' } }).layout).toBe('grid');
    expect(remoteFace({ layout: 'stick-pad', buttons: { x: 'KeyX' } }).layout).toBe('grid');
  });

  it('no inventory entry: keycaps from the keys it sent, first-seen order, no repeats', () => {
    const face = remoteFace(null, ['Enter', 'ArrowUp', 'Enter']);
    expect(face).toMatchObject({ source: 'seen', layout: 'grid' });
    expect(face.caps.map((c) => c.legend)).toEqual(['Enter', 'Up arrow']);
  });

  it('the action under a keycap is the saved one, else Not set', () => {
    const [cap] = remoteFace(ROW_REMOTE).caps;
    expect(capActionLabel(cap, { MediaPlayPause: 'up' }, GROUPS)).toBe('Up');
    expect(capActionLabel(cap, { MediaPlayPause: 'none' }, GROUPS)).toBe('Nothing');
    expect(capActionLabel(cap, null, GROUPS)).toBe('Not set');
  });

  it('pads: the standard face; held from buttons, and the cross from the D-pad or the left stick', () => {
    const face = padFace();
    expect(face.layout).toBe('pad');
    expect(face.caps.find((c) => c.id === 'pad:0')).toMatchObject({ legend: 'A', role: 'face-bottom', action: 'Select' });
    const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 1, value: i === 1 ? 1 : 0 }));
    expect([...padHeld([{ buttons, axes: [-1, 0] }])].sort()).toEqual(['pad:1', 'pad:14']);
    expect(faceKind({ kind: 'gamepad' }, null)).toBe('pad');
    expect(faceKind({ kind: 'keyboard' }, ROW_REMOTE)).toBe('remote');
    expect(faceKind({ kind: null }, { id: 'xbox', match: 'Xbox' })).toBe('pad');
  });
});
