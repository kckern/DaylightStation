import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ hasTouch: true, serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
});

async function expectFullTouchTarget(button) {
  await expect(button).toBeVisible();
  const { width, height } = await button.boundingBox();
  // Transformed sheets can report 43.99997 for a 44px box in Firefox.
  expect(Math.round(width * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(Math.round(height * 100) / 100).toBeGreaterThanOrEqual(44);
}

test('Auto fuel sheet Close has a full touch target and returns keyboard focus', async ({ page }) => {
  await page.route('**/automotive/vehicles', route => route.fulfill({
    json: { vehicles: [{ id: 'sample', label: 'Sample' }] },
  }));
  await page.route('**/automotive/vehicles/sample', route => route.fulfill({
    json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 },
  }));
  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).tap();
  const opener = page.getByRole('button', { name: 'Log a fill-up', exact: true });
  await opener.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Log a fill-up', exact: true });
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  await expectFullTouchTarget(close);
  await close.press('Enter');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Health reading sheet Close can be tapped at the edge of its full touch target', async ({ page }) => {
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/medical', route => route.fulfill({ json: { metrics: [] } }));
  await page.goto('/health/medical');
  await page.getByRole('button', { name: 'Add reading', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Add reading', exact: true });
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  await expectFullTouchTarget(close);
  await close.tap({ position: { x: 2, y: 22 } });
  await expect(sheet).toBeHidden();
});

for (const [width, coarse] of [[390, true], [1440, true], [1440, false]]) {
  test.describe(`Health meal add actions at ${width}px ${coarse ? 'with a coarse pointer' : 'without touch'}`, () => {
    test.use({ hasTouch: coarse, viewport: { width, height: 850 }, timezoneId: 'UTC' });

    test('keeps the capture and saved meals controls reachable', async ({ page }) => {
      const date = '2026-11-22';
      await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
      const fixture = await installHealthFixtures(page, {
        items: [{ uuid: 'rice', name: 'Rice', mealTime: 'evening', calories: 120, grams: 100, date }],
      });
      await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
      await page.goto('/health?date=' + date);
      await expect(page.getByRole('button', { name: 'Edit Rice', exact: true })).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(coarse);
      const finePointer = await page.evaluate(() => matchMedia('(pointer: fine)').matches);

      const controls = page.getByRole('button', {
        name: /^(Speak foods to Dinner|Photo to Dinner|Scan barcode to Dinner|Saved meals for Dinner)$/,
      });
      await expect(controls).toHaveCount(4);
      const sizes = () => controls.evaluateAll(buttons => buttons.map(button => {
        const { width, height } = button.getBoundingClientRect();
        return [width, height];
      }));
      if (coarse) {
        await expect.poll(async () => {
          const current = await sizes();
          return current.length === 4 ? Math.min(...current.flat()) : 0;
        }).toBeGreaterThanOrEqual(44);
      } else {
        // Headless Firefox reports pointer:none when touch emulation is off.
        const expectedSizes = finePointer ? [26, 26, 26, 26] : [34, 34, 22, 22];
        await expect.poll(sizes).toEqual(expectedSizes.map(size => [size, size]));
      }

      const barcode = page.getByRole('button', { name: 'Scan barcode to Dinner', exact: true });
      const templates = page.getByRole('button', { name: 'Saved meals for Dinner', exact: true });
      for (const [opener, title] of [[barcode, 'Scan barcode'], [templates, 'Meals & templates']]) {
        const sheet = page.getByRole('dialog', { name: title, exact: true });
        if (coarse) {
          await opener.tap({ position: { x: 42, y: 22 } });
          await expect(sheet).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(sheet).toBeHidden();
        }
        await opener.press('Enter');
        await expect(sheet).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(opener).toBeFocused();
      }
      expect(fixture.unexpected).toEqual([]);
      expect(fixture.requests.filter(request => request.method !== 'GET')).toEqual([]);
    });
  });
}

test('Auto Back to garage has a full touch target and refocuses the selected vehicle', async ({ page }) => {
  await page.route('**/automotive/vehicles', route => route.fulfill({
    json: { vehicles: [{ id: 'sample', label: 'Sample' }, { id: 'other', label: 'Other' }] },
  }));
  await page.route('**/automotive/vehicles/sample', route => route.fulfill({
    json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 },
  }));
  await page.goto('/auto');
  const vehicle = page.getByRole('button', { name: 'Sample', exact: true });
  await vehicle.press('Enter');
  const back = page.getByRole('button', { name: 'Back to garage', exact: true });
  await expectFullTouchTarget(back);
  await back.tap({ position: { x: 2, y: 22 } });
  await expect(vehicle).toBeFocused();
});

test('Health settings opens from the edge of its full touch target', async ({ page }) => {
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/medical', route => route.fulfill({ json: { metrics: [] } }));
  await page.goto('/health/medical');
  await expect(page.getByText('No medical readings yet', { exact: true })).toBeVisible();
  const settings = page.getByRole('button', { name: 'Health settings', exact: true });
  await expectFullTouchTarget(settings);
  await settings.tap({ position: { x: 2, y: 22 } });
  await expect(page).toHaveURL(/\/health\/settings$/);
});

test('Home camera opens fullscreen from the edge of its full touch target', async ({ page }) => {
  await page.route('**/api/v1/camera', route => route.fulfill({ json: { cameras: [{ id: 'doorbell' }] } }));
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).tap();
  const fullscreen = page.getByRole('button', { name: 'Fullscreen doorbell', exact: true });
  await expectFullTouchTarget(fullscreen);
  await fullscreen.tap({ position: { x: 2, y: 22 } });
  await expect(page.getByRole('button', { name: 'Close camera', exact: true })).toBeVisible();
});

test('Life value rank actions have accessible names and full touch targets', async ({ page }) => {
  const member = { username: 'amy', displayName: 'Amy' };
  let values = [
    { id: 'care', name: 'Care', rank: 1 },
    { id: 'curiosity', name: 'Curiosity', rank: 2 },
  ];
  const writes = [];
  await page.route('**/api/v1/life/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: [member] } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: member });
    if (url.pathname.endsWith('/plan/')) return route.fulfill({ json: { values } });
    if (url.pathname.endsWith('/plan/values') && request.method() === 'PATCH') {
      writes.push({ username: url.searchParams.get('username'), values: request.postDataJSON() });
      values = writes.at(-1).values;
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/life/plan/values');
  await expect(page.getByText('Curiosity', { exact: true })).toBeVisible();
  const up = name => page.getByRole('button', { name: `Move ${name} up`, exact: true });
  const down = name => page.getByRole('button', { name: `Move ${name} down`, exact: true });
  await expect(up('Care')).toBeDisabled();
  await expect(down('Curiosity')).toBeDisabled();
  await expectFullTouchTarget(up('Curiosity'));
  await expectFullTouchTarget(down('Care'));

  await up('Curiosity').tap({ position: { x: 2, y: 22 } });
  await expect(up('Curiosity')).toBeDisabled();
  await expect(down('Care')).toBeDisabled();
  await down('Curiosity').press('Enter');
  await expect(up('Care')).toBeDisabled();
  await expect(down('Curiosity')).toBeDisabled();
  expect(writes).toEqual([
    { username: 'amy', values: [
      { id: 'curiosity', name: 'Curiosity', rank: 1 },
      { id: 'care', name: 'Care', rank: 2 },
    ] },
    { username: 'amy', values: [
      { id: 'care', name: 'Care', rank: 1 },
      { id: 'curiosity', name: 'Curiosity', rank: 2 },
    ] },
  ]);
});

test('Life keeps a value reorder pending across routes and isolates it by member', async ({ page }) => {
  const users = ['alice', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
  const valuesByMember = Object.fromEntries(users.map(({ username }) => [username, [
    { id: 'care', name: 'Care', rank: 1 },
    { id: 'curiosity', name: 'Curiosity', rank: 2 },
    { id: 'kindness', name: 'Kindness', rank: 3 },
  ]]));
  const writes = [];
  let alicePatchArrived = false;
  let releaseAlicePatch;
  let holdAliceReadback = false;
  let aliceReadbackArrived = false;
  let releaseAliceReadback;
  await page.addInitScript(() => localStorage.setItem('life.username', 'alice'));
  await page.route('**/api/v1/life/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const username = url.searchParams.get('username') || 'alice';
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: users.find(user => user.username === username) });
    if (url.pathname.replace(/\/$/, '').endsWith('/plan') && request.method() === 'GET') {
      if (username === 'alice' && holdAliceReadback) {
        holdAliceReadback = false;
        aliceReadbackArrived = true;
        await new Promise(resolve => { releaseAliceReadback = resolve; });
      }
      return route.fulfill({ json: { values: valuesByMember[username] } });
    }
    if (url.pathname.endsWith('/plan/values') && request.method() === 'PATCH') {
      const nextValues = request.postDataJSON();
      writes.push({ username, values: nextValues });
      valuesByMember[username] = nextValues;
      if (username === 'alice' && !alicePatchArrived) {
        alicePatchArrived = true;
        await new Promise(resolve => { releaseAlicePatch = resolve; });
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });

  try {
    await page.goto('/life/plan/values');
    await expect(page.getByText('Kindness', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Move Curiosity up', exact: true }).press('Enter');
    await expect.poll(() => alicePatchArrived).toBe(true);
    expect(writes).toHaveLength(1);

    await page.getByRole('link', { name: 'Purpose', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Purpose', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Values', exact: true }).click();
    await expect(page.getByText('Curiosity', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move Care up', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add value', exact: true })).toBeDisabled();

    const switcher = page.getByRole('textbox', { name: 'Switch household member' });
    await switcher.press('ArrowDown');
    const bobOption = page.getByRole('option', { name: 'BOB', exact: true });
    await expect(bobOption).toBeVisible();
    const bobOptionId = await bobOption.getAttribute('id');
    for (let step = 0; step < 2 && await switcher.getAttribute('aria-activedescendant') !== bobOptionId; step += 1) {
      await switcher.press('ArrowDown');
    }
    await switcher.press('Enter');
    await expect(switcher).toHaveValue('BOB');
    await page.getByRole('button', { name: 'Move Curiosity up', exact: true }).press('Enter');
    await expect.poll(() => writes.filter(write => write.username === 'bob')).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Move Care up', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Move Curiosity up', exact: true })).toBeDisabled();

    await switcher.press('ArrowDown');
    const aliceOption = page.getByRole('option', { name: 'ALICE', exact: true });
    await expect(aliceOption).toBeVisible();
    const aliceOptionId = await aliceOption.getAttribute('id');
    for (let step = 0; step < 2 && await switcher.getAttribute('aria-activedescendant') !== aliceOptionId; step += 1) {
      await switcher.press('ArrowDown');
    }
    await switcher.press('Enter');
    await expect(switcher).toHaveValue('ALICE');
    await expect(page.getByRole('button', { name: 'Add value', exact: true })).toBeDisabled();

    holdAliceReadback = true;
    releaseAlicePatch();
    await expect.poll(() => aliceReadbackArrived).toBe(true);
    await expect(page.getByRole('heading', { name: 'Values', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add value', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Move Care up', exact: true })).toHaveCount(0);
    releaseAliceReadback();
    await expect(page.getByRole('button', { name: 'Add value', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Move Care up', exact: true })).toBeEnabled();
    expect(writes).toEqual([
      { username: 'alice', values: [
        { id: 'curiosity', name: 'Curiosity', rank: 1 },
        { id: 'care', name: 'Care', rank: 2 },
        { id: 'kindness', name: 'Kindness', rank: 3 },
      ] },
      { username: 'bob', values: [
        { id: 'curiosity', name: 'Curiosity', rank: 1 },
        { id: 'care', name: 'Care', rank: 2 },
        { id: 'kindness', name: 'Kindness', rank: 3 },
      ] },
    ]);
  } finally {
    releaseAlicePatch?.();
    releaseAliceReadback?.();
  }
});

test('Life releases a refused value reorder so the member can retry', async ({ page }) => {
  let values = [
    { id: 'care', name: 'Care', rank: 1 },
    { id: 'curiosity', name: 'Curiosity', rank: 2 },
  ];
  const writes = [];
  await page.addInitScript(() => localStorage.setItem('life.username', 'alice'));
  await page.route('**/api/v1/life/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: [{ username: 'alice', displayName: 'Alice' }] } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: { username: 'alice', displayName: 'Alice' } });
    if (url.pathname.replace(/\/$/, '').endsWith('/plan') && request.method() === 'GET') return route.fulfill({ json: { values } });
    if (url.pathname.endsWith('/plan/values') && request.method() === 'PATCH') {
      writes.push(request.postDataJSON());
      if (writes.length === 1) return route.fulfill({ status: 503, json: { error: 'Temporary refusal' } });
      values = writes.at(-1);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/life/plan/values');
  const move = page.getByRole('button', { name: 'Move Curiosity up', exact: true });
  await move.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(move).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add value', exact: true })).toBeEnabled();

  await move.press('Enter');
  await expect(page.getByRole('button', { name: 'Move Care up', exact: true })).toBeEnabled();
  expect(writes).toHaveLength(2);
});
