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
