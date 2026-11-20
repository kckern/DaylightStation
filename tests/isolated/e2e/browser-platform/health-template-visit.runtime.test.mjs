import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

const date = '2026-11-22';
const templatePath = '/api/v1/health/nutrition/templates';
const templates = [
  { id: 'breakfast', name: 'Breakfast oats', components: [{ name: 'Oats', role: 'core', calories: 100 }] },
  { id: 'lunch', name: 'Lunch salad', components: [
    { name: 'Greens', role: 'core', calories: 100 },
    { name: 'Walnuts', role: 'variant', calories: 50 },
  ] },
];

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 }, timezoneId: 'UTC' });

async function startHealth(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await page.routeWebSocket('**/*', () => {});
  const state = await installHealthFixtures(page);
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  return state;
}

for (const originalStatus of [201, 422]) {
  test(`Health keeps a replacement Lunch template draft after a late Breakfast ${originalStatus}`, async ({ page, baseURL }) => {
    const releaseBreakfast = Promise.withResolvers();
    const writes = [];
    const breakfastWrite = {
      templateId: 'breakfast', mealTime: 'morning', date, variantNames: [], operationId: expect.any(String),
    };
    const lunchWrite = {
      templateId: 'lunch', mealTime: 'afternoon', date, variantNames: ['Walnuts'], operationId: expect.any(String),
    };
    const state = await startHealth(page, baseURL);
    await page.route(`**${templatePath}?*`, route => route.fulfill({ json: { templates } }));
    await page.route(`**${templatePath}/*/instantiate`, async route => {
      const body = route.request().postDataJSON();
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      writes.push(body);
      if (id === 'breakfast') {
        await releaseBreakfast.promise;
        if (originalStatus === 422) {
          return route.fulfill({ status: 422, json: { error: 'Breakfast fixture refused' } });
        }
      }
      const item = {
        uuid: id + '-logged', name: id === 'breakfast' ? 'Oats from Breakfast' : 'Salad from Lunch',
        calories: 100, grams: 100, date, mealTime: body.mealTime,
      };
      state.items.push(item);
      return route.fulfill({ status: 201, json: { committed: true, item, date, mealTime: body.mealTime } });
    });

    const dialog = page.getByRole('dialog');
    const meals = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
    const lunchDraft = page.getByRole('dialog', { name: 'Lunch salad', exact: true });
    const walnuts = lunchDraft.getByRole('switch', { name: /^Walnuts/ });
    const logLunch = lunchDraft.getByRole('button', { name: 'Log 150 kcal', exact: true });
    const openMeals = async meal => {
      await page.getByRole('button', { name: 'Saved meals for ' + meal, exact: true }).press('Enter');
      await expect(meals).toBeVisible();
    };

    try {
      await page.goto('/health?date=' + date);
      await openMeals('Breakfast');
      await meals.getByRole('button', { name: /^Breakfast oats/ }).press('Enter');
      await expect.poll(() => writes).toEqual([breakfastWrite]);
      await page.keyboard.press('Escape');
      await expect(meals).toBeHidden();

      await openMeals('Lunch');
      const chooseLunch = meals.getByRole('button', { name: /^Lunch salad/ });
      await expect(chooseLunch, 'an earlier Breakfast save must not disable the new Lunch sheet').toBeEnabled();
      await chooseLunch.press('Enter');
      await walnuts.press('Space');
      await expect(walnuts).toBeChecked();
      await expect(logLunch).toBeEnabled();

      const breakfastResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === templatePath + '/breakfast/instantiate');
      releaseBreakfast.resolve();
      const response = await breakfastResponse;
      expect(response.status()).toBe(originalStatus);
      await response.finished();
      if (originalStatus === 201) {
        await expect(page.getByText('Oats from Breakfast', { exact: true }).first()).toBeVisible();
      } else {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.getByText('Oats from Breakfast', { exact: true })).toHaveCount(0);
      }

      await expect(lunchDraft).toBeVisible();
      await expect(walnuts).toBeChecked();
      await expect(lunchDraft.getByText(/Breakfast fixture refused/)).toHaveCount(0);
      expect(writes).toEqual([breakfastWrite]);

      await logLunch.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Salad from Lunch', { exact: true }).first()).toBeVisible();
      expect(writes).toEqual([breakfastWrite, lunchWrite]);
      expect(writes[0].operationId).not.toBe(writes[1].operationId);
    } finally {
      releaseBreakfast.resolve();
    }
  });
}

test('Health refreshes a replacement saved-meal list after the original edit commits', async ({ page, baseURL }) => {
  const release = Promise.withResolvers();
  const writes = [];
  let template = { id: 'oats', name: 'Initial oats', components: [{ name: 'Oats', role: 'core', grams: 100, calories: 100 }] };
  await startHealth(page, baseURL);
  await page.route(`**${templatePath}?*`, route => route.fulfill({ json: { templates: [template] } }));
  await page.route(`**${templatePath}/oats`, async route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.fallback();
    const changes = request.postDataJSON();
    writes.push(changes.name);
    await release.promise;
    template = { ...template, ...changes };
    return route.fulfill({ json: { template } });
  });

  const meals = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  try {
    await page.goto('/health?date=' + date);
    await button('Saved meals for Breakfast').press('Enter');
    await button('Edit Initial oats').press('Enter');
    await meals.getByLabel('Meal name').fill('Revised oats');
    await button('Save meal').press('Enter');
    await expect.poll(() => writes).toEqual(['Revised oats']);
    await page.keyboard.press('Escape');
    await expect(meals).toBeHidden();

    await button('Saved meals for Lunch').press('Enter');
    await expect(button('Edit Initial oats')).toBeVisible();
    release.resolve();
    await expect(meals.getByRole('button', { name: 'Edit Revised oats', exact: true })).toBeVisible();
    expect(writes).toEqual(['Revised oats']);
  } finally {
    release.resolve();
  }
});

test('Health keeps focus in saved meals when retrying the list read', async ({ page, baseURL }) => {
  const pending = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reads = [];
  await startHealth(page, baseURL);
  await page.route(`**${templatePath}?*`, async route => {
    reads.push(route.request().method());
    if (reads.length === 1) return route.fulfill({ status: 409, json: { error: 'Meals refused' } });
    pending.resolve();
    await release.promise;
    return route.fulfill({ json: { templates } });
  });

  try {
    await page.goto('/health?date=' + date);
    await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
    const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
    await retry.press('Enter');
    await pending.promise;
    await expect(retry).toBeHidden();
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    const list = dialog.getByRole('region', { name: 'Saved meals', exact: true });
    await expect(list).toBeFocused();
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Shift+Tab');
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    release.resolve();
    await expect(list.getByRole('button', { name: 'Edit Breakfast oats' })).toBeVisible();
    await expect(list).not.toHaveAttribute('aria-busy', 'true');
    await expect(close).toBeFocused();
    expect(reads).toEqual(['GET', 'GET']);
  } finally {
    release.resolve();
  }
});

for (const activation of ['keyboard', 'pointer']) {
  test(`Health reveals the saved-meal editor and list when switching from a scrolled sheet by ${activation}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await startHealth(page, baseURL);
    const longList = Array.from({ length: 18 }, (_, index) => ({
      id: `meal-${index + 1}`, name: `Meal ${index + 1}`,
      components: Array.from({ length: 15 }, (_, step) => ({ name: `Component ${step + 1}`, role: 'core', grams: 100 })),
    }));
    await page.route(`**${templatePath}?*`, route => route.fulfill({ json: { templates: longList } }));
    await page.goto('/health?date=' + date);
    await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
    const list = dialog.getByRole('region', { name: 'Saved meals', exact: true });
    const panel = dialog.locator('.ds-sheet__panel');
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    async function activateScrolledControl(control) {
      if (activation === 'pointer') await close.focus();
      await control.scrollIntoViewIfNeeded();
      expect(await panel.evaluate(node => node.scrollTop)).toBeGreaterThan(200);
      if (activation === 'keyboard') {
        await control.press('Enter');
      } else {
        // Exercise a pointer activation where the browser keeps previous focus.
        await control.evaluate(node => node.addEventListener('pointerdown', event => event.preventDefault(), { once: true }));
        await control.click();
      }
    }

    await activateScrolledControl(dialog.getByRole('button', { name: 'Edit Meal 18', exact: true }));
    await expect(list).toBeFocused();
    await expect(dialog.getByLabel('Meal name', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    await activateScrolledControl(dialog.getByRole('button', { name: 'Cancel', exact: true }));
    await expect(list).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Edit Meal 1', exact: true })).toBeInViewport({ ratio: 1 });
  });
}

for (const moveFocus of [false, true]) {
  test(`Health retains keyboard focus through a saved-meal edit ${moveFocus ? 'after moving to Close' : 'and returns to the list'}`, async ({ page, baseURL }) => {
    const putStarted = Promise.withResolvers();
    const refuse = Promise.withResolvers();
    const accepted = Promise.withResolvers();
    const release = Promise.withResolvers();
    const confirming = Promise.withResolvers();
    const refreshed = Promise.withResolvers();
    const methods = [];
    const payloads = [];
    let template = templates[0];
    await startHealth(page, baseURL);
    await page.route(`**${templatePath}?*`, async route => {
      methods.push(route.request().method());
      if (methods.length > 1) {
        confirming.resolve();
        await refreshed.promise;
      }
      return route.fulfill({ json: { templates: [template] } });
    });
    await page.route(`**${templatePath}/breakfast`, async route => {
      methods.push(route.request().method());
      payloads.push(route.request().postDataJSON());
      if (payloads.length === 1) {
        putStarted.resolve();
        await refuse.promise;
        return route.fulfill({ status: 409, json: { error: 'Save refused' } });
      }
      accepted.resolve();
      await release.promise;
      template = { ...template, ...payloads.at(-1) };
      return route.fulfill({ json: { template } });
    });

    try {
      await page.goto('/health?date=' + date);
      await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
      const list = dialog.getByRole('region', { name: 'Saved meals', exact: true });
      await dialog.getByRole('button', { name: 'Edit Breakfast oats', exact: true }).press('Enter');
      const name = dialog.getByLabel('Meal name', { exact: true });
      await expect(list).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(name).toBeFocused();
      await name.fill('Updated oats');
      const save = dialog.getByRole('button', { name: 'Save meal', exact: true });
      await save.press('Enter');
      await putStarted.promise;
      expect.soft(await save.evaluate(node => node === document.activeElement)).toBe(true);
      await expect(save).toHaveAttribute('aria-busy', 'true');
      await expect(name).toBeDisabled();
      await page.keyboard.press('Enter');
      refuse.resolve();

      await expect(dialog.getByRole('alert')).toContainText('Save refused');
      await expect(save).toBeFocused();
      await expect(name).toHaveValue('Updated oats');
      expect(methods).toEqual(['GET', 'PUT']);
      await save.press('Enter');
      await accepted.promise;
      const close = dialog.getByRole('button', { name: 'Close', exact: true });
      if (moveFocus) {
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
      }
      release.resolve();
      await confirming.promise;
      await expect(moveFocus ? close : list).toBeFocused();
      await expect(list).toHaveAttribute('aria-busy', 'true');
      refreshed.resolve();
      const edit = list.getByRole('button', { name: 'Edit Updated oats', exact: true });
      await expect(edit).toBeVisible();
      await expect(moveFocus ? close : list).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(list.getByRole('button', { name: /Updated oats.*1 items/ })).toBeFocused();
      expect(methods).toEqual(['GET', 'PUT', 'PUT', 'GET']);
      expect(payloads).toEqual(Array(2).fill({ name: 'Updated oats', components: templates[0].components }));
    } finally {
      refuse.resolve();
      release.resolve();
      refreshed.resolve();
    }
  });
}

for (const { action, suffix, method } of [
  { action: 'Keep', suffix: '/approve', method: 'POST' },
  { action: 'No thanks', suffix: '/dismiss', method: 'POST' },
  { action: 'Delete Breakfast oats', suffix: '', method: 'DELETE' },
]) {
  test(`Health keeps meal-list focus through ${action} and its readback`, async ({ page, baseURL }) => {
    const proposed = { ...templates[0], status: 'proposed' };
    let current = [suffix ? proposed : templates[0], templates[1]];
    const calls = [];
    const refused = Promise.withResolvers();
    const writing = Promise.withResolvers();
    const committed = Promise.withResolvers();
    const readback = Promise.withResolvers();
    const retryRead = Promise.withResolvers();
    let writes = 0;
    let reads = 0;
    await startHealth(page, baseURL);
    await page.route(`**${templatePath}?*`, async route => {
      calls.push(route.request().method());
      reads += 1;
      if (reads === 2 && suffix === '/approve') {
        return route.fulfill({ status: 409, json: { error: 'Meal list unavailable' } });
      }
      if (reads > 1) {
        retryRead.resolve();
        await readback.promise;
      }
      return route.fulfill({ json: { templates: current } });
    });
    await page.route(`**${templatePath}/breakfast${suffix}`, async route => {
      calls.push(route.request().method());
      writes += 1;
      if (writes === 1) {
        writing.resolve();
        await refused.promise;
        return route.fulfill({ status: 409, json: { error: 'Meal change refused' } });
      }
      await committed.promise;
      current = suffix === '/approve' ? templates : [templates[1]];
      return route.fulfill({ json: { ok: true } });
    });

    try {
      await page.goto('/health?date=' + date);
      await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
      const list = dialog.getByRole('region', { name: 'Saved meals', exact: true });
      const command = list.getByRole('button', { name: action, exact: true });
      const close = dialog.getByRole('button', { name: 'Close', exact: true });
      if (method === 'DELETE') {
        page.once('dialog', confirmation => confirmation.dismiss());
        await command.press('Enter');
        await expect(command).toBeFocused();
        expect(calls).toEqual(['GET']);
        page.once('dialog', confirmation => confirmation.accept());
      }
      await command.press('Enter');
      await writing.promise;
      await expect(command).toBeDisabled();
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      await expect(list).toBeFocused();
      await expect(list).toHaveAttribute('aria-busy', 'true');
      await page.keyboard.press('Enter');
      expect(calls).toEqual(['GET', method]);
      refused.resolve();
      await expect(list.getByRole('alert')).toContainText('Meal change refused');
      await expect(list).toBeFocused();
      await expect(command).toBeEnabled();
      expect(calls).toEqual(['GET', method]);

      if (method === 'DELETE') page.once('dialog', confirmation => confirmation.accept());
      await command.press('Enter');
      await expect(list).toBeFocused();
      if (method === 'DELETE') {
        await page.keyboard.press('Shift+Tab');
        await expect(close).toBeFocused();
      }
      committed.resolve();
      if (suffix === '/approve') {
        const retry = list.getByRole('button', { name: 'Retry', exact: true });
        await expect(retry).toBeVisible();
        await expect(list).toBeFocused();
        await expect(command).toBeDisabled();
        await retry.press('Enter');
      }
      await retryRead.promise;
      await expect(list).toHaveAttribute('aria-busy', 'true');
      await expect(command).toBeDisabled();
      expect(calls).toEqual(['GET', method, method, 'GET', ...(suffix === '/approve' ? ['GET'] : [])]);
      readback.resolve();
      const destination = list.getByRole('button', {
        name: suffix === '/approve' ? 'Edit Breakfast oats' : 'Edit Lunch salad', exact: true,
      });
      await expect(destination).toBeEnabled();
      await expect(command).toHaveCount(0);
      await expect(list).not.toHaveAttribute('aria-busy', 'true');
      await expect(method === 'DELETE' ? close : list).toBeFocused();
    } finally {
      refused.resolve();
      committed.resolve();
      readback.resolve();
    }
  });
}

for (const useVariant of [false, true]) {
  test(`Health keeps meal focus when logging ${useVariant ? 'with choices' : 'in one tap'}`, async ({ page, baseURL }) => {
    const pending = Promise.withResolvers();
    const release = Promise.withResolvers();
    const writes = [];
    const template = useVariant ? templates[1] : templates[0];
    await startHealth(page, baseURL);
    await page.route(`**${templatePath}?*`, route => route.fulfill({ json: { templates: [template] } }));
    await page.route(`**${templatePath}/${template.id}/instantiate`, async route => {
      writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
      pending.resolve();
      await release.promise;
      return route.fulfill({ status: 409, json: { error: 'Meal log refused' } });
    });

    try {
      await page.goto('/health?date=' + date);
      await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
      const list = page.getByRole('region', { name: 'Saved meals', exact: true });
      const row = list.getByRole('button', { name: new RegExp(`${template.name}.*item`) });
      const choices = page.getByRole('dialog', { name: template.name, exact: true });
      const walnuts = choices.getByRole('switch', { name: /Walnuts/ });
      await row.press('Enter');
      if (useVariant) {
        await expect(choices).toBeVisible();
        expect(await choices.evaluate(node => node.contains(document.activeElement))).toBe(true);
        await expect(list).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(walnuts).toBeFocused();
        await page.keyboard.press('Space');
        await expect(walnuts).toBeChecked();
        await choices.getByRole('button', { name: 'Back', exact: true }).press('Enter');
        await expect(row).toBeVisible();
        await expect(list).toBeFocused();
        await row.press('Enter');
        await expect(walnuts).not.toBeChecked();
        await walnuts.press('Space');
        await choices.getByRole('button', { name: 'Log 150 kcal', exact: true }).press('Enter');
      }

      await pending.promise;
      const dialog = page.getByRole('dialog', { name: useVariant ? template.name : 'Meals & templates', exact: true });
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      await expect(list).toBeFocused();
      await expect(list).toHaveAttribute('aria-busy', 'true');
      await page.keyboard.press('Enter');
      release.resolve();
      await expect(list.getByRole('alert')).toContainText('Meal log refused');
      await expect(list).toBeFocused();
      if (useVariant) await expect(walnuts).toBeChecked();
      else await expect(row).toBeEnabled();
      expect(writes).toEqual([{ method: 'POST', body: {
        date, mealTime: 'morning', templateId: template.id, variantNames: useVariant ? ['Walnuts'] : [],
        operationId: expect.any(String),
      } }]);
    } finally {
      release.resolve();
    }
  });
}

for (const moveFocus of [false, true]) {
  test(`Health refreshes the replacement meal list after a late proposal change with focus on ${moveFocus ? 'Close' : 'the removed action'}`, async ({ page, baseURL }) => {
    const pending = Promise.withResolvers();
    const release = Promise.withResolvers();
    const calls = [];
    const confirming = Promise.withResolvers();
    const readback = Promise.withResolvers();
    let reads = 0;
    let current = [{ ...templates[0], status: 'proposed' }, templates[1]];
    await startHealth(page, baseURL);
    await page.route(`**${templatePath}?*`, async route => {
      calls.push(route.request().method());
      if (++reads === 3) {
        confirming.resolve();
        await readback.promise;
      }
      return route.fulfill({ json: { templates: current } });
    });
    await page.route(`**${templatePath}/breakfast/approve`, async route => {
      calls.push(route.request().method());
      pending.resolve();
      await release.promise;
      current = templates;
      return route.fulfill({ json: { ok: true } });
    });

    try {
      await page.goto('/health?date=' + date);
      await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Meals & templates', exact: true });
      const keep = dialog.getByRole('button', { name: 'Keep', exact: true });
      await keep.press('Enter');
      await pending.promise;
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: 'Saved meals for Lunch', exact: true }).press('Enter');
      await expect(keep).toBeEnabled();
      const close = dialog.getByRole('button', { name: 'Close', exact: true });
      await keep.focus();
      release.resolve();
      await confirming.promise;
      await expect(keep).toBeDisabled();
      await expect(keep).toBeFocused();
      if (moveFocus) await close.focus();
      readback.resolve();
      await expect(dialog.getByRole('button', { name: 'Edit Breakfast oats', exact: true })).toBeEnabled();
      await expect(keep).toHaveCount(0);
      const list = dialog.getByRole('region', { name: 'Saved meals', exact: true });
      await expect(moveFocus ? close : list).toBeFocused();
      expect(calls).toEqual(['GET', 'POST', 'GET', 'GET']);
    } finally {
      release.resolve();
      readback.resolve();
    }
  });
}

test('Health keeps a focused proposal action when the foreground read retains it', async ({ page, baseURL }) => {
  const pending = Promise.withResolvers();
  const release = Promise.withResolvers();
  const methods = [];
  await startHealth(page, baseURL);
  await page.route(`**${templatePath}?*`, async route => {
    methods.push(route.request().method());
    if (methods.length > 1) {
      pending.resolve();
      await release.promise;
    }
    return route.fulfill({ json: { templates: [{ ...templates[0], status: 'proposed' }] } });
  });
  await page.route(`**${templatePath}/breakfast/approve`, route => {
    methods.push(route.request().method());
    return route.fulfill({ json: { ok: true } });
  });

  try {
    await page.goto('/health?date=' + date);
    await page.getByRole('button', { name: 'Saved meals for Breakfast', exact: true }).press('Enter');
    const list = page.getByRole('region', { name: 'Saved meals', exact: true });
    const keep = list.getByRole('button', { name: 'Keep', exact: true });
    await keep.focus();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await pending.promise;
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await expect(keep).toBeDisabled();
    await expect(keep).toBeFocused();
    await page.keyboard.press('Enter');
    expect(methods).toEqual(['GET', 'GET']);
    release.resolve();
    await expect(keep).toBeEnabled();
    await expect(keep).toBeFocused();
    expect(methods).toEqual(['GET', 'GET']);
  } finally {
    release.resolve();
  }
});
