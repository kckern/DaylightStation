import { test, expect } from '@playwright/test';

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
  await page.getByTestId('browse-detail-plex:55854').click();
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
}

async function startLocalPlaybackFromBrowse(page, surface) {
  if (surface === 'phone') {
    await page.getByTestId('media-search-launcher').click();
    const input = page.getByTestId('search-mode-input');
    await input.fill('arrival');
    await page.getByTestId('search-mode-result-plex:55854').click();
    await page.getByTestId('search-mode-close').click();
  } else {
    const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
    await input.fill('arrival');
    await page.getByTestId('combobox-option-plex:55854').click();
  }
  await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 30000 });
}

for (const [surface, viewport] of surfaces) {
  test(`[RELY.9a/10a] ${surface}: primary ownership, truthful Back, and reselect history`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await page.setViewportSize(viewport);
    await page.goto('/media');

    await openDetail(page, surface);
    await expect(primary(page, surface, 'browse')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('detail-back')).toHaveText('← Browse');
    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();

    await openDetail(page, surface);
    await primary(page, surface, 'browse').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();
    await expect(page).toHaveURL(/view=browse/);
    await page.goBack();
    await expect(page.getByTestId('home-view')).toBeVisible();

    await primary(page, surface, 'browse').click();
    await startLocalPlaybackFromBrowse(page, surface);
    await expect(primary(page, surface, 'home')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('now-playing-back')).toHaveText('← Browse');
    await page.getByTestId('now-playing-back').click();
    await expect(page.getByTestId('browse-view')).toBeVisible();

    await primary(page, surface, 'fleet').click();
    const peek = page.locator('[data-testid^="fleet-peek-"]').first();
    await expect(peek, 'a live Fleet remote fixture is required for RELY.9a/10a acceptance').toBeVisible({ timeout: 30000 });
    await peek.click();
    await expect(page.getByTestId('peek-panel')).toBeVisible();
    await expect(primary(page, surface, 'fleet')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('peek-back')).toHaveText('← Devices');
  });
}

test('[RELY.10a] phone: SearchMode consumes one browser Back and sheet Escape keeps it open', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/media');
  await primary(page, 'phone', 'browse').click();
  await expect(page.getByTestId('browse-view')).toBeVisible();
  await page.getByTestId('media-search-launcher').click();
  await expect(page.getByTestId('search-mode')).toBeVisible();
  await page.getByTestId('search-mode-input').fill('Frozen');
  await page.getByTestId('search-mode').getByTestId('destination-line').click();
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('destination-sheet')).toBeHidden();
  await expect(page.getByTestId('search-mode')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('search-mode')).toBeHidden();
  await expect(page.getByTestId('browse-view')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('home-view')).toBeVisible();
});

for (const [surface, viewport] of surfaces) {
  test(`[RELY.10a] ${surface}: depth-one and unknown URLs normalize to Home`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
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
