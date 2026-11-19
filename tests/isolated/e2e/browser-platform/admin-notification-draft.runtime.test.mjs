import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const pagePath = '/admin/system/notifications';
const settingsPath = '/api/v1/admin/notifications';
const initial = {
  quiet_hours: { enabled: true, start: '21:00', end: '07:00' },
  cooldowns: { ceremony: 1200, default: 60 },
};

async function mockNotifications(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const writes = [];
  let heldSave;

  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === settingsPath) {
      if (request.method() === 'GET') return route.fulfill({ json: initial });
      if (request.method() === 'PUT') {
        writes.push(request.postDataJSON());
        heldSave = route;
        return;
      }
      return route.fulfill({ status: 405 });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto(pagePath);
  return {
    writes,
    acknowledge: config => heldSave.fulfill({ json: config }),
    start: page.getByRole('textbox', { name: 'Start', exact: true }),
    end: page.getByRole('textbox', { name: 'End', exact: true }),
    save: page.getByRole('button', { name: 'Save', exact: true }),
    unsaved: page.getByText('Unsaved', { exact: true }),
    discard: page.getByRole('dialog', { name: 'Discard unsaved changes?' }),
    devices: page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Devices', exact: true }),
  };
}

test('Admin Notifications guards unsaved navigation and rebases edits onto the confirmed save', async ({ page, baseURL }) => {
  const { writes, acknowledge, start, end, save, unsaved, discard, devices } = await mockNotifications(page, baseURL);
  await expect(start).toHaveValue('21:00');
  await start.fill('20:00');
  await devices.click();
  await expect(discard).toBeVisible();
  await expect(page).toHaveURL(pagePath);
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(start).toHaveValue('20:00');
  await expect(unsaved).toBeVisible();

  await save.focus();
  await page.keyboard.press('Control+s');
  await expect.poll(() => writes).toEqual([{ ...initial, quiet_hours: { ...initial.quiet_hours, start: '20:00' } }]);
  await expect(save).toBeDisabled();
  await end.fill('08:30');
  const confirmed = { ...initial, quiet_hours: { ...initial.quiet_hours, start: '20:15' } };
  await acknowledge(confirmed);
  await expect(save).toBeEnabled();
  await expect(end).toHaveValue('08:30');
  await expect(unsaved).toBeVisible();

  await save.click();
  const second = { ...confirmed, quiet_hours: { ...confirmed.quiet_hours, end: '08:30' } };
  await expect.poll(() => writes).toEqual([
    { ...initial, quiet_hours: { ...initial.quiet_hours, start: '20:00' } },
    second,
  ]);
  await acknowledge(second);
  await expect(unsaved).toHaveCount(0);
  await expect(save).toBeDisabled();
  await end.fill('09:00');

  const revert = page.getByRole('button', { name: 'Revert', exact: true });
  await revert.focus();
  await page.keyboard.press('Control+z');
  await expect(start).toHaveValue('20:15');
  await expect(end).toHaveValue('08:30');
  await expect(unsaved).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(writes).toHaveLength(2);
  await devices.click();
  await expect(page).toHaveURL('/admin/household/devices');
  await expect(discard).toHaveCount(0);
});

test('Admin Notifications guards a draft that matches the old baseline during a pending save', async ({ page, baseURL }) => {
  const { writes, acknowledge, start, save, unsaved, discard, devices } = await mockNotifications(page, baseURL);
  await start.fill('20:00');
  await save.click();
  await expect.poll(() => writes).toHaveLength(1);
  await expect(save).toBeDisabled();

  await start.fill('21:00');
  await devices.click();
  await expect(discard).toBeVisible();
  await expect(page).toHaveURL(pagePath);
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await acknowledge(writes[0]);
  await expect(start).toHaveValue('21:00');
  await expect(unsaved).toBeVisible();
  await expect(save).toBeEnabled();
});
