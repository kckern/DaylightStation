import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { isPlausibleGamepad, getActiveGamepads } from '../../../../../frontend/src/screen-framework/input/gamepadFiltering.js';

const fakePad = (overrides = {}) => ({
  id: '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)',
  buttons: new Array(17).fill(null).map(() => ({ pressed: false })),
  axes: [0, 0, 0, 0],
  ...overrides,
});

describe('isPlausibleGamepad', () => {
  test('rejects null/undefined', () => {
    expect(isPlausibleGamepad(null)).toBe(false);
    expect(isPlausibleGamepad(undefined)).toBe(false);
  });

  test('accepts an 8Bitdo SN30 Pro shape', () => {
    expect(isPlausibleGamepad(fakePad())).toBe(true);
  });

  test('rejects a wireless mouse receiver misclassified as gamepad', () => {
    expect(isPlausibleGamepad(fakePad({
      id: 'wireless wireless 2.4G Mouse (Vendor: 093a Product: 2510)',
      buttons: new Array(16).fill(null).map(() => ({ pressed: false })),
    }))).toBe(false);
  });

  test('rejects a keyboard misclassified as gamepad', () => {
    expect(isPlausibleGamepad(fakePad({ id: 'Logitech USB Keyboard' }))).toBe(false);
  });

  test('rejects devices with too few buttons or axes', () => {
    expect(isPlausibleGamepad(fakePad({
      buttons: new Array(3).fill(null).map(() => ({ pressed: false })),
    }))).toBe(false);
    expect(isPlausibleGamepad(fakePad({ axes: [0] }))).toBe(false);
  });
});

describe('getActiveGamepads', () => {
  let originalGetGamepads;

  beforeEach(() => {
    originalGetGamepads = global.navigator?.getGamepads;
    if (!global.navigator) global.navigator = {};
  });

  afterEach(() => {
    if (originalGetGamepads) global.navigator.getGamepads = originalGetGamepads;
    else delete global.navigator.getGamepads;
  });

  test('returns empty array when no navigator.getGamepads', () => {
    delete global.navigator.getGamepads;
    expect(getActiveGamepads()).toEqual([]);
  });

  test('filters out null slots', () => {
    global.navigator.getGamepads = () => [null, fakePad(), null];
    expect(getActiveGamepads()).toHaveLength(1);
  });

  test('filters out non-gamepad devices', () => {
    global.navigator.getGamepads = () => [
      fakePad({ id: 'wireless 2.4G Mouse' }),
      fakePad(),
    ];
    const result = getActiveGamepads();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)');
  });

  test('returns all plausible gamepads (no id-based dedupe; same-id devices kept)', () => {
    global.navigator.getGamepads = () => [
      fakePad(),
      fakePad(), // same id — could be a phantom OR a real second identical controller
      fakePad({ id: 'Some Other Controller' }),
    ];
    const result = getActiveGamepads();
    // Both same-id entries kept; phantom suppression is GamepadAdapter's job.
    expect(result).toHaveLength(3);
  });
});
