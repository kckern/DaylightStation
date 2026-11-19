import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

function house(state) {
  const room = { id: 'kitchen', name: 'Kitchen' };
  return {
    entities: [{
      id: 'light.kitchen', domain: 'light', type: 'light', name: 'Kitchen light',
      state, stateClass: state, room, controllable: true, detail: {},
    }],
    rooms: [room], types: [{ id: 'light', label: 'Lights' }],
    summary: { power: { wholeHouse: null }, on: state === 'on' ? ['light.kitchen'] : [], open: [], motion: [], lowBattery: [], unavailable: [] },
  };
}

test('Health opens after the first confirmed context while its background revalidation waits', async ({ page }) => {
  let contextReads = 0;
  await page.route('**/health/context', route => {
    if (++contextReads === 1) return route.fulfill({ json: { userId: 'alice' } });
  });
  await page.goto('/health');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => contextReads).toBe(2);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('daylight-health-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('resources').objectStore('resources').get('api/v1/health/context');
        request.onsuccess = () => resolve(request.result?.value?.userId ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  })).toBe('alice');
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
});

test('Health resets food log display after another tab clears local storage', async ({ page, context }) => {
  test.setTimeout(20_000);
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/health/nutrition/cleanup', route => route.fulfill({ status: 404, json: {} }));
  await page.goto('/health/settings');
  const after = page.getByRole('radio', { name: 'After food name' });
  await after.check();
  await expect(after).toBeChecked();

  const other = await context.newPage();
  await other.route('**/preference-storage-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<title>Storage fixture</title>',
  }));
  await other.goto('/preference-storage-fixture');
  expect(await other.evaluate(() => JSON.parse(localStorage.getItem('health:display:alice')))).toEqual({ densityPlacement: 'after' });
  await other.evaluate(() => localStorage.clear());
  await expect(page.getByRole('radio', { name: 'Before food name' })).toBeChecked();
});

test('Home keeps a confirmed toggle when an older poll finishes', async ({ page }) => {
  let reads = 0;
  let pendingPoll;
  const writes = [];
  await page.route('**/home-dashboard/entities', route => {
    reads++;
    if (reads === 2) {
      pendingPoll = route;
      return;
    }
    return route.fulfill({ json: house(reads === 1 ? 'on' : 'off') });
  });
  await page.route('**/home-dashboard/toggle', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.locator('[data-room-id="kitchen"] .home-room__row').click();
  const light = page.getByRole('switch', { name: 'Kitchen light: turn off' });
  await expect(light).toBeChecked();
  await expect.poll(() => reads, { timeout: 15_000 }).toBe(2);
  // Mantine's visible label activates the visually hidden checkbox.
  await page.locator(`label[for="${await light.getAttribute('id')}"]`).click();
  const switched = page.getByRole('switch', { name: 'Kitchen light: turn on' });
  await expect(switched).toBeEnabled();
  await expect.poll(() => reads).toBe(3);
  await pendingPoll.fulfill({ json: house('on') });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(switched).not.toBeChecked();
  await expect(switched).toBeEnabled();
  expect(writes).toEqual([{ entityId: 'light.kitchen', desiredState: 'off' }]);
});

test('Home Mosaic keeps the tooltip and drawer reachable in its own frame', async ({ page }) => {
  const payload = house('on');
  const group = { id: 'kitchen', label: 'Kitchen', entityIds: ['light.kitchen'] };
  payload.mosaic = { byRoom: [group], byType: [group] };
  await page.route('**/home-dashboard/entities', route => route.fulfill({ json: payload }));
  await page.goto('/home');
  await page.getByRole('button', { name: 'Mosaic', exact: true }).click();
  const square = page.getByRole('main').getByRole('button', { name: 'Kitchen light: On', exact: true });
  await square.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Kitchen light');
  await expect(square).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id'));
  await square.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await square.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Kitchen light', exact: true });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('Health selection restores the frame’s anchoring and keeps the meal control reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/health/day?date=*', route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    return route.fulfill({ json: { items: [{ uuid: 'rice', name: 'Rice', mealTime: 'evening', calories: 120, grams: 100, date }] } });
  });
  await page.goto('/health');
  const main = page.getByRole('main');
  const select = main.getByRole('button', { name: 'Select foods', exact: true });
  await expect(select).toBeVisible();
  await main.evaluate(node => { node.style.overflowAnchor = 'auto'; });
  await select.click();
  const selected = main.getByRole('region', { name: 'Selected foods', exact: true });
  await expect(selected).toBeVisible();
  const done = main.getByRole('button', { name: 'Done selecting', exact: true });
  await done.click();
  await expect(selected).toHaveCount(0);
  await expect(select).toBeFocused();
  await expect(select).toBeInViewport();
  await expect.poll(() => main.evaluate(node => node.style.overflowAnchor)).toBe('auto');
});

test('Health activates one coach shortcut across tab and household changes', async ({ page }) => {
  let owner = 'alice';
  const contextReads = [];
  await page.route('**/health/context', route => {
    contextReads.push(owner);
    return route.fulfill({ json: { userId: owner } });
  });
  await page.addInitScript(() => {
    window.coachMatches = 0;
    const preventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (this.type === 'keydown' && this.key === 'k' && this.ctrlKey) window.coachMatches++;
      return preventDefault.call(this);
    };
  });
  const navigate = path => page.evaluate(path => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  const shortcutMatches = () => page.evaluate(() => {
    document.activeElement.blur();
    window.coachMatches = 0;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    return window.coachMatches;
  });
  await page.goto('/home');
  for (const nextOwner of ['alice', 'bob', 'alice']) {
    owner = nextOwner;
    const readsBefore = contextReads.length;
    await navigate('/health');
    await expect.poll(() => contextReads.slice(readsBefore)).toContain(nextOwner);
    for (const name of ['Progress', 'Medical', 'Progress', 'Coach']) {
      const tab = page.getByRole('link', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-current', 'page');
    }
    expect(await shortcutMatches()).toBe(1);
    await navigate('/home');
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible();
    expect(await shortcutMatches()).toBe(0);
  }
});

test('Health Coach yields Mod+K to its composer and restores the shortcut opener', async ({ page }) => {
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.goto('/health/coach');
  const main = page.getByRole('main');
  const composer = main.getByPlaceholder(/^Ask…/);
  const coach = page.getByRole('dialog', { name: 'Health Coach', exact: true });
  await composer.focus();
  await page.keyboard.press('Control+k');
  await expect(composer).toBeFocused();
  await expect(coach).toHaveCount(0);

  const opener = page.getByRole('link', { name: 'Coach', exact: true });
  await opener.focus();
  await page.keyboard.press('Control+k');
  await expect(coach).toBeVisible();
  const close = coach.getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Control+k');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(coach).toHaveCount(0);
  await expect(opener).toBeFocused();
});
