import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

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
      await save.focus();
      await page.keyboard.press('Control+s');
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

for (const action of ['Play', 'Queue']) test(`Admin keeps the selected screen preview inside its modal while resizing during playback (${action})`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/preview-fixture', route => route.fulfill({ json: {
    name: 'preview-fixture', sections: [{ items: [{ uid: 'preview', label: 'Preview song', action, input: 'plex:42' }] }],
  } }));
  await page.route('**/api/v1/screens', route => route.fulfill({ json: { screens: [
    { id: 'living-room', name: 'Living room', resolution: { width: 960, height: 540 } },
    { id: 'portal', name: 'Portal', resolution: { width: 1280, height: 800 } },
  ] } }));
  await page.route('**/preview-song.wav', route => route.fulfill({ contentType: 'audio/wav', body: silentWave(30) }));
  const song = {
    id: 'plex:42', contentId: 'plex:42', title: 'Preview song', format: 'audio', mediaType: 'audio', mediaUrl: '/preview-song.wav', duration: 30,
  };
  await page.route(url => decodeURIComponent(url.pathname) === '/api/v1/play/plex:42', route => route.fulfill({ json: song }));
  const queue = Promise.withResolvers();
  if (action === 'Queue') {
    await page.addInitScript(() => localStorage.setItem('daylight.adminPreview.screenId', 'portal'));
    await page.route(url => decodeURIComponent(url.pathname) === '/api/v1/queue/plex:42', async route => {
      await queue.promise;
      return route.fulfill({ json: { items: [song] } });
    });
  }

  await page.goto('/admin/content/lists/menus/preview-fixture');
  const screens = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/screens');
  await page.getByTitle('Preview', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview song' });
  if (action === 'Queue') {
    try {
      await expect(dialog.getByText('Loading queue...')).toBeVisible();
      expect(await (await screens).finished()).toBeNull();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally {
      queue.resolve();
    }
  } else {
    await screens;
  }
  const picker = dialog.getByLabel('Preview at screen');
  if (action === 'Play') await picker.selectOption('portal');
  await expect(picker).toHaveValue('portal');
  const frame = dialog.locator('.admin-preview-player__video');
  const geometry = () => frame.evaluate(element => {
    const outer = element.getBoundingClientRect();
    const modal = element.closest('[role="dialog"]').getBoundingClientRect();
    const availableWidth = element.parentElement.getBoundingClientRect().width;
    const inner = element.firstElementChild;
    const rendered = inner.getBoundingClientRect();
    const kiosk = getComputedStyle(inner);
    return {
      fits: outer.left >= 0 && outer.right <= innerWidth && outer.left >= modal.left && outer.right <= modal.right + 1,
      aspect: Math.abs(outer.height - outer.width * 800 / 1280) <= 1,
      filled: Math.abs(outer.width - rendered.width) <= 1,
      usesAvailable: Math.abs(outer.width - Math.min(960, availableWidth)) <= 1,
      kioskWidth: Number.parseFloat(kiosk.width),
      kioskHeight: Number.parseFloat(kiosk.height),
      width: Math.round(outer.width),
    };
  });
  const expectedFrame = {
    fits: true,
    aspect: true,
    filled: true,
    usesAvailable: true,
    kioskWidth: expect.closeTo(1280, 1),
    kioskHeight: expect.closeTo(800, 1),
  };
  await expect.poll(geometry).toMatchObject(expectedFrame);
  expect((await geometry()).width).toBeLessThan(390);

  const audio = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(el => el.currentSrc.endsWith('preview-song.wav') && !el.paused && el.currentTime > 0), null, { timeout: 10000 });
  const before = await audio.evaluate(el => el.currentTime);
  for (const width of [320, 768, 1200]) {
    await page.setViewportSize({ width, height: 850 });
    await expect.poll(geometry).toMatchObject(expectedFrame);
  }
  await page.setViewportSize({ width: 1440, height: 850 });
  await expect(picker).toHaveValue('portal');
  await expect.poll(geometry).toMatchObject(expectedFrame);
  expect((await geometry()).width).toBeGreaterThan(900);
  await expect.poll(() => audio.evaluate(el => el.isConnected && !el.paused ? el.currentTime : -1)).toBeGreaterThan(before);
});

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

test('an Admin Party Games preview refreshes its active projection from the shared gaming topic', async ({ page }) => {
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/party-game-fixture', route => route.fulfill({
    json: {
      name: 'party-game-fixture',
      sections: [{ title: 'Games', items: [{ uid: 'dice-preview', label: 'Dice preview', action: 'Open', input: 'app:party-games/dice:fixture?autostart=true&participants=alice' }] }],
    },
  }));
  await page.route('**/api/v1/gaming/environments/party-games/profile', route => route.fulfill({
    json: { household_members: [{ id: 'alice', name: 'Alice' }], team_presets: [] },
  }));
  await page.route('**/api/v1/gaming/environments/party-games/catalog', route => route.fulfill({
    json: { entries: [{ content_id: 'dice:fixture', definition_id: 'dice:fixture', experience_id: 'polyhedral-dice', presenter_id: 'polyhedral-dice', setup: 'individuals', setup_profile: { kind: 'individuals' }, launch: { autostart: true, participants: ['alice'] }, valid: true }] },
  }));
  const stateForRead = (read) => ({
    header: { session_id: 'game:fixture', revision: read, experience: { id: 'polyhedral-dice' }, seats: [{ id: 'alice', name: 'Alice' }] },
    definition: { id: 'dice:fixture', title: 'Dice fixture', presets: ['1d6'], default_notation: '1d6' },
    state: { notation: '1d6', roll_count: read, outcome: read > 1 ? { notation: '1d6', total: 7 } : null },
  });
  let reads = 0;
  await page.route('**/api/v1/gaming/sessions', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ json: stateForRead(0) });
  });
  await page.route('**/api/v1/gaming/sessions/game:fixture', route => {
    reads += 1;
    return route.fulfill({ json: stateForRead(reads) });
  });

  let gamingSocket;
  await page.routeWebSocket(url => url.pathname === '/ws', socket => {
    gamingSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type === 'bus_command' && message.action === 'subscribe' && message.topics?.includes('gaming')) {
        socket.send(JSON.stringify({ topic: 'gaming', kind: 'session-updated', sessionId: 'game:fixture' }));
      }
    });
  });

  await page.goto('/admin/content/lists/menus/party-game-fixture');
  await page.getByTitle('Preview app', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dice preview' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('7');
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(gamingSocket).toBeTruthy();
  const notation = dialog.getByRole('textbox', { name: 'Custom dice notation' });
  await notation.fill('2d20');
  gamingSocket.send(JSON.stringify({ topic: 'gaming', kind: 'session-updated', sessionId: 'game:fixture' }));
  await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
  await expect(notation).toHaveValue('2d20');
});
