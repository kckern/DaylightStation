import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/reader/feeds')) return route.fulfill({ json: [] });
    if (path.endsWith('/reader/stream')) return route.fulfill({ json: { items: [], continuation: null } });
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
});

test('Feed leaves an active dialog alone, types a slash in search and adds one history entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/feed/reader');
  const subscriptions = page.getByRole('button', { name: 'Open subscriptions' });
  await subscriptions.click();
  const dialog = page.getByRole('dialog', { name: 'Subscriptions' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('/');
  await expect(dialog).toBeFocused();
  await expect(page).toHaveURL(/\/feed\/reader$/);
  await page.keyboard.press('Escape');
  await expect(subscriptions).toBeFocused();

  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: 'Search feed history' });
  await expect(page).toHaveURL(/\/feed\/search$/);
  await expect(search).toBeFocused();
  await page.keyboard.press('/');
  await expect(search).toHaveValue('/');
  await page.getByRole('main', { name: 'Feed' }).focus();
  await page.keyboard.press('/');
  await page.goBack();
  await expect(page).toHaveURL(/\/feed\/reader$/);
});

for (const width of [390, 1440]) {
  test(`Media opens the search control for ${width}px and types a slash into it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/media');
    await expect(page.getByTestId('media-dock')).toBeVisible();
    const mobile = width === 390;
    const search = mobile
      ? page.getByRole('searchbox', { name: 'Search media', exact: true })
      : page.getByRole('textbox', { name: 'Search media…', exact: true });
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.keyboard.press('/');
    await expect(search).toHaveValue('/');
  });
}

test('Media Start fresh owns Escape before Browse Back and returns focus to Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto('/media');
  await page.getByTestId('app-nav-browse').click();
  await expect(page).toHaveURL(/view=browse/);
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  await page.getByTestId('settings-reset-session').click();
  const dialog = page.getByRole('dialog', { name: 'Start fresh on this device?' });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  await page.keyboard.press('/');
  await expect(cancel).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/view=browse/);
  await expect(settings).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/media$/);
});


async function installMediaSearchResult(page) {
  const item = {
    id: 'plex:43', source: 'plex', title: 'Queued track', itemType: 'leaf',
    metadata: { type: 'track', category: 'work' }, children: [], childCount: 0,
  };
  await page.route('**/api/v1/content/query/search/stream**', route => route.fulfill({
    contentType: 'text/event-stream',
    body: [{ event: 'results', source: 'plex', items: [item], pending: [] }, { event: 'complete' }]
      .map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join(''),
  }));
  return item;
}

test('desktop Media closes results before Back when Escape restores input focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const item = await installMediaSearchResult(page);
  await page.goto('/media');
  const browse = page.getByTestId('app-nav-browse');
  const home = page.getByTestId('app-nav-home');
  await browse.click();
  await expect(browse).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/view=browse/);

  const search = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await search.fill(item.title);
  const results = page.getByRole('listbox');
  const more = page.getByRole('button', { name: 'More actions' });
  const playOn = page.getByRole('menuitem', { name: 'Play on…', exact: true });
  await more.press('Enter');
  await playOn.focus();
  await page.keyboard.press('Escape');
  await expect(playOn).toBeHidden();
  await expect(more).toBeFocused();
  await expect(results).toBeVisible();

  await more.click();
  await playOn.click();
  const picker = page.getByRole('dialog', { name: 'Play on…', exact: true });
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(search).toHaveValue(item.title);
  await expect(results).toBeVisible();

  await more.click();
  const add = page.getByRole('menuitem', { name: 'Add to Queue', exact: true });
  await add.click();
  await expect(add).toBeHidden();
  await expect(results).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(results).toBeHidden();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(item.title);
  await expect(browse).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/media$/);
  await expect(home).toHaveAttribute('aria-current', 'page');
});

test('desktop Media closes slideshow music search and dialog before leaving Now Playing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.addInitScript(() => {
    const photo = { contentId: 'plex:71', title: 'Slideshow photo', format: 'image', duration: 90 };
    const updatedAt = new Date().toISOString();
    localStorage.setItem('media-app.session', JSON.stringify({
      schemaVersion: 1, sessionId: 'fixture', updatedAt, wasPlayingOnUnload: false,
      snapshot: {
        sessionId: 'fixture', state: 'paused', currentItem: photo, position: 0,
        queue: { items: [{ ...photo, queueItemId: 'photo' }], currentIndex: 0, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'fixture', updatedAt },
      },
    }));
  });
  const item = await installMediaSearchResult(page);
  await page.goto('/media?view=fleet');
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page).toHaveURL(/view=nowPlaying/);

  const opener = page.getByTestId('pf-music-add');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Add music behind' });
  const search = dialog.getByRole('textbox', { name: 'Search music…' });
  const result = page.getByTestId(`combobox-option-${item.id}`);
  await search.fill(item.title);
  await expect(result).toBeVisible();
  await dialog.locator('.mantine-Modal-close').click();
  // The dialog can still be fading, but it no longer owns a live picker.
  expect(await page.getByPlaceholder('Search music…').count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/view=fleet/);

  await page.getByTestId('mini-player-open-nowplaying').click();
  await opener.click();
  await expect(search).toHaveValue('');
  await search.fill(item.title);
  await expect(result).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(result).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/view=nowPlaying/);
  await expect(opener).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/view=fleet/);
});

test('phone Media dismisses the item destination picker before Search and preserves Browse history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const item = await installMediaSearchResult(page);
  await page.goto('/media');
  const home = page.getByTestId('app-tab-home');
  const browse = page.getByTestId('app-tab-browse');
  await browse.click();
  await expect(browse).toHaveAttribute('aria-current', 'page');
  const launcher = page.getByTestId('app-tab-search');
  await launcher.press('Enter');
  const search = page.getByRole('searchbox', { name: 'Search media' });
  await search.fill(item.title);
  const more = page.getByRole('button', { name: 'More actions' });
  await expect(more).toBeVisible();
  const close = page.getByRole('button', { name: 'Close search' });
  await search.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(more).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  const playOn = page.getByRole('menuitem', { name: 'Play on…', exact: true });
  await more.press('Enter');
  await expect(playOn).toBeVisible();
  const menu = page.getByRole('menu');
  await playOn.focus();
  await page.keyboard.press('Tab');
  await expect(menu.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(menu.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(playOn).toBeHidden();
  await expect(search).toHaveValue(item.title);

  await more.click();
  await playOn.click();
  const picker = page.getByRole('dialog', { name: 'Play on…', exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(picker.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(picker.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(search).toHaveValue(item.title);
  expect(await page.evaluate(() => history.state.mediaSearchMode)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await expect(launcher).toBeFocused();
  await expect(browse).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => !!history.state.mediaSearchMode)).toBe(false);
  await page.goBack();
  await expect(home).toHaveAttribute('aria-current', 'page');
});
