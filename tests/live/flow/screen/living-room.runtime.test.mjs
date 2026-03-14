// tests/live/flow/screen/living-room.runtime.test.mjs
import { test, expect } from '@playwright/test';

const ROUTE = '/screen/living-room';
const LOAD_TIMEOUT = 15000;

test.describe('Living Room Screen — Menu Widget', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE);
    // Wait for menu items to render (menu widget fetches data then renders)
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });
  });

  test('renders menu with items from tvapp.yml', async ({ page }) => {
    const items = page.locator('.menu-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(5); // tvapp.yml has 20+ items
  });

  test('first item is selected by default', async ({ page }) => {
    const activeItem = page.locator('.menu-item.active');
    await expect(activeItem).toHaveCount(1);
  });

  test('arrow keys navigate between items', async ({ page }) => {
    const getActiveLabel = () =>
      page.locator('.menu-item.active .menu-item-label').textContent();

    const firstLabel = await getActiveLabel();

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const secondLabel = await getActiveLabel();
    expect(secondLabel).not.toBe(firstLabel);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);

    const backLabel = await getActiveLabel();
    expect(backLabel).toBe(firstLabel);
  });

  test('android items render with disabled class (no FKB in headless)', async ({ page }) => {
    const disabledItems = page.locator('.menu-item.disabled');
    const count = await disabledItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

});

test.describe('Living Room Screen — Menu Item Selection', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });
  });

  test('selecting a plex list item opens a submenu', async ({ page }) => {
    const items = page.locator('.menu-item');
    const count = await items.count();
    let targetIdx = -1;
    for (let i = 0; i < count; i++) {
      const label = await items.nth(i).locator('.menu-item-label').textContent();
      if (label === 'Veggietales') { targetIdx = i; break; }
    }

    expect(targetIdx).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < targetIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }

    await page.keyboard.press('Enter');

    // Veggietales opens a ShowView (not a TVMenu) — wait for the menu to disappear
    // or a new view to render (show-view has show art + season list)
    await page.waitForFunction(() => {
      const menuHeader = document.querySelector('.menu-header h2');
      const showView = document.querySelector('.show-view, .season-view, .plex-menu-router');
      // Either the menu header changed or a show/season view appeared
      return showView || (menuHeader && menuHeader.textContent !== 'Tvapp');
    }, { timeout: 10000 });
  });

  test('selecting an android item shows AndroidLaunchCard', async ({ page }) => {
    const items = page.locator('.menu-item');
    const count = await items.count();
    let androidIdx = -1;

    for (let i = 0; i < count; i++) {
      const classes = await items.nth(i).getAttribute('class');
      if (classes && classes.includes('disabled')) {
        androidIdx = i;
        break;
      }
    }

    expect(androidIdx).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < androidIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }

    await page.keyboard.press('Enter');

    await page.waitForSelector('.android-launch-card', { timeout: 5000 });
    const statusText = await page.locator('.android-launch-card__status').textContent();
    expect(statusText).toContain('Not available');
  });

  test('escape from AndroidLaunchCard returns to menu', async ({ page }) => {
    const items = page.locator('.menu-item');
    const count = await items.count();
    let androidIdx = -1;

    for (let i = 0; i < count; i++) {
      const classes = await items.nth(i).getAttribute('class');
      if (classes && classes.includes('disabled')) {
        androidIdx = i;
        break;
      }
    }

    expect(androidIdx).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < androidIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }

    await page.keyboard.press('Enter');
    await page.waitForSelector('.android-launch-card', { timeout: 5000 });

    await page.keyboard.press('Escape');

    await page.waitForSelector('.menu-item', { timeout: 5000 });
    const launchCard = page.locator('.android-launch-card');
    await expect(launchCard).toHaveCount(0);
  });
});

test.describe('Living Room Screen — Autoplay URL Params', () => {

  test('play param opens player directly', async ({ page }) => {
    await page.goto(`${ROUTE}?play=plex:642120`);

    await page.waitForFunction(() => {
      return document.querySelector('.player-overlay, video, audio, .player-container');
    }, { timeout: LOAD_TIMEOUT });
  });

  test('bare route shows menu (no autoplay)', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });

    const menuItems = page.locator('.menu-item');
    const menuCount = await menuItems.count();
    expect(menuCount).toBeGreaterThan(0);
  });

});

test.describe('Living Room Screen — Escape Navigation', () => {

  test('escape from submenu returns to root menu', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });

    const items = page.locator('.menu-item');
    const count = await items.count();
    let listIdx = -1;

    for (let i = 0; i < count; i++) {
      const label = await items.nth(i).locator('.menu-item-label').textContent();
      if (label === 'Veggietales') { listIdx = i; break; }
    }

    expect(listIdx).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < listIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }
    await page.keyboard.press('Enter');

    // Wait for submenu/show view to appear
    await page.waitForFunction(() => {
      const menuHeader = document.querySelector('.menu-header h2');
      const showView = document.querySelector('.show-view, .season-view, .plex-menu-router');
      return showView || (menuHeader && menuHeader.textContent !== 'Tvapp');
    }, { timeout: 10000 });

    await page.keyboard.press('Escape');

    // Should be back at root menu — menu header shows 'Tvapp' again
    await page.waitForFunction(() => {
      const header = document.querySelector('.menu-header h2');
      return header && header.textContent === 'Tvapp';
    }, { timeout: 5000 });
  });

});
