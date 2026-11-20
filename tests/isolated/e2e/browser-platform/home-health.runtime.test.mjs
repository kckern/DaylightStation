import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

test('Health closes metric suggestions before dismissing the reading sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/medical', route => route.fulfill({ json: { metrics: [] } }));
  await page.goto('/health/medical');
  const opener = page.getByRole('button', { name: 'Add reading', exact: true });
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'Add reading', exact: true });
  const metric = sheet.getByLabel('Metric', { exact: true });
  const note = sheet.getByRole('textbox', { name: 'Note' });
  await note.fill('Draft note');
  await metric.fill('glu');
  const suggestion = page.locator('[role="listbox"]').getByText('glucose', { exact: true });
  await expect(suggestion).toBeVisible();
  await metric.press('Escape');
  await expect(suggestion).toBeHidden();
  await expect(note).toHaveValue('Draft note');
  await expect(metric).toBeFocused();

  await metric.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Health focuses the custom food name and returns to the barcode launcher', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/day?**', route => route.fulfill({
    json: { items: [], budget: { budget: 2000, remaining: 2000 } },
  }));
  await page.route('**/api/v1/health/nutrition/input', route => route.fulfill({
    json: { unknownUpc: true, upc: '012345678905' },
  }));

  await page.goto('/health');
  const opener = page.getByRole('button', { name: 'Scan barcode to Breakfast', exact: true });
  await opener.press('Enter');
  const scanner = page.getByRole('dialog', { name: 'Scan barcode' });
  await scanner.getByRole('textbox', { name: 'Manual UPC entry' }).fill('012345678905');
  await scanner.getByRole('button', { name: 'Look up' }).press('Enter');

  const form = page.getByRole('dialog', { name: 'New food' });
  const name = form.getByRole('textbox', { name: 'Name', exact: true });
  await expect(scanner).toBeHidden();
  await expect(name).toBeFocused();
  await name.press('Escape');
  await expect(form).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const size of [{ width: 390, height: 850 }, { width: 844, height: 390 }]) {
  test(`Health barcode controls stay inside the safe area and keyboard viewport at ${size.width}px`, async ({ page }) => {
    const insets = { top: 30, right: 27, bottom: 24, left: 40 };
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => { throw new DOMException('Fixture denies the camera', 'NotAllowedError'); },
      });
    });
    await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
    await page.route('**/api/v1/health/day?**', route => route.fulfill({
      json: { items: [], budget: { budget: 2000, remaining: 2000 } },
    }));
    await page.goto('/health');
    await page.evaluate(edges => {
      for (const [edge, pixels] of Object.entries(edges)) {
        document.documentElement.style.setProperty(`--browser-safe-area-${edge}`, `${pixels}px`);
      }
    }, insets);
    const ownerOverflow = () => page.getByRole('main').evaluate(main => [
      document.body.style.overflow, getComputedStyle(main).overflowY,
    ]);
    const opener = page.getByRole('button', { name: 'Scan barcode to Breakfast', exact: true });
    const restingOverflow = ['', 'auto'];
    await expect.poll(ownerOverflow).toEqual(restingOverflow);
    await opener.press('Enter');
    const scanner = page.getByRole('dialog', { name: 'Scan barcode' });
    const field = scanner.getByRole('textbox', { name: 'Manual UPC entry' });
    const lookup = scanner.getByRole('button', { name: 'Look up' });
    const close = scanner.getByRole('button', { name: 'Close' });
    await expect(scanner.getByText(/Camera unavailable/)).toBeVisible();
    await expect.poll(ownerOverflow).toEqual(['hidden', 'hidden']);
    const stageBounds = () => scanner.locator('.ds-sheet__panel').evaluate(panel => {
      const { x, y, width, height } = panel.getBoundingClientRect();
      return [x, y, width, height];
    });
    await expect.poll(stageBounds).toEqual([0, 0, size.width, size.height]);
    await expect.poll(() => field.evaluate(element => parseFloat(getComputedStyle(element).fontSize)))
      .toBeGreaterThanOrEqual(16);
    const expectControlsInside = async (top, bottom) => {
      for (const control of [close, field, lookup]) {
        await expect.poll(() => control.evaluate((element, edges) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.left >= edges.left && box.right <= innerWidth - edges.right
            && box.top >= edges.top && box.bottom <= edges.bottom && element.contains(hit);
        }, { ...insets, top, bottom })).toBe(true);
      }
    };
    await field.fill('012345678905');
    await expectControlsInside(insets.top, size.height - insets.bottom);
    const keyboard = { width: size.width, height: size.height - 180, offsetTop: 42, scale: 1 };
    const setVisualViewport = values => page.evaluate(viewportValues => {
      const viewport = window.visualViewport;
      for (const [key, value] of Object.entries(viewportValues)) {
        Object.defineProperty(viewport, key, { configurable: true, value });
      }
      viewport.dispatchEvent(new Event('resize'));
    }, values);
    await setVisualViewport(keyboard);
    await expect.poll(stageBounds).toEqual([0, keyboard.offsetTop, size.width, keyboard.height]);
    await expectControlsInside(keyboard.offsetTop, keyboard.offsetTop + keyboard.height - insets.bottom);
    await lookup.click({ trial: true });
    await field.press('Escape');
    await expect(scanner).toBeHidden();
    await expect(opener).toBeFocused();
    await expect.poll(ownerOverflow).toEqual(restingOverflow);
  });
}

test('Health returns focus to the day input after cancelling a clarification', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/day?**', route => route.fulfill({
    json: { items: [], budget: { budget: 2000, remaining: 2000 } },
  }));
  await page.route('**/api/v1/health/nutrition/day-input', route => route.fulfill({ json: {
    committed: false,
    outcome: 'clarification',
    instructionText: 'move it',
    clarification: {
      kind: 'food', question: 'Which food did you mean?',
      choices: [{ id: 'tea', label: 'Tea' }],
    },
  } }));

  await page.goto('/health');
  const field = page.getByRole('textbox', { name: 'Log food or change this day' });
  await field.fill('move it');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Tea', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('move it');
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

test.describe('Home room detail on a coarse pointer', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 850 } });

  test('Home opens entity detail from the full row without triggering the adjacent switch', async ({ page }) => {
    const writes = [];
    await page.route('**/home-dashboard/entities', route => route.fulfill({ json: house('on') }));
    await page.route('**/home-dashboard/toggle', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/home');
    await page.getByRole('button', { name: 'Rooms', exact: true }).tap();
    await page.getByRole('button', { name: 'Kitchen 1 on', exact: true }).tap();
    const row = page.getByRole('main').locator('[data-entity-id="light.kitchen"]');
    const opener = row.getByRole('button', { name: 'Kitchen light, On', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Kitchen light', exact: true });
    await expect(opener).toBeVisible();
    const openerBox = await opener.boundingBox();
    const rowBox = await row.boundingBox();
    expect.soft(openerBox.height).toBeGreaterThanOrEqual(44);
    const edgeHitsOpener = await opener.evaluate((button, point) =>
      button.contains(document.elementFromPoint(point.x, point.y)), { x: rowBox.x + 10, y: rowBox.y + rowBox.height - 2 });
    expect.soft(edgeHitsOpener).toBe(true);
    await row.tap({ position: { x: 10, y: rowBox.height - 2 } });
    await expect(dialog).toBeVisible({ timeout: 2500 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await opener.press('Enter');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect(row.getByRole('switch')).toBeChecked();
    expect(writes).toEqual([]);
  });
});

for (const fromDetail of [false, true]) {
  test(`Home keeps a pending switch focused in ${fromDetail ? 'the entity sheet' : 'Rooms'}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    const acknowledgement = Promise.withResolvers();
    const writes = [];
    let deviceState = 'on';
    await page.route('**/home-dashboard/entities', route => route.fulfill({ json: house(deviceState) }));
    await page.route('**/home-dashboard/toggle', async route => {
      writes.push(route.request().postDataJSON());
      await acknowledgement.promise;
      deviceState = 'off';
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/home');
    await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.getByRole('button', { name: 'Kitchen 1 on', exact: true }).click();
    const opener = page.getByRole('button', { name: 'Kitchen light, On', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Kitchen light', exact: true });
    if (fromDetail) await opener.press('Enter');
    const scope = fromDetail ? dialog : page.getByRole('main');
    const control = scope.getByRole('switch', { name: /Kitchen light:/ });
    await expect(control).toBeChecked();
    if (fromDetail) {
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
    } else {
      await control.focus();
    }
    await expect(control).toBeFocused();

    try {
      await page.keyboard.press('Space');
      await expect(control).not.toBeChecked();
      await expect(control).toBeFocused();
      await expect(control).toBeDisabled();
      await page.keyboard.press('Space');
      await expect(control).not.toBeChecked();
      expect(writes).toEqual([{ entityId: 'light.kitchen', desiredState: 'off' }]);
    } finally {
      acknowledgement.resolve();
    }
    await expect(control).toBeEnabled();
    await expect(control).toBeFocused();
    if (fromDetail) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('button', { name: 'Kitchen light, Off', exact: true })).toBeFocused();
    }
  });
}

async function healthCacheValue(page, path) {
  return page.evaluate(async path => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('daylight-health-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('resources').objectStore('resources').get(path);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, path);
}

test('Health preserves the first confirmed shell and draft while its background revalidation waits', async ({ page }) => {
  const draft = 'Food draft entered as soon as Today appears';
  await page.addInitScript(draft => {
    const selector = 'input[aria-label="Log food or change this day"]';
    const observer = new MutationObserver(() => {
      const field = document.querySelector(selector);
      if (!field) return;
      observer.disconnect();
      window.firstHealthDraftField = field;
      field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, draft);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      window.firstHealthDraft = field.value;
    });
    observer.observe(document, { childList: true, subtree: true });
  }, draft);
  let contextReads = 0;
  let warmContextRoute;
  await page.route('**/health/context', route => {
    if (++contextReads === 1) return route.fulfill({ json: { userId: 'alice' } });
    if (contextReads === 3) warmContextRoute = route;
  });
  await page.goto('/health');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => contextReads).toBe(2);
  const field = page.getByRole('textbox', { name: 'Log food or change this day' });
  expect(await field.evaluate(input => ({
    sameField: input === window.firstHealthDraftField,
    firstDraft: window.firstHealthDraft,
    currentDraft: input.value,
    focused: input === document.activeElement,
  }))).toEqual({ sameField: true, firstDraft: draft, currentDraft: draft, focused: true });
  await expect.poll(() => healthCacheValue(page, 'api/v1/health/context')).toMatchObject({ userId: 'alice' });
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
  await expect.poll(() => contextReads).toBe(3);
  await warmContextRoute.fulfill({ json: { userId: 'alice', densityRevision: 'fixture-r2' } });
  await expect.poll(() => healthCacheValue(page, 'api/v1/health/context'))
    .toMatchObject({ userId: 'alice', densityRevision: 'fixture-r2' });
  expect(contextReads).toBe(3);
});

test('Health drops the warm food and draft when a different owner is confirmed', async ({ page }) => {
  const date = '2026-11-16';
  const url = `/health?date=${date}`;
  const dayPath = `api/v1/health/day?date=${date}`;
  const contextReady = Promise.withResolvers();
  const aliceDayHeld = Promise.withResolvers();
  const aliceDayReady = Promise.withResolvers();
  const bobDayHeld = Promise.withResolvers();
  const bobDayReady = Promise.withResolvers();
  let warm = false;
  let owner = 'alice';
  let warmContextReads = 0;
  await page.route('**/health/context', async route => {
    if (warm && ++warmContextReads === 1) {
      await contextReady.promise;
      owner = 'bob';
    }
    return route.fulfill({ json: { userId: owner } });
  });
  await page.route(`**/${dayPath}`, async route => {
    const requestOwner = owner;
    if (warm) {
      if (requestOwner === 'alice') {
        aliceDayHeld.resolve();
        await aliceDayReady.promise;
      } else {
        bobDayHeld.resolve();
        await bobDayReady.promise;
      }
    }
    const row = { uuid: `${requestOwner}-fixture`, name: `${requestOwner} breakfast fixture`, mealTime: 'morning', date, calories: 120, grams: 100 };
    return route.fulfill({ json: { date, items: [row], budget: { budget: 2000, remaining: 1880 } }, headers: { 'x-fixture-owner': requestOwner } });
  });
  const aliceFood = page.getByText('alice breakfast fixture', { exact: true });
  const bobFood = page.getByText('bob breakfast fixture', { exact: true });
  const field = page.getByRole('textbox', { name: 'Log food or change this day' });
  try {
    await page.goto(url);
    await expect(aliceFood).toBeVisible();
    await expect.poll(() => healthCacheValue(page, dayPath)).toMatchObject({ items: [{ uuid: 'alice-fixture' }] });
    warm = true;
    await page.reload();
    await aliceDayHeld.promise;
    await expect(aliceFood).toBeVisible();
    await field.fill('Alice draft');

    contextReady.resolve();
    await bobDayHeld.promise;
    await expect(aliceFood).toHaveCount(0);
    await expect(field).toHaveValue('');
    bobDayReady.resolve();
    await expect(bobFood).toBeVisible();

    const lateAlice = page.waitForResponse(response => response.url().endsWith(dayPath) && response.headers()['x-fixture-owner'] === 'alice');
    aliceDayReady.resolve();
    await lateAlice;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(bobFood).toBeVisible();
    await expect(aliceFood).toHaveCount(0);
    expect(warmContextReads).toBe(2);
  } finally {
    contextReady.resolve();
    aliceDayReady.resolve();
    bobDayReady.resolve();
  }
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
  const before = page.getByRole('radio', { name: 'Before food name' });
  await expect(before).toBeChecked();

  await page.evaluate(async () => {
    // Deliver the previous value after the native cross-tab clear.
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'health:display:alice', storageArea: localStorage,
      newValue: JSON.stringify({ densityPlacement: 'after' }),
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(before).toBeChecked({ timeout: 4_000 });
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

test('Home preserves a pending toggle across a camera visit and pauses house reads', async ({ page }) => {
  await page.clock.install();
  let reads = 0;
  let pendingToggle;
  const writes = [];
  let lightState = 'on';
  await page.route('**/home-dashboard/entities', route => {
    reads += 1;
    return route.fulfill({ json: house(lightState) });
  });
  await page.route('**/home-dashboard/toggle', route => {
    writes.push(route.request().postDataJSON());
    pendingToggle = route;
  });
  await page.route('**/api/v1/camera', route => route.fulfill({ json: { cameras: [] } }));
  await page.goto('/home');
  const rooms = page.getByRole('button', { name: 'Rooms', exact: true });
  const cameras = page.getByRole('button', { name: 'Cameras', exact: true });
  const kitchen = page.locator('[data-room-id="kitchen"] .home-room__row');
  const openKitchen = async () => {
    await rooms.click();
    await kitchen.click();
  };
  await openKitchen();
  const light = page.getByRole('switch', { name: 'Kitchen light: turn off' });
  await page.locator(`label[for="${await light.getAttribute('id')}"]`).click();
  await expect.poll(() => writes.length).toBe(1);

  await cameras.click();
  await expect(page.getByText('No cameras configured')).toBeVisible();
  await openKitchen();
  const pending = page.getByRole('switch', { name: 'Kitchen light: turn on' });
  await expect(pending).toBeDisabled();
  await expect(pending).not.toBeChecked();
  await expect.poll(() => reads).toBe(2);

  await cameras.click();
  await expect(page.getByText('No cameras configured')).toBeVisible();
  await page.clock.fastForward(11_000);
  expect(reads).toBe(2);
  lightState = 'off';
  const response = page.waitForResponse(result => result.request() === pendingToggle.request());
  await pendingToggle.fulfill({ json: { ok: true } });
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(reads).toBe(2);
  await openKitchen();
  await expect(pending).toBeEnabled();
  await expect(pending).not.toBeChecked();
  await expect.poll(() => reads).toBe(3);
  expect(writes).toEqual([{ entityId: 'light.kitchen', desiredState: 'off' }]);
});

for (const width of [390, 1440]) {
  test(`Home restores Rooms and Cameras scroll independently at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() => localStorage.setItem('home.view', 'rooms'));
    const rooms = Array.from({ length: 32 }, (_, index) => ({ id: `room-${index}`, name: `Room ${index}` }));
    const device = house('off');
    await page.route('**/home-dashboard/entities', route => route.fulfill({ json: {
      ...device,
      rooms,
      entities: rooms.map(room => ({ ...device.entities[0], id: `light.${room.id}`, room })),
    } }));
    const cameraList = { cameras: Array.from({ length: 12 }, (_, index) => ({ id: `yard-${index}` })) };
    let reads = 0;
    let pendingCameras;
    await page.route('**/api/v1/camera', route => {
      if (++reads === 1) return route.fulfill({ json: cameraList });
      pendingCameras = route;
    });

    const main = page.getByRole('main');
    const tab = name => page.getByRole('button', { name, exact: true });
    const scrollPosition = () => main.evaluate(node => node.scrollTop);
    const expectScroll = top => expect.poll(async () => Math.abs(await scrollPosition() - top)).toBeLessThanOrEqual(1);
    const scrollTo = async top => {
      await main.evaluate((node, position) => { node.scrollTop = position; }, top);
      await expectScroll(top);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const room = main.getByRole('button', { name: 'Room 0', exact: true });
    const camera = main.getByRole('button', { name: 'Fullscreen yard-0', exact: true });

    await page.goto('/home');
    await expect(room).toBeVisible();
    if (width === 1440) {
      // Revisiting this route mounts its Rooms content from the in-memory read.
      await navigateWithHistory(page, '/auto');
      await expect(page.getByRole('heading', { name: 'Garage', exact: true })).toBeVisible();
      await navigateWithHistory(page, '/home');
      await expect(room).toBeVisible();
    }
    await scrollTo(510);
    expect(reads).toBe(0);

    await tab('Cameras').click();
    await expect(camera).toBeVisible();
    await expectScroll(0);
    await scrollTo(280);
    await tab('Rooms').click();
    await expect(room).toBeVisible();
    await expectScroll(510);
    expect(reads).toBe(1);

    await tab('Cameras').click();
    await expect(main.getByLabel('Loading cameras')).toBeVisible();
    await expect.poll(() => Boolean(pendingCameras)).toBe(true);
    await pendingCameras.fulfill({ json: cameraList });
    await expect(camera).toBeVisible();
    await expectScroll(280);
    expect(reads).toBe(2);
  });
}

test('Home lets slow initial and periodic house reads finish across polling ticks', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem('home.view', 'rooms'));
  const reads = [];
  await page.route('**/home-dashboard/entities', route => { reads.push(route); });
  await page.goto('/home');
  await expect.poll(() => reads.length).toBe(1);
  await page.clock.fastForward(10_001);
  await page.clock.fastForward(10_001);
  await reads[0].fulfill({ json: house('on') });

  await page.locator('[data-room-id="kitchen"] .home-room__row').click();
  await expect(page.getByRole('switch', { name: 'Kitchen light: turn off' })).toBeChecked();
  expect(reads).toHaveLength(1);

  await page.clock.fastForward(10_001);
  await expect.poll(() => reads.length).toBe(2);
  await page.clock.fastForward(10_001);
  await page.clock.fastForward(10_001);
  await reads[1].fulfill({ json: house('off') });
  await expect(page.getByRole('switch', { name: 'Kitchen light: turn on' })).not.toBeChecked();
  expect(reads).toHaveLength(2);
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

test.describe('Home Mosaic mixed input', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 850 } });

  test.beforeEach(async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    await page.context().route('**/*', route => (
      new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
    ));
    const payload = house('on');
    const kitchen = payload.entities[0];
    payload.entities.push(
      { ...kitchen, id: 'light.hall', name: 'Hall light' },
      ...Array.from({ length: 8 }, (_, index) => ({
        ...kitchen, id: 'light.fixture_' + index, name: 'Fixture light ' + index,
      })),
    );
    const group = { id: 'kitchen', label: 'Kitchen', entityIds: payload.entities.map(entity => entity.id) };
    payload.mosaic = { byRoom: [group], byType: [group] };
    await page.route('**/home-dashboard/entities', route => route.fulfill({ json: payload }));
    // Keep pointer and keyboard activations in the same compatibility-event window.
    await page.clock.setFixedTime(new Date('2026-11-22T19:00:00Z'));
    await page.goto('/home');
    await page.getByRole('button', { name: 'Mosaic', exact: true }).tap();
  });

  test('Home Mosaic keeps wrapped touch targets distinct and activates their edges', async ({ page }) => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const group = page.getByRole('region', { name: 'Kitchen', exact: true });
    const squares = group.getByRole('button');
    await expect(squares).toHaveCount(10);
    const bounds = await squares.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    const groupBounds = await group.boundingBox();
    expect(bounds.at(-1).y).toBeGreaterThan(bounds[0].y);
    for (const [index, rect] of bounds.entries()) {
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.x + rect.width).toBeLessThanOrEqual(groupBounds.x + groupBounds.width);
      const next = bounds[index + 1];
      if (next?.y === rect.y) expect(rect.x + rect.width).toBeLessThan(next.x);
    }

    const [kitchen, hall] = bounds;
    const tapHallEdge = () => page.touchscreen.tap(hall.x + 2, hall.y + 22);
    await page.touchscreen.tap(kitchen.x + 42, kitchen.y + 22);
    await expect(page.getByRole('tooltip')).toContainText('Kitchen light');
    await tapHallEdge();
    await expect(page.getByRole('tooltip')).toContainText('Hall light');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await tapHallEdge();
    const details = page.getByRole('dialog', { name: 'Hall light', exact: true });
    await expect(details).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(group.getByRole('button', { name: 'Hall light: On', exact: true })).toBeFocused();
  });

  for (const activation of ['Enter', 'Space', 'mouse']) {
    test(`Home Mosaic opens another device by ${activation} immediately after a touch tooltip`, async ({ page }) => {
      const kitchen = page.getByRole('button', { name: 'Kitchen light: On', exact: true });
      const hall = page.getByRole('button', { name: 'Hall light: On', exact: true });

      await kitchen.tap();
      await expect(page.getByRole('tooltip')).toContainText('Kitchen light');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (activation === 'mouse') await hall.click();
      else await hall.press(activation);
      const hallDetails = page.getByRole('dialog', { name: 'Hall light', exact: true });
      await expect(hallDetails.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(hallDetails).toBeHidden();
      await expect(hall).toBeFocused();
    });
  }
});

test.describe('Home phone history choices', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 850 } });

  test('supports an edge tap and native radio keyboard selection', async ({ page }) => {
    await page.route('**/home-dashboard/entities', route => route.fulfill({ json: house('on') }));
    const ranges = [];
    await page.route('**/home-dashboard/entities/light.kitchen/history?range=*', route => {
      const range = new URL(route.request().url()).searchParams.get('range');
      ranges.push(range);
      return route.fulfill({ json: { range, kind: 'state', hasData: false } });
    });
    await page.goto('/home');
    await page.getByRole('button', { name: 'Rooms', exact: true }).tap();
    await page.getByRole('button', { name: 'Kitchen 1 on', exact: true }).tap();
    const opener = page.getByRole('button', { name: 'Kitchen light, On', exact: true });
    await opener.press('Enter');
    const detail = page.getByRole('dialog', { name: 'Kitchen light' });
    const choices = detail.getByRole('radiogroup', { name: 'History range' });
    const day = choices.getByRole('radio', { name: '24 h', exact: true });
    const week = choices.getByRole('radio', { name: '7 d', exact: true });
    await expect(day).toBeChecked();
    for (const label of await choices.locator('label').all()) {
      const { width, height } = await label.boundingBox();
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    const weekTarget = choices.locator('label').filter({ hasText: /^7 d$/ });
    await weekTarget.tap({ position: { x: 2, y: 22 } });
    await expect(week).toBeChecked();
    await expect.poll(() => ranges).toEqual(['24h', '7d']);
    await week.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(day).toBeChecked();
    await expect(day).toBeFocused();
    await expect.poll(() => ranges).toEqual(['24h', '7d', '24h']);
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test('Home keeps the rendered history chart during a failed refresh and retries the same range', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/home-dashboard/entities', route => route.fulfill({ json: house('on') }));
  const reads = [];
  let pendingRefresh;
  await page.route('**/home-dashboard/entities/light.kitchen/history?range=*', route => {
    const range = new URL(route.request().url()).searchParams.get('range');
    reads.push(range);
    if (reads.length === 3) {
      pendingRefresh = route;
      return;
    }
    return route.fulfill({ json: {
      entityId: 'light.kitchen', range, kind: 'state', hasData: true,
      sinceIso: range === '7d' ? '2026-11-11T00:00:00Z' : '2026-11-17T00:00:00Z',
      endIso: '2026-11-18T00:00:00Z',
      intervals: [{ from: Date.parse('2026-11-17T05:00:00Z'), to: Date.parse('2026-11-17T08:00:00Z') }],
    } });
  });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Kitchen 1 on', exact: true }).click();
  await page.getByRole('button', { name: 'Kitchen light, On', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Kitchen light' }).getByRole('region', { name: 'History' });
  const rangeLabel = history.getByRole('radiogroup', { name: 'History range' }).locator('label').first();
  expect((await rangeLabel.boundingBox()).height).toBeLessThan(44);
  const chart = history.locator('svg.highcharts-root');
  await expect(chart).toBeVisible();
  await history.getByText('7 d', { exact: true }).click();
  await expect(chart).toBeVisible();
  await expect.poll(() => reads).toEqual(['24h', '7d']);
  await history.getByText('24 h', { exact: true }).click();
  await expect.poll(() => reads).toEqual(['24h', '7d', '24h']);
  await expect(chart).toBeVisible();

  await pendingRefresh.fulfill({ status: 500, json: { error: 'Unavailable' } });
  const alert = history.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(chart).toBeVisible();
  await expect(alert).toContainText('History could not refresh');
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => reads).toEqual(['24h', '7d', '24h', '24h']);
  await expect(alert).toHaveCount(0);
  await expect(chart).toBeVisible();
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
    await expect(page.getByRole('main').getByText('No timeline lanes', { exact: true })).toBeVisible();
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

test('Health Coach restores its tab transcript when local thread writes are unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key.startsWith('daylight-station:agent-thread:')) {
        throw new DOMException('Fixture storage quota', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  });
  const requests = [];
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'fixture' } }));
  await page.route('**/agents/health-coach/run-stream', route => {
    requests.push(route.request().postDataJSON());
    const event = { type: 'text-delta', text: requests.length === 1 ? 'First fixture answer' : 'Second fixture answer' };
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(event)}\n\ndata: {"type":"done"}\n\n` });
  });
  const composer = page.getByRole('main').getByPlaceholder(/^Ask…/);
  const send = async prompt => {
    await composer.fill(prompt);
    await page.getByRole('main').getByRole('button', { name: 'Send message' }).click();
  };

  await page.goto('/health/coach');
  await send('Review my fixture');
  await expect(page.getByText('First fixture answer', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.stringify(Object.values(sessionStorage)))).toContain('First fixture answer');
  await page.reload();
  await expect(page.getByText('First fixture answer', { exact: true })).toBeVisible();
  await send('Continue that fixture');
  await expect(page.getByText('Second fixture answer', { exact: true })).toBeVisible();
  expect(requests.map(request => request.threadId)).toEqual([null, null]);
  expect(requests[1].messages).toContainEqual({ role: 'assistant', content: 'First fixture answer' });
});

const healthStatusDate = '2026-09-24';
const healthStatusPath = `/health?date=${healthStatusDate}`;
const openDayStatus = { today: healthStatusDate, status: null, minCalories: 1800, fastedMeals: [] };

const dayClose = {
  name: 'day-close',
  endpoint: '**/health/nutrition/day-status',
  before: 'Close day. Close this day',
  after: 'Logging done. Change',
  click: async page => {
    await page.getByRole('button', { name: 'Close day. Close this day', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Done logging', exact: true }).click();
  },
  body: { date: healthStatusDate, status: 'done' },
  result: { ...openDayStatus, status: 'done' },
};
const mealSkip = {
  name: 'meal-skip',
  endpoint: '**/health/nutrition/meal-fast',
  before: "Skipped Breakfast — didn't eat anything",
  after: 'Undo skipped Breakfast',
  click: page => page.getByRole('button', { name: "Skipped Breakfast — didn't eat anything", exact: true }).click(),
  body: { date: healthStatusDate, meal: 'morning', fasted: true },
  result: { ...openDayStatus, fastedMeals: ['morning'] },
};

async function finishHealthWrite(page, route, json) {
  const received = page.waitForResponse(response => response.request() === route.request());
  await route.fulfill({ json });
  expect(await (await received).finished()).toBeNull();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const navigateWithHistory = (page, path) => page.evaluate(path => {
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, path);

async function holdHealthStatusWrite(page, action) {
  let owner = 'alice';
  let holdDayReads = false;
  const heldReads = [];
  const writes = [];
  await page.route('**/health/context', route => route.fulfill({ json: { userId: owner } }));
  await page.route('**/health/day?date=*', route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    const json = {
      items: [{ uuid: owner, mealTime: 'evening', name: `${owner} dinner`, grams: 100, calories: 100, date }],
      budget: { budget: 2000, food: 100, remaining: 1900, exercise: 0, macros: {}, sessions: [] },
      dayStatus: openDayStatus,
    };
    if (date === healthStatusDate && holdDayReads) {
      heldReads.push({ route, json });
      return;
    }
    return route.fulfill({ json });
  });
  await page.route(action.endpoint, route => { writes.push({ owner, route }); });

  await page.goto(healthStatusPath);
  await expect(page.getByRole('button', { name: 'Edit alice dinner', exact: true })).toBeVisible();
  await action.click(page);
  await expect.poll(() => writes.length).toBe(1);

  return {
    switchToBob() { owner = 'bob'; },
    async resumeReads() {
      holdDayReads = false;
      await Promise.all(heldReads.splice(0).map(({ route, json }) => route.fulfill({ json })));
    },
    async finish() {
      // Keep a refetch from masking a stale response patch before we inspect it.
      holdDayReads = true;
      await finishHealthWrite(page, writes[0].route, action.result);
      expect(writes.map(({ owner, route }) => [owner, route.request().method(), route.request().postDataJSON()]))
        .toEqual([['alice', 'POST', action.body]]);
    },
  };
}

for (const action of [dayClose, mealSkip]) {
  test(`Health keeps a late ${action.name} response out of a different user's same date`, async ({ page }) => {
    const write = await holdHealthStatusWrite(page, action);
    await navigateWithHistory(page, '/home');
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible();
    write.switchToBob();
    await navigateWithHistory(page, healthStatusPath);
    const bobDinner = page.getByRole('button', { name: 'Edit bob dinner', exact: true });
    const unchanged = page.getByRole('button', { name: action.before, exact: true });
    await expect(bobDinner).toBeVisible();
    await expect(unchanged).toBeVisible();

    await write.finish();
    const changed = page.getByRole('button', { name: action.after, exact: true });
    expect(await changed.count(), `Bob must not show "${action.after}" after Alice's response`).toBe(0);
    await write.resumeReads();
    await expect(unchanged).toBeVisible();
    await expect(bobDinner).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit alice dinner', exact: true })).toHaveCount(0);
  });
}

test('Health applies a pending day-close response across tabs for the same user', async ({ page }) => {
  const write = await holdHealthStatusWrite(page, dayClose);
  const progress = page.getByRole('link', { name: 'Progress', exact: true });
  await progress.click();
  await expect(progress).toHaveAttribute('aria-current', 'page');

  await write.finish();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('button', { name: dayClose.after, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit alice dinner', exact: true })).toBeVisible();
});

test('Health keeps a late auditor settings response out of a different user’s settings', async ({ page }) => {
  const auditorPath = '/health/auditor';
  const cleanupStatus = (settingsVersion, enabled, telegram) => ({
    settingsVersion, settings: { enabled, telegram, dryRun: false, dailyCapUsd: null },
    options: { minGapMinutes: [0] }, questions: [], runs: [],
  });
  const alice = cleanupStatus(3, false, false);
  const bob = cleanupStatus(7, false, true);
  let owner = 'alice';
  let holdReads = false;
  const heldReads = [];
  const writes = [];

  await page.route('**/health/context', route => route.fulfill({ json: { userId: owner } }));
  await page.route('**/health/nutrition/cleanup', route => {
    if (holdReads) {
      heldReads.push(route);
      return;
    }
    return route.fulfill({ json: owner === 'alice' ? alice : bob });
  });
  await page.route('**/health/nutrition/cleanup/journal**', route => route.fulfill({ json: { rows: [], total: 0 } }));
  await page.route('**/health/nutrition/cleanup/history**', route => route.fulfill({ json: { records: [], total: 0 } }));
  await page.route('**/health/nutrition/cleanup/settings', route => { writes.push({ owner, route }); });

  await page.goto(auditorPath);
  const automatic = page.getByLabel('Automatic cleanup', { exact: true });
  const telegram = page.getByLabel('Also show questions in Telegram', { exact: true });
  await expect(automatic).not.toBeChecked();
  await expect(telegram).not.toBeChecked();
  await page.getByText('Automatic cleanup', { exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);

  await navigateWithHistory(page, '/home');
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible();
  owner = 'bob';
  await navigateWithHistory(page, auditorPath);
  await expect(telegram).toBeChecked();
  await expect(automatic).not.toBeChecked();

  holdReads = true;
  await finishHealthWrite(page, writes[0].route, cleanupStatus(4, true, false));
  expect(await automatic.isChecked(), 'Bob’s Automatic cleanup setting changed after Alice’s response').toBe(false);
  expect(await telegram.isChecked(), 'Bob’s Telegram setting changed after Alice’s response').toBe(true);
  holdReads = false;
  await Promise.all(heldReads.map(route => route.fulfill({ json: bob })));
  expect(writes.map(({ owner, route }) => [owner, route.request().method(), route.request().postDataJSON()]))
    .toEqual([['alice', 'PATCH', { expectedSettingsVersion: 3, enabled: true }]]);
});

const cleanupEndpoint = '/api/v1/health/nutrition/cleanup';
const runAt = '2026-09-25T15:42:00.000Z';

function mockHealthVisibility(page) {
  return page.addInitScript(() => {
    window.healthFixtureVisible = true;
    Object.defineProperty(document, 'visibilityState', {
      get: () => window.healthFixtureVisible ? 'visible' : 'hidden',
    });
  });
}

function foregroundHealth(page) {
  return page.evaluate(() => {
    window.healthFixtureVisible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.healthFixtureVisible = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

for (const inactive of ['another route', 'a hidden document']) {
  test(`Health stops starting neighbouring-day reads in ${inactive}`, async ({ page }) => {
    await mockHealthVisibility(page);
    const date = '2026-10-20';
    const adjacent = new Set([
      '/api/v1/health/day', '/api/v1/health/nutrition/pending', '/api/v1/health/nutrition/observations',
    ]);
    const speculativeReads = [];
    let returning = false;
    await page.route('**/api/v1/health/**', route => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (pathname.endsWith('/context')) return route.fulfill({ json: { userId: 'alice' } });
      const requestedDate = searchParams.get('date');
      if (requestedDate && requestedDate !== date && adjacent.has(pathname)) {
        speculativeReads.push(route);
        if (!returning) return;
      }
      return route.fulfill({ json: { items: [], budget: { budget: 2000, remaining: 2000 } } });
    });

    const setVisible = visible => page.evaluate(visible => {
      window.healthFixtureVisible = visible;
      document.dispatchEvent(new Event('visibilitychange'));
    }, visible);
    await page.goto(`/health/?date=${date}`);
    await expect.poll(() => speculativeReads.length).toBe(2);
    if (inactive === 'another route') {
      await page.getByRole('link', { name: 'Progress', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Progress', exact: true })).toHaveAttribute('aria-current', 'page');
    } else {
      await setVisible(false);
    }
    await Promise.all(speculativeReads.slice().map(async route => {
      const response = page.waitForResponse(result => result.request() === route.request());
      await route.fulfill({ json: { items: [] } });
      await (await response).finished();
    }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(speculativeReads).toHaveLength(2);

    returning = true;
    if (inactive === 'another route') await page.getByRole('link', { name: 'Today', exact: true }).click();
    else await setVisible(true);
    await expect.poll(() => speculativeReads.length).toBeGreaterThan(2);
  });
}

test('Health Settings refreshes its auditor summary and questions with one foreground read', async ({ page }) => {
  await mockHealthVisibility(page);
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  let reads = 0;
  let question = 'Which fish did you eat?';
  await page.route(`**${cleanupEndpoint}`, route => {
    reads += 1;
    return route.fulfill({ json: {
      settings: { enabled: true, dryRun: true },
      runs: [],
      questions: [{ id: 'fish', version: 1, question, choices: [] }],
    } });
  });

  await page.goto('/health/settings');
  await expect(page.getByText('Preview only · No runs yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: question })).toBeVisible();
  expect(reads).toBe(1);

  question = 'Which fish was in the sandwich?';
  await foregroundHealth(page);
  await expect(page.getByRole('heading', { name: question })).toBeVisible();
  expect(reads).toBe(2);
});

test('Health auditor refreshes its spend once when the latest run finishes', async ({ page }) => {
  await mockHealthVisibility(page);
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  let completedAt = null;
  let statusReads = 0;
  let spendReads = 0;
  await page.route(`**${cleanupEndpoint}`, route => {
    statusReads += 1;
    return route.fulfill({ json: {
      settings: { enabled: false },
      options: { minGapMinutes: [0] },
      questions: [],
      runs: [{ id: 'fish-run', createdAt: runAt, completedAt }],
    } });
  });
  await page.route(`**${cleanupEndpoint}/spend?days=30`, route => {
    spendReads += 1;
    return route.fulfill({ json: { today: completedAt ? 0.3 : 0.1, week: 0.3, month: 0.3 } });
  });
  await page.route(`**${cleanupEndpoint}/journal**`, route => route.fulfill({ json: { rows: [], total: 0 } }));
  await page.route(`**${cleanupEndpoint}/history**`, route => route.fulfill({ json: { records: [], total: 0 } }));

  await page.goto('/health/auditor');
  await expect(page.getByText('$0.10 today', { exact: true })).toBeVisible();
  expect(spendReads).toBe(1);
  const unchanged = page.waitForResponse(response => new URL(response.url()).pathname === cleanupEndpoint);
  await foregroundHealth(page);
  await (await unchanged).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(statusReads).toBe(2);
  expect(spendReads).toBe(1);

  completedAt = '2026-09-25T15:43:00.000Z';
  await foregroundHealth(page);
  await expect(page.getByText('$0.30 today', { exact: true })).toBeVisible();
  expect(spendReads).toBe(2);
});

test('Health Progress recovers the saved goals from a GET-only retry', async ({ page }) => {
  let reads = 0;
  const methods = [];
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/goals', route => {
    methods.push(route.request().method());
    if (++reads === 1) return route.fulfill({ status: 409, json: { error: 'Goals temporarily unavailable' } });
    return route.fulfill({ json: { goals: { targetWeightLbs: 170, weeklyRateLbs: 0.5, budgetFloor: 1600 } } });
  });

  await page.goto('/health/progress');
  await expect(page.getByText('Goals failed to load', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit goals' })).toBeHidden();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Target 170 lb', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit goals' })).toBeEnabled();
  expect(methods).toEqual(['GET', 'GET']);
});

async function mockCleanupSession(page) {
  let owner = 'alice';
  let historyReads = 0;
  const writes = [];

  await page.route('**/health/context', route => route.fulfill({ json: { userId: owner } }));
  await page.route(`**${cleanupEndpoint}`, route => route.fulfill({
    json: {
      settingsVersion: 1,
      settings: { enabled: false, dryRun: false, telegram: false, dailyCapUsd: null },
      options: { minGapMinutes: [0] },
      questions: [{
        id: `${owner}-question`, version: 2, status: 'open', question: `Which fish did ${owner} eat?`,
        choices: [{ id: 'cod', label: 'Cod', repair: { updates: [{ id: 'fish', changes: { name: 'Cod' } }] } }],
        entryNames: { fish: 'White Fish' },
      }],
      runs: [],
    },
  }));
  await page.route(`**${cleanupEndpoint}/journal**`, route => {
    const run = {
      runId: `${owner}-run`, at: runAt, completedAt: runAt, status: 'completed', trigger: ['captures'],
      model: 'gpt-4.1-mini', costUsd: 0.001, summary: `${owner} run summary`,
      outcomes: [{ status: 'applied', operationId: `${owner}-run-repair`, affectedIds: ['fish'] }],
    };
    const { pathname } = new URL(route.request().url());
    const json = pathname.endsWith('/journal') ? { rows: [run], total: 1 } : { ...run, transcriptExpired: true };
    return route.fulfill({ json });
  });
  await page.route(`**${cleanupEndpoint}/history**`, route => {
    historyReads++;
    return route.fulfill({ json: { total: 1, records: [
      { id: `${owner}-repair`, actor: owner, at: runAt, reason: `${owner} repair`, changes: [] },
    ] } });
  });
  await page.route(`**${cleanupEndpoint}/**`, route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push({ owner, route });
  });

  return {
    writes,
    historyReads: () => historyReads,
    switchToBob() { owner = 'bob'; },
  };
}

async function openRepairHistory(page, owner) {
  await page.getByText('View repairs (1)', { exact: true }).click();
  await expect(page.getByText(`${owner} repair`, { exact: false })).toBeVisible();
}

const repairHistoryUndo = {
  label: 'repair history undo',
  pagePath: '/health/auditor',
  writePath: '/undo/alice-repair',
  button: 'Undo this repair',
  async open(page, owner) {
    await openRepairHistory(page, owner);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Repair details' })).toContainText(`${owner} repair`);
  },
  response: { status: 'undone' },
  body: {},
};
const runDetailUndo = {
  label: 'run detail undo',
  pagePath: '/health/auditor',
  writePath: '/undo/alice-run-repair',
  button: 'Undo this change',
  async open(page, owner) {
    await page.getByRole('button', { name: /1 changed/ }).click();
    await expect(page.getByText(`${owner} run summary`, { exact: true })).toBeVisible();
  },
  response: { status: 'undone' },
  body: {},
};
const answerCleanupQuestion = {
  label: 'cleanup question answer',
  pagePath: '/health/settings',
  writePath: '/questions/alice-question/answer',
  button: 'Cod',
  async open(page, owner) {
    await expect(page.getByText(`Which fish did ${owner} eat?`, { exact: true })).toBeVisible();
  },
  response: { status: 'stale', outcome: { message: 'Alice’s food entry changed.' } },
  body: { choiceId: 'cod', expectedVersion: 2 },
};

for (const action of [repairHistoryUndo, runDetailUndo, answerCleanupQuestion]) {
  test(`Health ignores a late ${action.label} acknowledgement after the user changes`, async ({ page }) => {
    const session = await mockCleanupSession(page);
    await page.goto(action.pagePath);
    await action.open(page, 'alice');
    const button = page.getByRole('button', { name: action.button, exact: true });
    await button.click();
    await expect.poll(() => session.writes.length).toBe(1);

    await navigateWithHistory(page, '/home');
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible();
    session.switchToBob();
    await navigateWithHistory(page, repairHistoryUndo.pagePath);
    await repairHistoryUndo.open(page, 'bob');
    const before = session.historyReads();

    await finishHealthWrite(page, session.writes[0].route, action.response);

    expect(session.historyReads(), 'Alice’s response triggered a repair history read in Bob’s session').toBe(before);
    await expect(page.getByRole('button', { name: repairHistoryUndo.button, exact: true })).toBeEnabled();
    expect(session.writes.map(({ owner, route }) => ({
      owner,
      path: new URL(route.request().url()).pathname,
      method: route.request().method(),
      body: route.request().postDataJSON(),
    }))).toEqual([{
      owner: 'alice',
      path: cleanupEndpoint + action.writePath,
      method: 'POST',
      body: { ...action.body, operationId: expect.any(String) },
    }]);
  });
}

test('Health keeps repair history undo available after a conflict and refreshes on retry', async ({ page }) => {
  const action = repairHistoryUndo;
  const session = await mockCleanupSession(page);
  await page.goto(action.pagePath);
  await action.open(page, 'alice');
  const dialog = page.getByRole('dialog', { name: 'Repair details' });
  const undo = dialog.getByRole('button', { name: action.button, exact: true });
  await undo.click();
  await expect.poll(() => session.writes.length).toBe(1);
  await session.writes[0].route.fulfill({ status: 409, json: { message: 'A later edit conflicts' } });
  await expect(dialog.getByRole('alert')).toContainText('A later edit conflicts');
  await expect(undo).toBeEnabled();

  const before = session.historyReads();
  await undo.click();
  await expect.poll(() => session.writes.length).toBe(2);
  await finishHealthWrite(page, session.writes[1].route, action.response);
  await expect(dialog).toHaveCount(0);
  await expect.poll(session.historyReads).toBeGreaterThan(before);
});

test('Health refreshes repair history when an undo finishes across tabs for the same user', async ({ page }) => {
  const action = repairHistoryUndo;
  const session = await mockCleanupSession(page);
  await page.goto(action.pagePath);
  await action.open(page, 'alice');
  await page.getByRole('button', { name: action.button, exact: true }).click();
  await expect.poll(() => session.writes.length).toBe(1);

  // The busy repair sheet blocks its underlying links. Simulate in-app history navigation.
  await navigateWithHistory(page, '/health');
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('View repairs (1)', { exact: true })).toHaveCount(0);
  const historyReload = page.waitForResponse(response => new URL(response.url()).pathname === `${cleanupEndpoint}/history`);
  await navigateWithHistory(page, action.pagePath);
  await openRepairHistory(page, 'alice');
  expect(await (await historyReload).finished()).toBeNull();
  const before = session.historyReads();

  await finishHealthWrite(page, session.writes[0].route, action.response);

  await expect.poll(session.historyReads).toBeGreaterThan(before);
  expect(session.writes.map(({ owner, route }) => [owner, route.request().method()])).toEqual([['alice', 'POST']]);
});

test('Home keeps group light commands in their room and retries only the failed lamps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const payload = house('on');
  const [first] = payload.entities;
  const second = { ...first, id: 'light.counter', name: 'Counter light' };
  const third = { ...first, id: 'light.sink', name: 'Sink light', state: 'off', stateClass: 'off' };
  payload.entities.push(second, third);
  await page.route('**/home-dashboard/entities', route => route.fulfill({ json: payload }));
  const writes = [];
  await page.route('**/home-dashboard/toggle', route => { writes.push(route); });
  const off = entity => ({ entityId: entity.id, desiredState: 'off' });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  const room = page.locator('[data-room-id="kitchen"]');
  const header = room.locator('.home-room__row');
  await header.press('Enter');
  await room.getByRole('button', { name: 'Turn off all 2 lights in Kitchen' }).press('Enter');
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map(route => route.request().postDataJSON())).toEqual(expect.arrayContaining([off(first), off(second)]));
  await expect(header).toBeFocused();
  await expect(room.getByRole('status')).toContainText('Turning off');
  await page.getByRole('button', { name: 'Mosaic', exact: true }).click();
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await header.press('Enter');
  await expect(room.getByRole('status')).toContainText('Turning off');
  first.state = first.stateClass = 'off';
  third.state = third.stateClass = 'on';
  const requestFor = id => writes.find(route => route.request().postDataJSON().entityId === id);
  await requestFor(first.id).fulfill({ json: { ok: true } });
  await requestFor(second.id).fulfill({ status: 503, json: { error: 'Unavailable' } });
  await expect(room.getByRole('alert')).toContainText('Counter light');
  await expect(room.getByRole('switch', { name: 'Kitchen light: turn on' })).not.toBeChecked();
  await expect(room.getByRole('switch', { name: 'Sink light: turn off' })).toBeChecked();
  const retry = room.getByRole('button', { name: /Retry/ });
  await retry.press('Enter');
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].request().postDataJSON()).toEqual(off(second));
  await expect(header).toBeFocused();
  const sink = room.getByRole('switch', { name: 'Sink light: turn off' });
  await sink.focus();
  second.state = second.stateClass = 'off';
  await writes[2].fulfill({ json: { ok: true } });
  await expect(room.getByRole('status')).toHaveCount(0);
  await expect(room.getByRole('alert')).toHaveCount(0);
  await expect(room.getByRole('switch', { name: 'Counter light: turn on' })).not.toBeChecked();
  await expect(sink).toBeFocused();
  expect(writes).toHaveLength(3);
});

async function openRoomGroup(page) {
  const payload = house('on');
  const first = payload.entities[0];
  const lamps = ['Counter', 'Sink', 'Island'].map((name, i) => ({
    ...first, id: 'light.' + name.toLowerCase(), name: name + ' light',
    state: i === 0 ? 'on' : 'off', stateClass: i === 0 ? 'on' : 'off',
  }));
  payload.entities.push(...lamps);
  await page.route('**/home-dashboard/entities', route => route.fulfill({ json: payload }));
  const writes = [];
  await page.route('**/home-dashboard/toggle', route => { writes.push(route); });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  const room = page.locator('[data-room-id="kitchen"]');
  const header = room.locator('.home-room__row');
  await header.press('Enter');
  await room.getByRole('button', { name: 'Turn off all 2 lights in Kitchen' }).press('Enter');
  await expect.poll(() => writes.length).toBe(2);
  first.state = first.stateClass = 'off';
  await writes.find(r => r.request().postDataJSON().entityId === first.id).fulfill({ json: { ok: true } });
  const failure = writes.find(r => r.request().postDataJSON().entityId === lamps[0].id);
  const refresh = async () => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/home-dashboard/entities'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await (await response).finished();
  };
  return { room, header, lamps, failure, refresh, writes };
}

for (const [anotherGroup, ownsFocus] of [[false, true], [true, true], [true, false]]) {
  test(`Home keeps focus on the ${ownsFocus ? 'room header' : 'selected switch'} when a confirmed retry ${anotherGroup ? 'becomes a broader action' : 'disappears'}`, async ({ page }) => {
    const { room, header, lamps, failure, refresh, writes } = await openRoomGroup(page);
    await failure.fulfill({ status: 503, json: { error: 'Unavailable' } });
    const retry = room.getByRole('button', { name: /Retry/ });
    await expect(retry).toBeVisible();
    const selected = room.getByRole('switch', { name: 'Kitchen light: turn on' });
    await (ownsFocus ? retry : selected).focus();
    for (const lamp of lamps) lamp.state = lamp.stateClass = anotherGroup && lamp !== lamps[0] ? 'on' : 'off';
    await refresh();
    await expect(retry).toHaveCount(0);
    await expect(ownsFocus ? header : selected).toBeFocused();
    await expect(room.getByRole('button', { name: /Turn off all/ })).toHaveCount(anotherGroup ? 1 : 0);
    if (ownsFocus) {
      await page.keyboard.press('Enter');
      await expect(header).toHaveAttribute('aria-expanded', 'false');
    }
    expect(writes).toHaveLength(2);
  });
}

test('Home retires a confirmed room target even when its failed acknowledgement arrives later', async ({ page }) => {
  const { room, lamps, failure, refresh, writes } = await openRoomGroup(page);
  const [counter, sink] = lamps;
  counter.state = counter.stateClass = 'off';
  sink.state = sink.stateClass = 'on';
  await refresh();
  await expect(room.getByRole('switch', { name: 'Sink light: turn off' })).toBeChecked();
  await expect(room.getByRole('status')).toContainText('Turning off');
  counter.state = counter.stateClass = 'on';
  sink.state = sink.stateClass = 'off';
  await refresh();
  await expect(room.getByRole('switch', { name: 'Sink light: turn on' })).not.toBeChecked();
  await failure.fulfill({ status: 503, json: { error: 'Unavailable' } });
  await expect(room.getByRole('status')).toHaveCount(0);
  await expect(room.getByRole('switch', { name: 'Counter light: turn off' })).toBeChecked();
  await expect(room.getByRole('button', { name: /Retry/ })).toHaveCount(0);
  await expect(room.getByRole('alert')).toHaveCount(0);
  expect(writes).toHaveLength(2);
});
