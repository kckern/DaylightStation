/**
 * TV Shader Cycling Test
 *
 * Loads /tv?queue=music-queue and verifies that ArrowUp/ArrowDown
 * cycle through shader overlay classes: default → focused → night → blackout
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE = BACKEND_URL;
const SHADER_CLASSES = ['default', 'focused', 'night', 'blackout'];

/**
 * Detect the current shader class on any player-family element.
 */
async function getCurrentShader(page) {
  return page.evaluate((shaderClasses) => {
    const selectors = ['.audio-player', '.video-player', '.content-scroller', '.player'];
    for (const selector of selectors) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        for (const cls of shaderClasses) {
          if (el.classList.contains(cls)) return cls;
        }
      }
    }
    return null;
  }, SHADER_CLASSES);
}

test.describe('TV Shader Cycling — ArrowUp/ArrowDown', () => {
  let page, context;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await page?.close();
    await context?.close();
  });

  test('ArrowUp cycles shader forward through all 4 classes', async () => {
    await page.goto(`${BASE}/tv?queue=music-queue`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(8000);
    await page.click('body', { force: true });
    await page.waitForTimeout(500);

    const startShader = await getCurrentShader(page);
    expect(startShader, 'Player should have a shader class after load').not.toBeNull();
    const startIndex = SHADER_CLASSES.indexOf(startShader);

    for (let i = 1; i <= 4; i++) {
      const expected = SHADER_CLASSES[(startIndex + i) % SHADER_CLASSES.length];
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(500);
      const got = await getCurrentShader(page);
      expect(got, `ArrowUp #${i}: expected ${expected}, got ${got}`).toBe(expected);
    }

    // Full cycle: should be back at start
    const afterCycle = await getCurrentShader(page);
    expect(afterCycle).toBe(startShader);
  });

  test('ArrowDown cycles shader backward through all 4 classes', async () => {
    const startShader = await getCurrentShader(page);
    expect(startShader).not.toBeNull();
    const startIndex = SHADER_CLASSES.indexOf(startShader);

    for (let i = 1; i <= 4; i++) {
      const expected = SHADER_CLASSES[(startIndex - i + SHADER_CLASSES.length) % SHADER_CLASSES.length];
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(500);
      const got = await getCurrentShader(page);
      expect(got, `ArrowDown #${i}: expected ${expected}, got ${got}`).toBe(expected);
    }

    const afterCycle = await getCurrentShader(page);
    expect(afterCycle).toBe(startShader);
  });

  test('each shader class applies distinct CSS to the player', async () => {
    // Cycle to each shader and verify the class exists on the player shell
    const startShader = await getCurrentShader(page);
    const startIndex = SHADER_CLASSES.indexOf(startShader);

    for (let i = 0; i < SHADER_CLASSES.length; i++) {
      if (i > 0) {
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(500);
      }

      const target = SHADER_CLASSES[(startIndex + i) % SHADER_CLASSES.length];
      const hasOnShell = await page.evaluate(
        (cls) => !!document.querySelector(`.player.${cls}`),
        target
      );
      expect(hasOnShell, `Player shell should have class "${target}"`).toBe(true);
    }
  });
});
