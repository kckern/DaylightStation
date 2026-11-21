import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const member = { username: 'amy', displayName: 'Amy' };
const beliefsPath = '/api/v1/life/plan/beliefs';
const today = '2026-11-19';

async function loadBeliefs(page, baseURL, write, read = (route, beliefs) => route.fulfill({ json: { beliefs } })) {
  const origin = new URL(baseURL).origin;
  const beliefs = [
    { id: 'first', if_hypothesis: 'First hypothesis', state: 'testing', evidence_history: [] },
    { id: 'second', if_hypothesis: 'Second hypothesis', state: 'testing', evidence_history: [] },
  ];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname === '/api/v1/life/users') return route.fulfill({ json: { users: [member] } });
    if (pathname === '/api/v1/life/user') return route.fulfill({ json: member });
    if (pathname === beliefsPath) return read(route, beliefs);
    if (pathname.startsWith(beliefsPath) && request.method() === 'POST') {
      const id = pathname.split('/').at(-2);
      const body = request.postDataJSON();
      return write(route, { id, member: searchParams.get('username'), body }, () => {
        beliefs.find(belief => belief.id === id).evidence_history.push(body);
      });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.clock.setFixedTime(new Date(today + 'T16:00:00Z'));
  await page.goto('/life/plan/beliefs');
  const openers = page.getByRole('button', { name: 'Add Evidence', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Add Evidence', exact: true });
  return {
    first: openers.nth(0),
    second: openers.nth(1),
    dialog,
    type: dialog.getByRole('textbox', { name: 'Type', exact: true }),
    note: dialog.getByRole('textbox', { name: 'Note', exact: true }),
    submit: dialog.getByRole('button', { name: 'Submit', exact: true }),
  };
}

test('Life Beliefs discards a closed evidence draft before opening another belief', async ({ page, baseURL }) => {
  const { first, second, dialog, type, note } = await loadBeliefs(page, baseURL, () => {
    throw new Error('Discarding a draft must not submit evidence');
  });
  await first.press('Enter');
  await note.fill('Private to the first hypothesis');
  const option = page.getByText('Disconfirmation', { exact: true });
  await type.click();
  await expect(option).toBeVisible();
  await type.press('Escape');
  await expect(option).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(type).toBeFocused();
  await type.click();
  await option.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(first).toBeFocused();
  await second.press('Enter');
  await expect(note).toHaveValue('');
  await expect(type).toHaveValue('Confirmation');
});

test('Life Beliefs keeps a replacement evidence sheet through the preceding save and its refresh', async ({ page, baseURL }) => {
  const writes = [];
  const release = Promise.withResolvers();
  const { first, second, dialog, note, submit } = await loadBeliefs(page, baseURL, async (route, write, record) => {
    writes.push(write);
    if (writes.length === 1) {
      await release.promise;
      record();
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ status: 422, json: { error: 'Evidence rejected' } });
  });
  const original = { id: 'first', member: 'amy', body: { type: 'confirmation', note: 'Saved on the first belief', date: today } };
  const replacement = { id: 'second', member: 'amy', body: { type: 'confirmation', note: 'Draft on the second belief', date: today } };

  try {
    await first.press('Enter');
    await note.fill(original.body.note);
    await submit.press('Enter');
    await expect.poll(() => writes).toEqual([original]);
    const pending = dialog.getByRole('button', { name: 'Submitting…', exact: true });
    await expect(pending).toBeFocused();
    await pending.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(first).toBeFocused();

    const originalOpener = await second.elementHandle();
    await second.press('Enter');
    await note.fill(replacement.body.note);
    release.resolve();
    await expect(page.getByText(original.body.note, { exact: true })).toBeVisible();
    expect(await originalOpener.evaluate(node => node.isConnected)).toBe(true);
    await expect(dialog).toBeVisible();
    await expect(note).toHaveValue(replacement.body.note);

    await submit.press('Enter');
    await expect.poll(() => writes).toEqual([original, replacement]);
    await expect(dialog.getByRole('alert')).toContainText('Evidence rejected');
    await expect(note).toHaveValue(replacement.body.note);
    await expect(submit).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(second).toBeFocused();
  } finally {
    release.resolve();
  }
});


test('Life Beliefs retains the replacement evidence opener through a failed refresh and retry', async ({ page, baseURL }) => {
  const release = Promise.withResolvers();
  let writes = 0;
  let reads = 0;
  const saved = 'Evidence from the first belief';
  const draft = 'Draft for the second belief';
  const { first, second, dialog, note, submit } = await loadBeliefs(page, baseURL, async (route, _write, record) => {
    writes++;
    await release.promise;
    record();
    return route.fulfill({ json: {} });
  }, (route, beliefs) => {
    if (++reads === 2) return route.fulfill({ status: 404, json: { error: 'Beliefs refresh failed' } });
    return route.fulfill({ json: { beliefs } });
  });

  try {
    await first.press('Enter');
    await note.fill(saved);
    await submit.press('Enter');
    await expect.poll(() => writes).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const opener = await second.elementHandle();
    await second.press('Enter');
    await note.fill(draft);
    release.resolve();
    await expect(page.getByText('Beliefs refresh failed', { exact: false })).toBeAttached();
    await expect(note).toHaveValue(draft);
    expect(await opener.evaluate(node => node.isConnected)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(second).toBeFocused();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await opener.evaluate(node => node.isConnected)).toBe(true);
    expect(reads).toBe(3);
    expect(writes).toBe(1);
  } finally {
    release.resolve();
  }
});
