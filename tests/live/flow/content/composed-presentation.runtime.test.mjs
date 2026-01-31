/**
 * Composed Presentation Runtime Tests
 *
 * Verifies:
 * 1. compose URL parameter loads composite player
 * 2. app:clock renders ClockDisplay component
 * 3. app:blackout renders BlackoutScreen component
 * 4. URL modifiers (loop, shuffle) are parsed without errors
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Frontend available at same port (Vite proxy or prod topology)
 *
 * Created: 2026-01-31
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;

test.describe.configure({ mode: 'serial' });

test.describe('Composed Presentation', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    // Track console errors
    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Browser console error: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: compose URL loads composite player
  // ═══════════════════════════════════════════════════════════════════════════
  test('compose URL loads composite player', async () => {
    test.setTimeout(15000);

    const composeUrl = `${BASE_URL}/tv?compose=app:clock`;
    console.log(`\nNavigating to: ${composeUrl}`);

    await sharedPage.goto(composeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for app to mount
    await sharedPage.waitForTimeout(2000);

    // Check for composite player with data-track="visual"
    const compositePlayer = sharedPage.locator('[data-track="visual"]');
    const playerCount = await compositePlayer.count();

    console.log(`Composite player elements found: ${playerCount}`);

    expect(playerCount).toBeGreaterThan(0);
    console.log('Composite player rendered successfully');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: app:clock renders ClockDisplay
  // ═══════════════════════════════════════════════════════════════════════════
  test('app:clock renders ClockDisplay', async () => {
    test.setTimeout(15000);

    const clockUrl = `${BASE_URL}/tv?compose=app:clock`;
    console.log(`\nNavigating to: ${clockUrl}`);

    await sharedPage.goto(clockUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for component to render
    await sharedPage.waitForTimeout(2000);

    // Check for clock component with data-visual-type="clock"
    const clockComponent = sharedPage.locator('[data-visual-type="clock"]');
    const clockCount = await clockComponent.count();

    console.log(`Clock components found: ${clockCount}`);

    expect(clockCount).toBeGreaterThan(0);
    console.log('ClockDisplay rendered successfully');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: app:blackout renders BlackoutScreen
  // ═══════════════════════════════════════════════════════════════════════════
  test('app:blackout renders BlackoutScreen', async () => {
    test.setTimeout(15000);

    const blackoutUrl = `${BASE_URL}/tv?compose=app:blackout`;
    console.log(`\nNavigating to: ${blackoutUrl}`);

    await sharedPage.goto(blackoutUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for component to render
    await sharedPage.waitForTimeout(2000);

    // Check for blackout component with data-visual-type="blackout"
    const blackoutComponent = sharedPage.locator('[data-visual-type="blackout"]');
    const blackoutCount = await blackoutComponent.count();

    console.log(`Blackout components found: ${blackoutCount}`);

    expect(blackoutCount).toBeGreaterThan(0);
    console.log('BlackoutScreen rendered successfully');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: URL modifiers are parsed
  // ═══════════════════════════════════════════════════════════════════════════
  test('URL modifiers are parsed without errors', async () => {
    test.setTimeout(15000);

    const modifierUrl = `${BASE_URL}/tv?compose=app:clock&loop=1&shuffle=1`;
    console.log(`\nNavigating to: ${modifierUrl}`);

    // Track any page errors
    let pageError = null;
    sharedPage.once('pageerror', error => {
      pageError = error;
    });

    await sharedPage.goto(modifierUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for page to fully load and process
    await sharedPage.waitForTimeout(2000);

    // Verify no JavaScript errors occurred
    if (pageError) {
      console.log(`Page error: ${pageError.message}`);
    }
    expect(pageError).toBeNull();

    // Verify the page loaded (has some content)
    const bodyContent = await sharedPage.locator('body').innerHTML();
    expect(bodyContent.length).toBeGreaterThan(0);

    console.log('URL modifiers parsed successfully without errors');
  });

});
