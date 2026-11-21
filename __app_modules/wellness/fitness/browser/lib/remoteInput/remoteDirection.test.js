import { describe, expect, it } from 'vitest';
import { remoteBrowserKeys, remoteDirection, resolveRemoteDirection } from './remoteDirection.js';

// The two remotes as input.yml records them: one model, mounted
// mirror-image on the two handlebars.
const BUTTONS = {
  call: 'MediaPlayPause', forward: 'MediaTrackNext', reverse: 'MediaTrackPrevious',
  plus: 'AudioVolumeUp', minus: 'AudioVolumeDown',
};
const RIGHT = {
  id: 'right_remote', kind: 'remote', address: 'AA:BB:CC:00:00:01',
  positions: { up: 'forward', down: 'reverse', left: 'plus', right: 'minus', center: 'call' },
  toward: { front: 'left', rear: 'right' }, buttons: BUTTONS,
};
const LEFT = {
  id: 'left_remote', kind: 'remote', address: 'AA:BB:CC:00:00:02',
  positions: { up: 'reverse', down: 'forward', left: 'minus', right: 'plus', center: 'call' },
  toward: { front: 'right', rear: 'left' }, buttons: BUTTONS,
};
const PAD = { id: 'pad', address: 'AA:BB:CC:00:00:03', gamepad: {} };
const STICK = { id: 'stick', kind: 'remote', address: 'AA:BB:CC:00:00:04', buttons: { a: 'ButtonA' } };
const CONTROLLERS = [PAD, RIGHT, LEFT, STICK];

describe('remote direction', () => {
  it.each([
    ['MediaPlayPause', 'center', 'center'],
    ['MediaTrackNext', 'up', 'up'],
    ['MediaTrackPrevious', 'down', 'down'],
    ['AudioVolumeUp', 'left', 'front'],
    ['AudioVolumeDown', 'right', 'rear'],
  ])('right remote: %s is %s (%s)', (key, position, direction) => {
    expect(remoteDirection(RIGHT, key)).toMatchObject({ position, direction });
  });

  it.each([
    ['MediaPlayPause', 'center', 'center'],
    ['MediaTrackPrevious', 'up', 'up'],
    ['MediaTrackNext', 'down', 'down'],
    ['AudioVolumeUp', 'right', 'front'],
    ['AudioVolumeDown', 'left', 'rear'],
  ])('left remote (mirrored): %s is %s (%s)', (key, position, direction) => {
    expect(remoteDirection(LEFT, key)).toMatchObject({ position, direction });
  });

  it('without toward, the position is the direction', () => {
    const plain = { ...RIGHT, toward: undefined };
    expect(remoteDirection(plain, 'AudioVolumeUp')).toMatchObject({ position: 'left', direction: 'left' });
  });

  it('a key that is none of its buttons resolves to nothing', () => {
    expect(remoteDirection(RIGHT, 'Enter')).toBeNull();
  });
});

describe('resolveRemoteDirection', () => {
  it('both mirrored remotes agree by rider direction', () => {
    for (const remote of [RIGHT, LEFT]) {
      const at = (key) => resolveRemoteDirection({ controllers: CONTROLLERS, address: remote.address, key })?.direction;
      expect(at('MediaPlayPause')).toBe('center');
      expect(at('AudioVolumeUp')).toBe('front');
      expect(at('AudioVolumeDown')).toBe('rear');
    }
    expect(resolveRemoteDirection({ controllers: CONTROLLERS, address: RIGHT.address, key: 'MediaTrackNext' })).toMatchObject({ direction: 'up', button: 'forward' });
    expect(resolveRemoteDirection({ controllers: CONTROLLERS, address: LEFT.address, key: 'MediaTrackPrevious' })).toMatchObject({ direction: 'up', button: 'reverse' });
  });

  it('matches the address case-insensitively and reports it upper-case', () => {
    expect(resolveRemoteDirection({ controllers: CONTROLLERS, address: 'aa:bb:cc:00:00:01', key: 'MediaPlayPause' }))
      .toMatchObject({ direction: 'center', address: 'AA:BB:CC:00:00:01', controllerId: 'right_remote' });
  });

  it('an unknown remote or a remote without positions gives nothing', () => {
    expect(resolveRemoteDirection({ controllers: CONTROLLERS, address: '00:00:00:00:00:09', key: 'MediaPlayPause' })).toBeNull();
    expect(resolveRemoteDirection({ controllers: CONTROLLERS, address: STICK.address, key: 'ButtonA' })).toBeNull();
  });
});

describe('remoteBrowserKeys', () => {
  it('lists the keys positioned remotes send, nothing else', () => {
    expect([...remoteBrowserKeys(CONTROLLERS)].sort()).toEqual(Object.values(BUTTONS).sort());
  });
});
