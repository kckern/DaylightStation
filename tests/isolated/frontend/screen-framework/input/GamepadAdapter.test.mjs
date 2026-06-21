import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GamepadAdapter } from '../../../../../frontend/src/screen-framework/input/adapters/GamepadAdapter.js';

// Button 8 (Select) maps to Escape in GamepadAdapter's BUTTON_MAP.
const ESCAPE_BUTTON = 8;

const makePad = (overrides = {}) => ({
  index: 1,
  id: '8Bitdo SF30 Pro (Vendor: 2dc8 Product: 6100)',
  mapping: '',
  buttons: new Array(17).fill(null).map(() => ({ pressed: false })),
  axes: [0, 0, 0, 0],
  ...overrides,
});

describe('GamepadAdapter — phantom edge suppression across RetroArch→FKB transitions', () => {
  let pad;
  let adapter;
  let actionBus;
  let keys;
  let onKeyDown;
  let realRAF;
  let realCAF;
  let realGetGamepads;

  beforeEach(() => {
    pad = makePad();

    // Stub rAF so polling never auto-advances; we step frames manually via
    // adapter._pollGamepad() for determinism.
    realRAF = globalThis.requestAnimationFrame;
    realCAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};

    realGetGamepads = global.navigator?.getGamepads;
    if (!global.navigator) global.navigator = {};
    global.navigator.getGamepads = () => [null, pad];

    actionBus = { emit: vi.fn() };
    adapter = new GamepadAdapter(actionBus);

    keys = [];
    onKeyDown = (e) => { keys.push(e.key); };
    window.addEventListener('keydown', onKeyDown);
  });

  afterEach(() => {
    window.removeEventListener('keydown', onKeyDown);
    adapter.destroy();
    globalThis.requestAnimationFrame = realRAF;
    globalThis.cancelAnimationFrame = realCAF;
    if (realGetGamepads) global.navigator.getGamepads = realGetGamepads;
    else delete global.navigator.getGamepads;
  });

  // Guard against a vacuous test: a genuine press after seeding MUST emit.
  test('emits Escape for a genuine button press after seeding', () => {
    adapter.attach();
    adapter._pollGamepad(); // seed frame — no emit
    expect(keys).toEqual([]);

    pad.buttons[ESCAPE_BUTTON].pressed = true;
    adapter._pollGamepad();
    expect(keys).toContain('Escape');
  });

  test('does NOT emit on visibility resume when a button changed while hidden', () => {
    adapter.attach();
    adapter._pollGamepad(); // seed with button released
    expect(keys).toEqual([]);

    // Simulate the WebView being backgrounded during RetroArch: the poll loop
    // is frozen, and the controller's button state changes out-of-band (e.g.
    // the RetroArch quit combo). On resume the live state differs from the
    // stale seed.
    pad.buttons[ESCAPE_BUTTON].pressed = true;
    document.dispatchEvent(new Event('visibilitychange'));

    adapter._pollGamepad();
    expect(keys).toEqual([]); // resume must re-seed, not edge-detect against stale state
  });

  test('does NOT emit on the first frame after a frozen poll gap (WebView resume), even with no visibility/connect event', () => {
    adapter.attach();
    adapter._pollGamepad(); // seed with button released
    expect(keys).toEqual([]);

    // Simulate the poll loop having been frozen for the whole RetroArch session:
    // backdate the last-poll timestamp past the stale threshold. No
    // visibilitychange, no gamepadconnected — just a long gap, as seen in prod
    // (the first phantom Escape fired on resume with no nearby connect event).
    adapter._lastPollAt = adapter._lastPollAt - 30000;
    pad.buttons[ESCAPE_BUTTON].pressed = true;

    adapter._pollGamepad();
    expect(keys).toEqual([]); // stale gap must trigger a re-seed
  });

  test('does NOT emit when gamepadconnected re-fires with a flickering button (no disconnect)', () => {
    adapter.attach();
    adapter._pollGamepad(); // seed with button released
    expect(keys).toEqual([]);

    // Bluetooth re-link on RetroArch exit: gamepadconnected fires again for the
    // same index with no intervening disconnect, while button state flickers.
    pad.buttons[ESCAPE_BUTTON].pressed = true;
    adapter._onConnected({ gamepad: pad });

    adapter._pollGamepad();
    expect(keys).toEqual([]); // reconnect must re-seed for that index
  });
});
