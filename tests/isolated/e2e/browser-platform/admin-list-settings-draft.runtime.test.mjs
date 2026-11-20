import { expect, test } from '@playwright/test';

const index = '/admin/content/lists/menus';
const folder = index + '/family-picks';
const api = '/api/v1' + folder;

test.use({ serviceWorkers: 'block' });

async function mountSettings(page, kind, { beforeWrite, beforeRead, beforeOpen, fromIndex = false } = {}) {
  const isList = kind === 'list';
  const methods = [];
  const writes = [];
  let reads = 0;
  let list = {
    name: 'family-picks', title: 'Family Picks', description: 'Original description',
    metadata: { active: true, group: 'Evenings' },
    sections: [{ title: 'Tonight', priority: 2, items: [{ uid: 'fixture', label: 'Watch this', action: 'Play', input: 'plex:123' }] }],
  };
  const saved = () => list;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === api) {
      methods.push(route.request().method());
      if (await beforeRead?.(++reads) === false) {
        return route.fulfill({ status: 409, json: { error: 'Refused snapshot' } });
      }
      return route.fulfill({ json: list });
    }
    if (pathname === api + (isList ? '/settings' : '/sections/0')) {
      methods.push(route.request().method());
      const payload = route.request().postDataJSON();
      writes.push(payload);
      if (await beforeWrite?.(writes.length) === false) {
        return route.fulfill({ status: 409, json: { error: 'Refused write' } });
      }
      if (isList) {
        const { title = list.title, description = list.description, ...settings } = payload;
        list = { ...list, title, description: writes.length === 1 ? 'Confirmed description' : description,
          metadata: { ...list.metadata, ...settings } };
        return route.fulfill({ json: list });
      }
      const section = { ...list.sections[0], ...payload };
      if (writes.length === 1) section.priority = 9;
      list = { ...list, sections: [section] };
      return route.fulfill({ json: { ok: true, sectionIndex: 0 } });
    }
    if (pathname === api + '/items/0') {
      methods.push(route.request().method());
      Object.assign(list.sections[0].items[0], route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/v1' + index) {
      return route.fulfill({ json: { lists: [{ name: 'family-picks' }, { name: 'other-list' }] } });
    }
    if (pathname === '/api/v1' + index + '/other-list') {
      return route.fulfill({ json: { name: 'other-list', title: 'Other list', sections: [] } });
    }
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: {} });
  });
  await page.goto(fromIndex ? index : folder);
  if (fromIndex) await page.getByRole('link', { name: /Family Picks/ }).click();
  await beforeOpen?.();
  const open = async (name = 'Tonight') => {
    const trigger = page.getByRole('button', { name: isList ? 'List actions' : `Section actions for ${name}`, exact: true });
    await trigger.press('Enter');
    await page.getByRole('menuitem', { name: isList ? 'Menu Settings' : 'Section Settings', exact: true }).click();
  };
  await open();
  const dialog = page.getByRole('dialog', { name: isList ? 'List Settings' : /^Section Settings:/ });
  return {
    dialog, open, methods, writes, saved,
    title: dialog.getByLabel('Title', { exact: true }),
    save: dialog.getByRole('button', { name: isList ? 'Save Settings' : 'Save Section', exact: true }),
  };
}

for (const kind of ['list', 'section']) {
  test(`Admin ${kind} settings persist a later reset to the default`, async ({ page }) => {
    const writing = Promise.withResolvers();
    const release = Promise.withResolvers();
    const { dialog, open, title, save, writes, saved } = await mountSettings(page, kind, {
      async beforeWrite(number) {
        if (number !== 1) return;
        writing.resolve();
        await release.promise;
      },
    });
    const isList = kind === 'list';
    const toggle = dialog.getByRole('switch', { name: isList ? /^Active\b/ : /^Shuffle$/ });
    const defaultValue = isList;

    try {
      await title.fill('Changed title');
      await toggle.press('Space');
      await expect(toggle).toHaveJSProperty('checked', !defaultValue);
      await save.press('Enter');
      await writing.promise;
      await toggle.press('Space');
      await expect(toggle).toHaveJSProperty('checked', defaultValue);
      if (isList) await dialog.getByLabel('Group', { exact: true }).fill('Weekend');
      release.resolve();

      await expect(save).toBeEnabled();
      await expect(toggle).toHaveJSProperty('checked', defaultValue);
      await save.press('Enter');
      await expect(dialog).toBeHidden();
      const key = isList ? 'active' : 'shuffle';
      expect(writes.map(write => write[key])).toEqual([!defaultValue, defaultValue]);
      expect((isList ? saved().metadata : saved().sections[0])[key]).toBe(defaultValue);
      if (isList) expect(saved().metadata.group).toBe('Weekend');
      await open('Changed title');
      await expect(toggle).toHaveJSProperty('checked', defaultValue);
    } finally {
      release.resolve();
    }
  });
}

for (const kind of ['list', 'section']) {
  test(`Admin ${kind} settings retain later edits and accept untouched confirmed values`, async ({ page }) => {
    await page.setViewportSize({ width: kind === 'list' ? 390 : 1440, height: 850 });
    const writing = Promise.withResolvers();
    const releaseWrite = Promise.withResolvers();
    const confirming = Promise.withResolvers();
    const releaseRead = Promise.withResolvers();
    const { dialog, open, title, save, writes, methods } = await mountSettings(page, kind, {
      async beforeWrite(number) {
        if (number !== 1) return;
        writing.resolve();
        await releaseWrite.promise;
      },
      async beforeRead(number) {
        if (number !== 2) return;
        confirming.resolve();
        await releaseRead.promise;
      },
    });

    try {
      await title.fill('Submitted title');
      await save.press('Enter');
      await writing.promise;
      expect.soft(await save.evaluate(node => node === document.activeElement)).toBe(true);
      await dialog.locator('form').evaluate(form => form.requestSubmit());
      await title.fill('Edited during write');
      releaseWrite.resolve();

      const later = kind === 'list' ? 'Edited during write' : 'Edited during readback';
      if (kind === 'section') {
        await confirming.promise;
        await title.fill(later);
        releaseRead.resolve();
        await expect(dialog.getByLabel('Priority', { exact: true })).toHaveValue('9');
      } else {
        await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Confirmed description');
      }
      await expect(title).toHaveValue(later);
      await expect(title).toBeFocused();
      await expect(save).toBeEnabled();
      expect(writes).toHaveLength(1);
      await save.press('Enter');
      await expect(dialog).toBeHidden();
      expect(writes[1]).toMatchObject(kind === 'list'
        ? { title: later, description: 'Confirmed description', group: 'Evenings' }
        : { title: later, priority: 9 });
      expect(methods).toEqual(kind === 'list' ? ['GET', 'PUT', 'PUT'] : ['GET', 'PUT', 'GET', 'PUT', 'GET']);

      await open(later);
      await expect(title).toHaveValue(later);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    } finally {
      releaseWrite.resolve();
      releaseRead.resolve();
    }
  });
}

test('Admin section settings retry only a refused confirmation read inside the edited dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const confirming = Promise.withResolvers();
  const refuse = Promise.withResolvers();
  const retrying = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { dialog, title, save, writes, methods } = await mountSettings(page, 'section', {
    async beforeRead(number) {
      if (number === 2) {
        confirming.resolve();
        await refuse.promise;
        return false;
      }
      if (number === 3) {
        retrying.resolve();
        await release.promise;
      }
    },
  });

  try {
    await title.fill('Acknowledged title');
    await save.press('Enter');
    await confirming.promise;
    const priority = dialog.getByLabel('Priority', { exact: true });
    await priority.fill('5');
    refuse.resolve();
    const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await expect(title).toHaveValue('Acknowledged title');
    await expect(priority).toHaveValue('5');
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await dialog.locator('form').evaluate(form => form.requestSubmit());
    expect(writes).toHaveLength(1);
    await retry.press('Enter');
    await retrying.promise;
    const recovery = dialog.getByRole('region', { name: 'Section settings recovery' });
    await expect(recovery).toBeFocused();
    await expect(recovery).toHaveAttribute('aria-busy', 'true');
    await title.fill('Draft edited during recovery');
    release.resolve();
    await expect(retry).toHaveCount(0);
    await expect(title).toHaveValue('Draft edited during recovery');
    await expect(priority).toHaveValue('5');
    await expect(title).toBeFocused();
    await expect(save).toBeEnabled();
    expect(methods).toEqual(['GET', 'PUT', 'GET', 'GET']);
    await save.press('Enter');
    await expect(dialog).toBeHidden();
    expect(writes[1]).toEqual({ title: 'Draft edited during recovery', priority: 5 });
  } finally {
    refuse.resolve();
    release.resolve();
  }
});

test('Admin list settings retain the draft after a refused PUT', async ({ page }) => {
  const { dialog, title, save, writes, methods, saved } = await mountSettings(page, 'list', {
    beforeWrite: number => number !== 1,
  });
  await title.fill('First title');
  await save.press('Enter');
  await expect(dialog.getByText('Refused write', { exact: false })).toBeVisible();
  await expect(title).toHaveValue('First title');
  await expect(save).toBeFocused();
  expect(saved().title).toBe('Family Picks');
  await title.fill('Retried title');
  await save.press('Enter');
  await expect(dialog).toBeHidden();
  expect(writes.map(write => write.title)).toEqual(['First title', 'Retried title']);
  expect(methods).toEqual(['GET', 'PUT', 'PUT']);
});

test('Admin list settings recover a failed shared read without dismissing a draft', async ({ page }) => {
  const confirming = Promise.withResolvers();
  const refuse = Promise.withResolvers();
  const { dialog, title, save, writes, methods } = await mountSettings(page, 'list', {
    async beforeRead(number) {
      if (number !== 2) return;
      confirming.resolve();
      await refuse.promise;
      return false;
    },
    async beforeOpen() {
      const label = page.getByTestId('item-row-0-0').locator('.col-label');
      await label.getByText('Watch this').click();
      const input = label.getByRole('textbox');
      await input.fill('Updated item');
      await input.press('Enter');
      await confirming.promise;
    },
  });

  try {
    await title.fill('Still editing settings');
    refuse.resolve();
    const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
    await retry.press('Enter');
    await expect(save).toBeEnabled();
    await expect(title).toHaveValue('Still editing settings');
    expect(writes).toHaveLength(0);
    expect(methods).toEqual(['GET', 'PUT', 'GET', 'GET']);
  } finally {
    refuse.resolve();
  }
});

test('Admin retires the old settings dialog when navigating while a save settles', async ({ page }) => {
  const writing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { dialog, open, title, save, writes } = await mountSettings(page, 'list', {
    fromIndex: true,
    async beforeWrite() {
      writing.resolve();
      await release.promise;
    },
  });

  try {
    await title.fill('Save on the old list');
    await save.press('Enter');
    await writing.promise;
    await page.goBack();
    await expect(dialog).toBeHidden();
    await page.getByRole('link', { name: /Other List/ }).click();
    await open();
    await expect(title).toHaveValue('Other list');
    await title.fill('Keep the new draft');
    const settled = page.waitForResponse(response => new URL(response.url()).pathname === api + '/settings');
    release.resolve();
    expect((await settled).ok()).toBe(true);
    await expect(title).toHaveValue('Keep the new draft');
    await expect(title).toBeFocused();
    await expect(save).toBeEnabled();
    expect(writes).toEqual([expect.objectContaining({ title: 'Save on the old list' })]);
  } finally {
    release.resolve();
  }
});
