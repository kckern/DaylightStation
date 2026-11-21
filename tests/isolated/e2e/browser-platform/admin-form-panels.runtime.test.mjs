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
  const secondQueueSong = {
    id: 'plex:43', contentId: 'plex:43', title: 'Second preview song', format: 'audio', mediaType: 'audio', mediaUrl: '/preview-song.wav', duration: 30,
  };
  await page.route(url => decodeURIComponent(url.pathname) === '/api/v1/play/plex:42', route => route.fulfill({ json: song }));
  const queue = Promise.withResolvers();
  if (action === 'Queue') {
    await page.addInitScript(() => localStorage.setItem('daylight.adminPreview.screenId', 'portal'));
    await page.route(url => decodeURIComponent(url.pathname) === '/api/v1/queue/plex:42', async route => {
      await queue.promise;
      return route.fulfill({ json: { items: [song, secondQueueSong] } });
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

  if (action === 'Queue') {
    const secondTrack = dialog.getByRole('button', { name: 'Second preview song', exact: true });
    await secondTrack.focus();
    await expect(secondTrack).toBeFocused();
    await expect(secondTrack).toHaveAttribute('aria-pressed', 'false');
    await secondTrack.press('Enter');
    await expect(dialog.getByText('Playing 2 of 2')).toBeVisible();
    await expect(secondTrack).toHaveAttribute('aria-pressed', 'true');
    await expect(secondTrack).toBeFocused();
  }
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

test('Admin Gratitude preview removes persisted events by selection ID and resolves older envelopes before display', async ({ page }) => {
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/gratitude-fixture', route => route.fulfill({
    json: {
      name: 'gratitude-fixture',
      sections: [{ items: [{ uid: 'gratitude-preview', label: 'Gratitude fixture', action: 'Open', input: 'app:gratitude' }] }],
    },
  }));

  let bootstrapReads = 0;
  let legacySelectionReads = 0;
  const writes = [];
  const deletes = [];
  const backendSelections = [];
  await page.route('**/api/v1/gratitude/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/bootstrap')) {
      bootstrapReads++;
      return route.fulfill({ json: {
        users: [{ id: 'alice', name: 'Alice' }],
        options: { gratitude: [], hopes: [] },
        selections: { gratitude: [...backendSelections], hopes: [] },
      } });
    }
    if (pathname.endsWith('/selections/gratitude') && request.method() === 'GET') {
      legacySelectionReads++;
      return route.fulfill({ json: { items: [...backendSelections] } });
    }
    if (pathname.endsWith('/selections/gratitude') && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { selection: { id: 'unexpected-preview-write' } } });
    }
    if (pathname.startsWith('/api/v1/gratitude/selections/gratitude/')) {
      const selectionId = pathname.split('/').at(-1);
      deletes.push(selectionId);
      const index = backendSelections.findIndex(selection => selection.id === selectionId);
      const [removed] = index < 0 ? [] : backendSelections.splice(index, 1);
      return route.fulfill({ status: removed ? 200 : 404, json: { removed } });
    }
    return route.fulfill({ json: {} });
  });

  let gratitudeSocket;
  const subscriptionActions = [];
  await page.routeWebSocket(url => url.pathname === '/ws', socket => {
    gratitudeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type === 'bus_command' && message.topics?.includes('gratitude')) {
        subscriptionActions.push(message.action);
      }
    });
  });

  await page.goto('/admin/content/lists/menus/gratitude-fixture');
  const preview = page.getByTitle('Preview app', { exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Gratitude fixture' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => Boolean(gratitudeSocket && subscriptionActions.includes('subscribe'))).toBe(true);

  backendSelections.push({
    id: 'saved-selection-uuid', userId: 'alice', userName: 'Alice',
    item: { id: 'option-id', text: 'Committed from HomeBot' }, datetime: '2026-11-20T12:00:00.000Z',
  });
  gratitudeSocket.send(JSON.stringify({
    topic: 'gratitude', action: 'item_added', userId: 'alice', userName: 'Alice', category: 'gratitude', source: 'homebot',
    items: [{ id: 'option-id', selectionId: 'saved-selection-uuid', text: 'Committed from HomeBot' }],
  }));
  await expect(dialog.locator('.selected-column .item-text')).toHaveText(['Committed from HomeBot']);
  expect(legacySelectionReads).toBe(0);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => deletes).toEqual(['saved-selection-uuid']);
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await preview.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);
  await expect.poll(() => subscriptionActions.filter(action => action === 'subscribe').length).toBe(2);

  backendSelections.push({
    id: 'legacy-saved-selection-uuid', userId: 'alice', userName: 'Alice',
    item: { id: 'legacy-option-id', text: 'Older persisted event' }, datetime: '2026-11-20T12:00:00.000Z',
  });
  gratitudeSocket.send(JSON.stringify({
    topic: 'gratitude', action: 'item_added', userId: 'alice', userName: 'Alice', category: 'gratitude', source: 'homebot',
    items: [{ id: 'legacy-option-id', text: 'Older persisted event' }],
  }));
  await expect.poll(() => legacySelectionReads).toBe(1);
  await expect(dialog.locator('.selected-column .item-text')).toHaveText(['Older persisted event']);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => deletes).toEqual(['saved-selection-uuid', 'legacy-saved-selection-uuid']);
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => subscriptionActions.filter(action => action === 'unsubscribe').length).toBe(2);
  expect(writes).toEqual([]);
  expect(bootstrapReads).toBe(2);
});

test('Admin Gratitude keeps overlapping legacy lookups independent and aborts them on preview close', async ({ page }) => {
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/gratitude-overlap-fixture', route => route.fulfill({
    json: {
      name: 'gratitude-overlap-fixture',
      sections: [{ items: [{ uid: 'gratitude-overlap', label: 'Gratitude overlap fixture', action: 'Open', input: 'app:gratitude' }] }],
    },
  }));

  const legacyReads = [];
  const failedLegacyReads = [];
  await page.route('**/api/v1/gratitude/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/bootstrap')) return route.fulfill({ json: {
      users: [{ id: 'alice', name: 'Alice' }],
      options: { gratitude: [], hopes: [] },
      selections: { gratitude: [], hopes: [] },
    } });
    if (pathname.endsWith('/selections/gratitude') && request.method() === 'GET') {
      legacyReads.push(route);
      return;
    }
    return route.fulfill({ json: {} });
  });
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname.endsWith('/selections/gratitude')) failedLegacyReads.push(request.failure());
  });

  let gratitudeSocket;
  const subscriptionActions = [];
  await page.routeWebSocket(url => url.pathname === '/ws', socket => {
    gratitudeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type === 'bus_command' && message.topics?.includes('gratitude')) subscriptionActions.push(message.action);
    });
  });

  await page.goto('/admin/content/lists/menus/gratitude-overlap-fixture');
  const preview = page.getByTitle('Preview app', { exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Gratitude overlap fixture' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => Boolean(gratitudeSocket && subscriptionActions.includes('subscribe'))).toBe(true);

  let expectedReads = 0;
  for (const [id, text] of [['legacy-a', 'Legacy event A'], ['legacy-b', 'Legacy event B']]) {
    gratitudeSocket.send(JSON.stringify({
      topic: 'gratitude', action: 'item_added', userId: 'alice', userName: 'Alice',
      category: 'gratitude', source: 'homebot', items: [{ id, text }],
    }));
    await expect.poll(() => legacyReads.length).toBe(++expectedReads);
  }
  const snapshot = [
    { id: 'selection-a', userId: 'alice', item: { id: 'legacy-a', text: 'Legacy event A' }, datetime: '2026-11-20T12:00:00.000Z' },
    { id: 'selection-b', userId: 'alice', item: { id: 'legacy-b', text: 'Legacy event B' }, datetime: '2026-11-20T12:00:00.000Z' },
  ];
  await Promise.all(legacyReads.slice(0, 2).map((route, index) => route.fulfill({ json: { items: [snapshot[index]] } })));
  const rows = dialog.locator('.selected-column .item-text');
  await expect(rows).toHaveCount(2);
  await expect(dialog.locator('.selected-column .selection-status')).toHaveCount(0);

  gratitudeSocket.send(JSON.stringify({
    topic: 'gratitude', action: 'item_added', userId: 'alice', userName: 'Alice',
    category: 'gratitude', source: 'homebot', items: [{ id: 'legacy-c', text: 'Late event C' }],
  }));
  await expect.poll(() => legacyReads.length).toBe(3);
  await dialog.locator('.gratitude-app-inner').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => failedLegacyReads.length).toBeGreaterThan(0);
  expect(subscriptionActions.filter(action => action === 'unsubscribe')).toHaveLength(1);

  await preview.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.selected-column .item-text').filter({ hasText: 'Late event C' })).toHaveCount(0);
});

test('Admin Gratitude preview waits for selection acknowledgement before removal', async ({ page }) => {
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/gratitude-ack-fixture', route => route.fulfill({
    json: {
      name: 'gratitude-ack-fixture',
      sections: [{ items: [{ uid: 'gratitude-ack', label: 'Gratitude ack fixture', action: 'Open', input: 'app:gratitude' }] }],
    },
  }));

  const backendSelections = [];
  const writes = [];
  const deletes = [];
  let bootstrapReads = 0;
  let pendingPost;
  let postBody;
  await page.route('**/api/v1/gratitude/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/bootstrap')) {
      bootstrapReads++;
      return route.fulfill({ json: {
        users: [{ id: 'alice', name: 'Alice' }],
        options: { gratitude: [], hopes: [] },
        selections: { gratitude: [...backendSelections], hopes: [] },
      } });
    }
    if (pathname.endsWith('/selections/gratitude') && request.method() === 'POST') {
      postBody = request.postDataJSON();
      writes.push(postBody);
      if (writes.length > 1) return route.fulfill({ status: 422, json: { error: 'Selection refused' } });
      pendingPost = route;
      return;
    }
    if (pathname.startsWith('/api/v1/gratitude/selections/gratitude/')) {
      const selectionId = pathname.split('/').at(-1);
      deletes.push(selectionId);
      const index = backendSelections.findIndex(selection => selection.id === selectionId);
      const [removed] = index < 0 ? [] : backendSelections.splice(index, 1);
      return route.fulfill({ status: removed ? 200 : 404, json: { removed } });
    }
    return route.fulfill({ json: {} });
  });

  let gratitudeSocket;
  const subscriptionActions = [];
  await page.routeWebSocket(url => url.pathname === '/ws', socket => {
    gratitudeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type === 'bus_command' && message.topics?.includes('gratitude')) {
        subscriptionActions.push(message.action);
      }
    });
  });
  await page.goto('/admin/content/lists/menus/gratitude-ack-fixture');
  const preview = page.getByTitle('Preview app', { exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Gratitude ack fixture' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => Boolean(gratitudeSocket && subscriptionActions.includes('subscribe'))).toBe(true);
  gratitudeSocket.send(JSON.stringify({
    topic: 'gratitude', action: 'item_added', userId: 'alice', userName: 'Alice',
    category: 'gratitude', source: 'legacy',
    items: [{ id: 'uncommitted-option', text: 'Newly selected idea' }],
  }));
  const row = dialog.locator('.selected-column .selected-item').filter({ hasText: 'Newly selected idea' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('status')).toHaveText('Saving…');
  await expect.poll(() => writes.length).toBe(1);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  await expect(row).toBeVisible();
  expect(deletes).toEqual([]);

  const committedId = 'server-assigned-selection-uuid';
  backendSelections.push({
    id: committedId, userId: postBody.userId, userName: 'Alice',
    item: postBody.item, datetime: '2026-11-20T12:00:00.000Z',
  });
  await pendingPost.fulfill({ status: 201, json: { selection: { id: committedId } } });
  await expect(row.getByRole('status')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => deletes).toEqual([committedId]);
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);

  gratitudeSocket.send(JSON.stringify({
    topic: 'gratitude', action: 'item_added', userId: 'alice', userName: 'Alice',
    category: 'gratitude', source: 'legacy',
    items: [{ id: 'refused-option', text: 'Refused idea' }],
  }));
  await expect.poll(() => writes.length).toBe(2);
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await preview.click();
  await expect.poll(() => bootstrapReads).toBe(2);
  await expect(dialog.locator('.selected-column')).toBeVisible();
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);
  expect(writes).toEqual([
    expect.objectContaining({ item: { id: 'uncommitted-option', text: 'Newly selected idea' } }),
    expect.objectContaining({ item: { id: 'refused-option', text: 'Refused idea' } }),
  ]);
  expect(deletes).toEqual([committedId]);
});

test('Admin Gratitude preview restores discarded state after a refused manual selection', async ({ page }) => {
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/gratitude-rollback-fixture', route => route.fulfill({
    json: {
      name: 'gratitude-rollback-fixture',
      sections: [{ items: [{ uid: 'gratitude-rollback', label: 'Gratitude rollback fixture', action: 'Open', input: 'app:gratitude' }] }],
    },
  }));

  const discardWrites = [];
  const selectionWrites = [];
  await page.route('**/api/v1/gratitude/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/bootstrap')) return route.fulfill({ json: {
      users: [{ id: 'alice', name: 'Alice' }],
      options: { gratitude: [{ id: 'discarded-option', text: 'Previously discarded idea' }], hopes: [] },
      selections: { gratitude: [], hopes: [] },
    } });
    if (pathname.endsWith('/discarded/gratitude') && request.method() === 'POST') {
      discardWrites.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.endsWith('/selections/gratitude') && request.method() === 'POST') {
      selectionWrites.push(request.postDataJSON());
      return route.fulfill({ status: 422, json: { error: 'Selection refused' } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/admin/content/lists/menus/gratitude-rollback-fixture');
  await page.getByTitle('Preview app', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gratitude rollback fixture' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.queue-column .queue-item')).toContainText('Previously discarded idea');
  await dialog.locator('.gratitude-app-inner').focus();

  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => discardWrites.length).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => selectionWrites.length).toBe(1);
  const discardedRow = dialog.locator('.queue-column .discarded').filter({ hasText: 'Previously discarded idea' });
  await expect(discardedRow).toBeVisible();
  await expect(dialog.locator('.selected-column .item-text')).toHaveCount(0);

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  expect(discardWrites).toHaveLength(1);
  await expect(discardedRow).toBeVisible();
});

test('Admin Gratitude preview retries bootstrap reads and retires them when closed', async ({ page }) => {
  await installFixtures(page);
  await page.route('**/api/v1/admin/content/lists/menus/gratitude-retry-fixture', route => route.fulfill({
    json: {
      name: 'gratitude-retry-fixture',
      sections: [{ items: [{ uid: 'gratitude-retry', label: 'Gratitude retry fixture', action: 'Open', input: 'app:gratitude' }] }],
    },
  }));

  let bootstrapReads = 0;
  let pendingRead;
  await page.route('**/api/v1/gratitude/bootstrap', async route => {
    bootstrapReads++;
    if (bootstrapReads === 1) return route.fulfill({ status: 204 });
    if (bootstrapReads === 3) {
      pendingRead = route;
      return;
    }
    return route.fulfill({ json: {
      users: [{ id: 'alice', name: 'Alice' }],
      options: { gratitude: [], hopes: [] },
      selections: { gratitude: [], hopes: [] },
    } });
  });

  await page.goto('/admin/content/lists/menus/gratitude-retry-fixture');
  const preview = page.getByTitle('Preview app', { exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Gratitude retry fixture' });
  await expect.poll(() => bootstrapReads).toBe(1);
  await expect(dialog.getByRole('alert')).toContainText('valid roster');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Alice')).toBeVisible();
  expect(bootstrapReads).toBe(2);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await preview.click();
  await expect.poll(() => bootstrapReads).toBe(3);
  await expect.poll(() => pendingRead).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => pendingRead.request().failure()).toBeTruthy();
});

test('Admin list parameter lookup keeps the latest app, retries its read, and commits only an explicit choice', async ({ page }) => {
  await installFixtures(page);
  const listPath = '/api/v1/admin/content/lists/menus/app-param-fixture';
  const familyRoutes = [];
  const writes = [];
  let familyReads = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === listPath) return route.fulfill({ json: {
      name: 'app-param-fixture', sections: [{ title: 'Apps', items: [
        { uid: 'existing-app', label: 'Existing app', action: 'Open', input: 'plex:existing' },
      ] }],
    } });
    if (pathname === '/api/v1/gratitude/bootstrap' && request.method() === 'GET') {
      familyReads++;
      if (familyReads === 1) {
        familyRoutes.push(route);
        return;
      }
      if (familyReads === 2) return route.fulfill({ status: 503, json: { error: 'Household temporarily unavailable' } });
      return route.fulfill({ json: { users: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }] } });
    }
    if (pathname === '/api/v1/content/query/search') return route.fulfill({ json: { items: [] } });
    if (pathname.startsWith(listPath + '/items/') && request.method() === 'PUT') {
      writes.push({ method: request.method(), body: request.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    if (pathname === listPath + '/items' && request.method() === 'POST') {
      writes.push({ method: request.method(), body: request.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/content/lists/menus/app-param-fixture');
  const existingRow = page.getByTestId('item-row-0-0');
  await existingRow.locator('.col-input .content-display').click();
  let editor = existingRow.getByRole('textbox', { name: 'Search content...' });
  await editor.fill('Family Selector');
  await page.getByTestId('combobox-option-app:family-selector').click();
  await expect.poll(() => familyRoutes.length).toBe(1);

  await existingRow.locator('.col-input .content-display').click();
  editor = existingRow.getByRole('textbox', { name: 'Search content...' });
  await editor.fill('Video Call');
  await page.getByTestId('combobox-option-app:videocall').click();
  const deviceInput = existingRow.getByPlaceholder('Type device...');
  await expect(deviceInput).toBeVisible();
  await familyRoutes[0].fulfill({ json: { users: [{ id: 'stale-member', name: 'Stale member' }] } }).catch(() => {});
  await expect(deviceInput).toBeVisible();
  await expect(existingRow.getByPlaceholder('Choose or type winner...')).toHaveCount(0);
  expect(writes).toEqual([]);

  const emptyRow = page.locator('.item-row.empty-row');
  await emptyRow.locator('.col-input .content-display').click();
  editor = emptyRow.getByRole('textbox', { name: 'Search content...' });
  await editor.fill('Family Selector');
  await page.getByTestId('combobox-option-app:family-selector').click();
  await expect(page.getByRole('alert')).toContainText('Household temporarily unavailable');
  expect(writes).toEqual([]);

  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  const memberPicker = emptyRow.getByPlaceholder('Choose or type winner...');
  await expect(memberPicker).toBeVisible();
  expect(familyReads).toBe(3);
  expect(writes).toEqual([]);
  await memberPicker.click();
  await page.getByRole('option', { name: 'Alice', exact: true }).click();
  await expect.poll(() => writes).toEqual([{
    method: 'POST',
    body: expect.objectContaining({ input: 'app:family-selector/alice' }),
  }]);
  await expect.poll(() => familyReads).toBe(3);
});
