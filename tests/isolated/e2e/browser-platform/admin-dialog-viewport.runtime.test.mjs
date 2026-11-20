import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 850 }, hasTouch: true, serviceWorkers: 'block' });

const schedulerPath = '/api/v1/admin/scheduler/jobs';
const job = { id: 'fixture', name: 'Fixture Job', module: 'fixture.mjs', schedule: '0 * * * *' };
const dialogs = [
  {
    route: '/admin/household/members',
    open: 'Add Member',
    fields: { Username: 'fixture', 'Birth Year': '2000' },
    submit: 'Add Member',
    method: 'POST',
    writePath: '/api/v1/admin/household/members',
    body: { username: 'fixture' },
  },
  {
    route: '/admin/system/scheduler',
    open: 'Create Job',
    fields: { ID: job.id, Name: job.name, Schedule: job.schedule },
    submit: 'Create',
    method: 'POST',
    writePath: schedulerPath,
    body: { id: job.id, schedule: job.schedule },
  },
  {
    route: '/admin/household/devices',
    open: 'Add Device',
    fields: { 'Device ID': 'fixture' },
    submit: 'Add Device',
    method: 'POST',
    writePath: '/api/v1/admin/household/devices',
    body: { id: 'fixture' },
  },
  {
    route: '/admin/system/scheduler/fixture',
    open: 'Edit',
    fields: { 'Window (minutes)': '12' },
    submit: 'Save',
    method: 'PUT',
    writePath: `${schedulerPath}/${job.id}`,
    body: { window: 12 },
  },
];

for (const fixture of dialogs) {
  test(`${fixture.open} keeps its action reachable in the keyboard viewport`, async ({ page }) => {
    const writes = [];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === fixture.writePath && request.method() === fixture.method) {
        writes.push(request.postDataJSON());
      }
      if (pathname === `${schedulerPath}/${job.id}`) return route.fulfill({ json: { job } });
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    await page.goto(fixture.route);
    const opener = page.getByRole('button', { name: fixture.open, exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: fixture.submit, exact: true });
    await submit.click({ trial: true });
    for (const [name, value] of Object.entries(fixture.fields)) {
      await dialog.getByLabel(name).fill(value);
      await expect(dialog.getByLabel(name)).toBeFocused();
    }
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      for (const [key, value] of Object.entries({ height: 330, offsetTop: 30 })) {
        Object.defineProperty(viewport, key, { configurable: true, value });
      }
      viewport.dispatchEvent(new Event('resize'));
    });
    await submit.evaluate(element => element.scrollIntoView({ block: 'nearest' }));
    await expect.poll(() => submit.evaluate(element => {
      const { top, bottom } = element.getBoundingClientRect();
      const { offsetTop, height } = window.visualViewport;
      return Math.max(offsetTop - top, bottom - offsetTop - height);
    }), { message: 'the full submit button fits inside the visible viewport' }).toBeLessThanOrEqual(1);
    await submit.tap();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeEnabled();
    await expect(page).toHaveURL(new URL(fixture.route, page.url()).href);
    expect(writes).toEqual([expect.objectContaining(fixture.body)]);
  });
}

test('the member type list consumes Escape before the dialog closes', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/admin/household/members');
  const opener = page.getByRole('button', { name: 'Add Member' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/admin\/household\/members$/);
});
