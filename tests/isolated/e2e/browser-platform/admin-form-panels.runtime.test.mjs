import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const shopping = { shopping: { retailers: [{ name: 'Corner Store', id: 'corner' }] } };

async function installFixtures(page) {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    let json = {};
    if (pathname.endsWith('/supervision/bootstrap')) json = { enabled: false };
    else if (pathname.endsWith('/members/fixture')) json = { member: { username: 'fixture', display_name: 'Fixture Member' } };
    else if (pathname.endsWith('/devices/fixture')) json = { device: { id: 'fixture', type: 'linux-pc' } };
    else if (pathname.endsWith('/harvest/config.yml')) json = { parsed: shopping };
    else if (pathname.includes('/config/files/')) json = { parsed: {} };
    return route.fulfill({ json });
  });
}

async function expectPanelSurface(card) {
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('padding', '20px 24px');
  await expect(card).toHaveCSS('border-radius', '8px');
  await expect(card).toHaveCSS('background-color', 'rgb(26, 29, 40)');
  await expect(card).toHaveCSS('border-left', '1px solid rgb(42, 46, 61)');
  const { x, width: panelWidth } = await card.boundingBox();
  const main = await card.locator('xpath=ancestor::main[1]').boundingBox();
  expect(x).toBeGreaterThanOrEqual(main.x);
  expect(x + panelWidth).toBeLessThanOrEqual(main.x + main.width);
}

async function expectTitledPanel(page, name) {
  const heading = page.getByRole('heading', { name, exact: true });
  await expect(heading).toHaveCSS('font-size', '13px');
  await expect(heading).toHaveCSS('font-family', /JetBrains Mono/);
  await expect(heading.locator('..')).toHaveCSS('margin-bottom', '16px');
  await expectPanelSurface(heading.locator('xpath=ancestor::section[1]'));
}

for (const width of [390, 1440]) {
  test.describe(`Admin form panels at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });

    test('household and configuration forms expose semantic headings on the existing panel surface', async ({ page }) => {
      await installFixtures(page);
      await page.goto('/admin/household/members/fixture');
      for (const [tab, headings] of [
        ['Identities', ['Telegram']],
        ['Nutribot', ['Nutrition Goals']],
        ['Fitness', ['Heart Rate Zone Overrides']],
        ['Auth', ['Roles', 'Auth Status', 'Invite Link']],
      ]) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        for (const name of headings) await expectTitledPanel(page, name);
      }
      for (const [path, headings] of [
        ['/admin/household/devices/fixture', ['General', 'OS Control']],
        ['/admin/apps/finance', ['Buxfer Integration', 'ClickUp Integration']],
        ['/admin/apps/gratitude', ['Categories', 'Display', 'Snapshots']],
      ]) {
        await page.goto(path);
        for (const name of headings) await expectTitledPanel(page, name);
      }
    });

    test('a retailer card keeps its editable fields, keyboard order and delete confirmation', async ({ page }) => {
      await installFixtures(page);
      await page.goto('/admin/apps/shopping');
      const name = page.getByRole('textbox', { name: 'Name', exact: true });
      await expect(name).toHaveValue('Corner Store');
      await expectPanelSurface(name.locator('xpath=ancestor::section[1]'));
      await name.fill('Fixture Market');
      await expect(name).toBeFocused();
      await name.press('Tab');
      await expect(page.getByRole('textbox', { name: 'ID', exact: true })).toBeFocused();
      const deleteRetailer = page.getByRole('button', { name: 'Delete retailer', exact: true });
      await deleteRetailer.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Fixture Market');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(name).toHaveValue('Fixture Market');
      await expect(deleteRetailer).toBeFocused();
      await deleteRetailer.click();
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(name).toHaveCount(0);
      await expect(page.getByText(/No retailers configured/)).toBeVisible();
    });

    test('config acknowledgement preserves typing during save and advances Revert', async ({ page }) => {
      await installFixtures(page);
      let acknowledge;
      let submitted;
      const hold = new Promise(resolve => { acknowledge = resolve; });
      await page.route('**/api/v1/admin/config/files/household/harvest/config.yml', async route => {
        if (route.request().method() !== 'PUT') return route.fallback();
        submitted = route.request().postDataJSON();
        await hold;
        return route.fulfill({ json: { parsed: { shopping: { retailers: [{ name: 'Saved Market', id: 'corner' }] } } } });
      });
      await page.goto('/admin/apps/shopping');
      const name = page.getByRole('textbox', { name: 'Name', exact: true });
      const save = page.getByTestId('config-save-button');
      await name.fill('Submitted Market');
      await save.click();
      try {
        await expect.poll(() => submitted?.parsed.shopping.retailers[0].name).toBe('Submitted Market');
        await expect(save).toBeDisabled();
        await name.fill('Newer Draft');
      } finally {
        acknowledge();
      }
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await expect(name).toHaveValue('Newer Draft');
      await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Revert', exact: true }).click();
      await expect(name).toHaveValue('Saved Market');
      await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
    });
  });
}

test('an Admin app preview owns its exact WebSocket topic while open', async ({ page }) => {
  const topic = 'diagnostic:browser-lifecycle-fixture';
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/socket-fixture', route => route.fulfill({
    json: {
      name: 'socket-fixture',
      sections: [{
        title: 'Diagnostics',
        items: [{
          uid: 'socket-preview',
          label: 'Socket diagnostic',
          action: 'Open',
          input: `app:websocket/${topic}`,
        }],
      }],
    },
  }));

  const commands = [];
  const topicSockets = new Set();
  const closedSockets = new Set();
  const scopedPaths = [];
  await page.routeWebSocket(url => url.pathname.startsWith('/ws/'), socket => {
    scopedPaths.push(new URL(socket.url()).pathname);
  });
  await page.routeWebSocket(url => url.pathname === '/ws', socket => {
    socket.onClose(() => closedSockets.add(socket));
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type !== 'bus_command' || !message.topics?.includes(topic)) return;
      topicSockets.add(socket);
      commands.push(message.action);
      if (message.action === 'subscribe') {
        socket.send(JSON.stringify({ topic: 'diagnostic:other', type: topic, marker: 'Unrelated diagnostic' }));
        socket.send(JSON.stringify({ topic, type: 'diagnostic', marker: `Diagnostic subscription ${commands.length}` }));
      }
    });
  });

  await page.goto('/admin/content/lists/menus/socket-fixture');
  const preview = page.getByTitle('Preview app', { exact: true });
  const dialog = page.getByRole('dialog', { name: 'Socket diagnostic' });

  await preview.click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => ({ commands, scopedPaths })).toEqual({ commands: ['subscribe'], scopedPaths: [] });
  await expect(dialog.getByText(/Diagnostic subscription 1/)).toBeVisible();
  await expect(dialog.getByText(/Unrelated diagnostic/)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => commands).toEqual(['subscribe', 'unsubscribe']);

  await preview.click();
  await expect(dialog.getByText(/Diagnostic subscription 3/)).toBeVisible();
  await expect(dialog.getByText(/Diagnostic subscription 1|Unrelated diagnostic/)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => commands).toEqual(['subscribe', 'unsubscribe', 'subscribe', 'unsubscribe']);
  expect(scopedPaths).toEqual([]);
  expect(topicSockets.size).toBe(1);
  for (const socket of topicSockets) expect(closedSockets.has(socket)).toBe(false);
});
