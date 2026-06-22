// GamepadAdapter.capture.test.js
// Verifies that window.__emulatorCapturingGamepad suppresses actionBus emits
// while the poll loop stays alive, and that the adapter resumes normally once
// capture ends (no burst of stale events on re-arm).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GamepadAdapter } from './GamepadAdapter.js';

// Build a minimal fake gamepad that passes isPlausibleGamepad's checks:
//   gp.buttons.length >= 4, gp.axes.length >= 2, id has no non-gamepad pattern.
function makeGamepad({ pressedButtons = [], id = 'Test Gamepad', index = 0 } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressedButtons.includes(i),
    value: pressedButtons.includes(i) ? 1 : 0,
  }));
  const axes = [0, 0, 0, 0]; // 4 axes, all centred
  return { id, index, buttons, axes, mapping: 'standard' };
}

// Stub navigator.getGamepads to return a fixed set of gamepads.
// happy-dom's navigator doesn't define getGamepads, so we set it directly
// rather than using vi.spyOn (which requires the property to pre-exist).
function stubGamepads(gamepads) {
  navigator.getGamepads = () => gamepads;
}

describe('GamepadAdapter — emulator capture seam', () => {
  let actionBus;
  let adapter;

  // Monotonically increasing fake clock used to control performance.now().
  // _claimFire's 50ms dedup window uses performance.now() — we need full
  // control so sequential polls don't look instantaneous.
  let fakeClock;

  beforeEach(() => {
    fakeClock = 1000; // start well above 50ms so first _claimFire passes immediately
    vi.spyOn(performance, 'now').mockImplementation(() => fakeClock);

    actionBus = { emit: vi.fn() };
    adapter = new GamepadAdapter(actionBus);
    // Ensure the capture flag is clear before each test.
    delete window.__emulatorCapturingGamepad;
  });

  afterEach(() => {
    delete window.__emulatorCapturingGamepad;
    vi.restoreAllMocks();
  });

  // Simulate a button press edge-transition:
  //  1. Seed frame: gamepad present with button NOT pressed → _seeded[gpIdx] set, prev[btn] = false
  //  2. Advance clock so _claimFire's 50ms dedup is clear
  //  3. Edge frame: same gamepad with button NOW pressed → pressed=true, wasPressed=false → emit
  //
  // This correctly models the physical sequence: controller connected (seeded),
  // user presses button (edge detected on next poll).
  function pressButton(buttonIdx, gpId = 'Test Gamepad', gpIndex = 0) {
    // Step 1: seed with button NOT pressed
    stubGamepads([makeGamepad({ id: gpId, index: gpIndex, pressedButtons: [] })]);
    adapter._pollGamepad();
    // Step 2: advance clock so _claimFire dedup window (50ms) is clear
    fakeClock += 100;
    // Step 3: poll with button pressed → edge detected
    stubGamepads([makeGamepad({ id: gpId, index: gpIndex, pressedButtons: [buttonIdx] })]);
    adapter._pollGamepad();
  }

  it('emits normally with no capture flag set', () => {
    pressButton(0); // button 0 = A → 'select'
    expect(actionBus.emit).toHaveBeenCalledWith('select', {});
  });

  it('suppresses actionBus.emit while __emulatorCapturingGamepad is true', () => {
    window.__emulatorCapturingGamepad = true;

    // Seed and press: nothing should reach the bus.
    stubGamepads([makeGamepad({ pressedButtons: [] })]);
    adapter._pollGamepad(); // seed frame
    fakeClock += 100;
    stubGamepads([makeGamepad({ pressedButtons: [0] })]);
    adapter._pollGamepad(); // edge frame — suppressed by capture guard

    expect(actionBus.emit).not.toHaveBeenCalled();
  });

  it('resumes emitting after capture ends, without a phantom burst', () => {
    // Phase 1: capture active, several polls with button 12 (D-pad up) held.
    // The guard calls _invalidateAllSeeds each time, keeping seeds clear.
    window.__emulatorCapturingGamepad = true;
    stubGamepads([makeGamepad({ pressedButtons: [12] })]);
    adapter._pollGamepad();
    fakeClock += 100;
    adapter._pollGamepad();
    fakeClock += 100;
    adapter._pollGamepad();
    expect(actionBus.emit).not.toHaveBeenCalled();

    // Phase 2: capture ends. _invalidateAllSeeds() was the last thing the guard
    // did, so the NEXT poll re-seeds (absorbs the held button 12 as baseline)
    // instead of firing a phantom press.
    delete window.__emulatorCapturingGamepad;
    fakeClock += 100;
    // Still returning gamepad with button 12 held; the seed absorbs it silently.
    adapter._pollGamepad(); // re-seeds → no emit
    expect(actionBus.emit).not.toHaveBeenCalled();

    // Phase 3: now make button 12 released and press button 0 (A = select).
    // After the re-seed the adapter knows button 12 was "already held", so
    // releasing it fires no event. Pressing button 0 (previously unset) fires select.
    fakeClock += 100;
    stubGamepads([makeGamepad({ pressedButtons: [0] })]);
    adapter._pollGamepad(); // edge-detect: btn0 newly pressed → emit select
    expect(actionBus.emit).toHaveBeenCalledWith('select', {});
  });
});
