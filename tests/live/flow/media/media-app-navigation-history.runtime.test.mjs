import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
import { revealBrowseRow } from '../../../_lib/mediaBrowseScroll.mjs';
import { answerSpotChooser } from './lib/search.mjs';
import { aimHere } from './lib/aim.mjs';

test.setTimeout(120000);

const surfaces = [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 768, height: 1024 }],
  ['laptop', { width: 1440, height: 900 }],
];

function primary(page, surface, area) {
  return page.getByTestId(`${surface === 'phone' ? 'app-tab' : 'app-nav'}-${area}`);
}

async function openDetail(page, surface) {
  await primary(page, surface, 'browse').click();
  await expect(page.getByTestId('browse-view')).toBeVisible();
  await page.getByTestId('browse-open-plex:').click();
  await page.getByTestId('browse-open-plex:library/sections/6/all').click();
  await revealBrowseRow(page, 'browse-row-plex:55854');
  await page.getByTestId('browse-open-plex:55854').click();
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
}

async function startLocalPlaybackFromBrowse(page, surface) {
  // This device, then the row's ▶ (PLAY without leaving Browse: selecting the
  // row would open its info view instead).
  if (surface === 'phone') {
    await page.getByTestId('media-search-launcher').click();
    await aimHere(page);
    await page.getByTestId('search-mode-input').fill('arrival');
  } else {
    await aimHere(page);
    const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
    await input.fill('arrival');
  }
  await page.getByTestId('result-play-all-plex:55854').click();
  await answerSpotChooser(page);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 30000 });
  if (surface === 'phone') {
    const close = page.getByTestId('search-mode-close');
    if (await close.isVisible().catch(() => false)) await close.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 30000 });
}

for (const [surface, viewport] of surfaces) {
  test(`[RELY.9a/10a] ${surface}: primary ownership, truthful Back, and reselect history`, async ({ page }) => {
    await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
    await page.setViewportSize(viewport);
    await page.goto('/media');

    await openDetail(page, surface);
    await expect(primary(page, surface, 'browse')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('detail-back')).toHaveText(/^\s*Browse$/);
    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();
    await expect(page).toHaveURL(/view=browse.*path=plex%2Flibrary%2Fsections%2F6%2Fall/);
    await expect(page.getByTestId('browse-view-loading')).toBeHidden({ timeout: 30000 });
    await expect(page.getByTestId('browse-row-plex:55854')).toBeVisible({ timeout: 30000 });

    await openDetail(page, surface);
    await primary(page, surface, 'browse').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();
    await expect(page).toHaveURL(/view=browse/);
    await page.goBack();
    await expect(page.getByTestId('home-view')).toBeVisible();

    await primary(page, surface, 'browse').click();
    await startLocalPlaybackFromBrowse(page, surface);
    await expect(primary(page, surface, 'home')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('now-playing-back')).toHaveText(/^\s*Browse$/);
    await page.getByTestId('now-playing-back').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();

    await primary(page, surface, 'fleet').click();
    const peek = page.locator('[data-testid^="fleet-peek-"]').first();
    await expect(peek, 'a live Fleet remote fixture is required for RELY.9a/10a acceptance').toBeVisible({ timeout: 30000 });
    await peek.click();
    await expect(page.getByTestId('peek-panel')).toBeVisible();
    await expect(primary(page, surface, 'fleet')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('peek-back')).toHaveText(/^\s*Devices$/);
    await page.getByTestId('peek-back').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible();
    await expect(page).toHaveURL(/view=fleet/);
  });
}

test('[RELY.10a] phone: SearchMode consumes one browser Back and sheet Escape keeps it open', async ({ page }) => {
  await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/media');
  await primary(page, 'phone', 'browse').click();
  await expect(page.getByTestId('browse-view')).toBeVisible();
  await page.getByTestId('media-search-launcher').click();
  await expect(page.getByTestId('search-mode')).toBeVisible();
  await page.getByTestId('search-mode-input').fill('Arrival');
  // A layer over the sheet (a result's ⋯ menu): Escape closes the layer only.
  await expect(page.getByTestId('result-more-plex:55854')).toBeVisible({ timeout: 40000 });
  await page.getByTestId('result-more-plex:55854').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('search-mode')).toBeVisible();
  await expect(page.getByTestId('search-mode-input')).toHaveValue('Arrival');
  await page.goBack();
  await expect(page.getByTestId('search-mode')).toBeHidden();
  await expect(page.getByTestId('browse-view')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('home-view')).toBeVisible();
});

for (const [surface, viewport] of surfaces.filter(([surface]) => surface !== 'phone')) {
  test(`[RELY.10a] ${surface}: search popup consumes one Escape before route Back`, async ({ page }) => {
    await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
    await page.setViewportSize(viewport);
    await page.goto('/media');
    await primary(page, surface, 'browse').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();

    const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
    await input.fill('Frozen');
    const resultOptions = page.locator('[data-testid^="combobox-option-"]');
    await expect(resultOptions.first()).toBeVisible({ timeout: 30000 });
    await page.keyboard.press('Escape');
    // The box keeps its words and results (retained, hidden) when the list closes.
    await expect(resultOptions.first()).toBeHidden();
    await expect(input).toHaveValue('Frozen');
    await expect(page).toHaveURL(/view=browse/);
    await page.goBack();
    await expect(page.getByTestId('home-view')).toBeVisible();
  });
}

for (const [surface, viewport] of surfaces) {
  test(`[RELY.10a] ${surface}: depth-one and unknown URLs normalize to Home`, async ({ page }) => {
    await page.addInitScript(() => { try { (() => { const k = 'media-app.first-use-done'; const v = localStorage.getItem(k); localStorage.clear(); if (v) localStorage.setItem(k, v); })(); } catch {} });
    await page.setViewportSize(viewport);
    await page.goto('/media?view=detail&contentId=plex:55854');
    await expect(page.getByTestId('detail-back')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('home-view')).toBeVisible();
    await expect(page).toHaveURL(/\/media$/);

    await page.goto('/media?view=nope');
    await expect(page.getByTestId('home-view')).toBeVisible();
    await expect(page).toHaveURL(/\/media$/);
  });
}
