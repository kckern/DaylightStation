/**
 * Emulator Gamepad Routing — Runtime Smoke Test
 *
 * REGRESSION GUARD for the 2026-08-15 outage: a gamepad that was ALREADY
 * connected when EmulatorJS booted had every input silently discarded.
 * EmulatorJS 4.2.3's GamepadHandler polls synchronously from its own constructor,
 * before `.on("connected")` is bound, so the one and only "connected" event for a
 * pre-existing pad is dispatched into an empty listener map and lost. The pad
 * never lands in `gamepadSelection`, and `gamepadEvent` bails on every event:
 *
 *     const e = this.gamepadSelection.indexOf(pad.id+"_"+pad.index);
 *     if (e < 0) return;
 *
 * WHY THIS TEST EXISTS AT THIS LAYER: 397 unit tests passed for the entire
 * duration of the outage, because every one of them mocks the EJS instance. The
 * contract that actually broke is only observable against a REAL EmulatorJS boot
 * in a REAL browser. This is the only layer that can catch it before deploy.
 *
 * The synthetic pad is installed via addInitScript so it exists BEFORE any page
 * script runs — reproducing the exact "already connected at boot" condition
 * rather than the connect-after-boot case that always worked.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const PAD_ID = 'test-pad-0000-Synthetic Arcade Pad';

/**
 * Install a fake gamepad that is present from the very first poll.
 *
 * Exposes window.__setPadButton(index, pressed) so the test can drive input.
 * EJS reads `.buttons[n].pressed` and diffs against its own cached copy each
 * 10ms tick, so mutating the returned object is enough to generate events.
 */
async function installSyntheticPad(page) {
  await page.addInitScript((padId) => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const pad = {
      id: padId,
      index: 0,
      mapping: 'standard',
      connected: true,
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons,
    };
    window.__syntheticPad = pad;
    window.__setPadButton = (i, pressed) => {
      pad.buttons[i] = { pressed: !!pressed, value: pressed ? 1 : 0 };
      pad.timestamp = Date.now();
    };
    navigator.getGamepads = () => [pad, null, null, null];
  }, PAD_ID);
}

test.describe('Emulator gamepad routing', () => {
  test.setTimeout(180000);

  test('a pad connected BEFORE boot is routed to the running core', async ({ page }) => {
    await installSyntheticPad(page);

    // ?nokiosk bypasses the admin fingerprint gate (see kioskEnv.js) so the
    // arcade launches a game directly.
    await page.goto(`${FRONTEND_URL}/fitness/module/emulator?nokiosk`);

    // The arcade grid renders game cards; take the first playable one.
    const card = page.locator('.emulator-game-card, .game-card, .module-card').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await card.click();

    // Wait for a real EmulatorJS instance to finish its start chain. `started`
    // is the same flag the app's settle barrier waits on.
    await page.waitForFunction(
      () => window.EJS_emulator && window.EJS_emulator.started === true,
      null,
      { timeout: 120000 },
    );

    // ── The core assertion ────────────────────────────────────────────────────
    // The pad must hold a player slot. Without the claim this array is
    // ["","","",""] and every input is discarded — the exact 2026-08-15 failure.
    const selection = await page.evaluate(() => window.EJS_emulator.gamepadSelection);
    expect(selection, 'gamepadSelection should exist on the running instance').toBeTruthy();
    expect(
      selection.includes(`${PAD_ID}_0`),
      `pad missing from gamepadSelection (${JSON.stringify(selection)}) — input would be silently dropped`,
    ).toBe(true);

    // ── End-to-end: a press must reach the core ──────────────────────────────
    // Tap simulateInput, which is the funnel EVERY consumed input passes through.
    await page.evaluate(() => {
      window.__consumed = [];
      const fns = window.EJS_emulator.gameManager.functions;
      const orig = fns.simulateInput.bind(fns);
      fns.simulateInput = (player, index, value) => {
        window.__consumed.push([player, index, value]);
        return orig(player, index, value);
      };
    });

    // Press and release START (standard mapping button 9).
    await page.evaluate(() => window.__setPadButton(9, true));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__setPadButton(9, false));
    await page.waitForTimeout(250);

    const consumed = await page.evaluate(() => window.__consumed);
    expect(
      consumed.length,
      'core consumed zero inputs while the browser reported a button press — the input gap is back',
    ).toBeGreaterThan(0);
  });

  test('the boot settle reports a started emulator and an intact contract', async ({ page }) => {
    await installSyntheticPad(page);

    await page.goto(`${FRONTEND_URL}/fitness/module/emulator?nokiosk`);
    const card = page.locator('.emulator-game-card, .game-card, .module-card').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await card.click();

    await page.waitForFunction(
      () => window.EJS_emulator && window.EJS_emulator.started === true,
      null,
      { timeout: 120000 },
    );

    // Every internal the app reaches into must still exist. If an EmulatorJS
    // upgrade renames one of these, gameplay breaks silently in the garage —
    // this is the guard that turns that into a red test instead.
    const contract = await page.evaluate(() => {
      const e = window.EJS_emulator;
      return {
        started: typeof e.started,
        volume: typeof e.volume,
        gamepadSelection: Array.isArray(e.gamepadSelection),
        gamepads: Array.isArray(e.gamepad?.gamepads),
        simulateInput: typeof e.gameManager?.functions?.simulateInput,
        setVolume: typeof e.setVolume,
      };
    });

    expect(contract).toEqual({
      started: 'boolean',
      volume: 'number',
      gamepadSelection: true,
      gamepads: true,
      simulateInput: 'function',
      setVolume: 'function',
    });
  });
});
