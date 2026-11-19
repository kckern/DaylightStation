import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
});

function mockRegistryVisibility(page) {
  return page.addInitScript(() => {
    window.registryFixtureVisible = true;
    Object.defineProperty(document, 'visibilityState', {
      get: () => window.registryFixtureVisible ? 'visible' : 'hidden',
    });
  });
}

function returnToForeground(page) {
  return page.evaluate(() => {
    window.registryFixtureVisible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.registryFixtureVisible = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('Media Home and the open cast picker share screen names and rooms', async ({ page }) => {
  const item = {
    contentId: 'plex:123', title: 'Fixture Film', type: 'movie',
    spots: [
      { playhead: 720, duration: 7200, deviceId: 'fleet:lounge' },
      { playhead: 4800, duration: 7200, deviceId: 'fleet:projector' },
    ],
  };
  let screens = [
    { id: 'fleet:lounge', name: 'Den TV', room: 'Den' },
    { id: 'fleet:projector', name: 'Projector', room: 'Den' },
  ];
  let registryReads = 0;
  await mockRegistryVisibility(page);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/device/config')) {
      return route.fulfill({ json: { devices: {
        lounge: { name: 'Configured lounge', fleet: true },
        projector: { name: 'Configured projector', fleet: true },
      } } });
    }
    if (pathname === '/api/v1/media/suggestions') {
      return route.fulfill({ json: { rows: [{ id: 'carry-on', title: 'Carry on', items: [item] }] } });
    }
    if (pathname === '/api/v1/media/household/carry-on') return route.fulfill({ json: { items: [item] } });
    if (pathname === '/api/v1/media/screens') {
      registryReads += 1;
      return route.fulfill({ json: { screens } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/media');
  const tile = page.getByTestId('home-tile-carry-on-plex:123');
  await expect(tile).toContainText('12 m on Den TV');
  await page.getByTestId('home-tile-carry-on-plex:123-more').click();
  await page.getByRole('menuitem', { name: 'Play on…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Play on…', exact: true });
  await picker.getByTestId('picker-multi-toggle').click();
  const lounge = picker.getByTestId('picker-device-lounge');
  const projector = picker.getByTestId('picker-device-projector');
  await lounge.click();
  await projector.click();
  const warning = picker.getByTestId('picker-drift-warning');
  await expect(warning).toContainText('are both in Den');
  expect.soft(registryReads, 'Home and the cast picker use the same initial registry read').toBe(1);

  screens = [{ ...screens[0], name: 'Lounge TV', room: 'Lounge' }, screens[1]];
  await returnToForeground(page);
  await expect(lounge).toContainText('Lounge TV');
  await expect(warning).toBeHidden();
  await expect(lounge).toHaveAttribute('aria-pressed', 'true');
  await expect(projector).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(tile).toContainText('12 m on Lounge TV');
  expect(registryReads).toBe(2);
});

test('Media screen settings show a saved name when saving its room fails', async ({ page }) => {
  let screen = { id: 'fleet:lounge', name: 'Den TV', room: 'Den' };
  const writes = [];
  let registryReads = 0;
  let roomUnavailable = true;
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/media/screens') {
      registryReads += 1;
      return route.fulfill({ json: { screens: [screen] } });
    }
    if (path === '/api/v1/media/screens/fleet:lounge' && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      if ('room' in body && roomUnavailable) return route.fulfill({ status: 409, json: { error: 'Room unavailable' } });
      screen = { ...screen, ...body };
      return route.fulfill({ json: { screen, routines: [] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?view=screens');
  const row = page.getByTestId('screen-admin-item-fleet:lounge');
  await expect(row).toContainText('Den TV');
  await row.getByTestId('screen-admin-rename-fleet:lounge').click();
  await page.getByTestId('screen-admin-rename-name').fill('Lounge TV');
  await page.getByTestId('screen-admin-rename-room').fill('Lounge');
  await page.getByTestId('screen-admin-rename-save').click();
  await expect(page.getByTestId('screen-admin-rename-error')).toContainText('Room unavailable');
  await expect(row).toContainText('Lounge TV');
  await expect(row).toContainText('· Den');
  expect(writes).toEqual([{ name: 'Lounge TV' }, { room: 'Lounge' }]);
  expect(registryReads).toBe(2);

  roomUnavailable = false;
  await page.getByTestId('screen-admin-rename-save').click();
  await expect(page.getByTestId('screen-admin-rename-dialog')).toBeHidden();
  await expect(row).toContainText('· Lounge');
  expect(writes).toEqual([{ name: 'Lounge TV' }, { room: 'Lounge' }, { room: 'Lounge' }]);
});

test('Media device settings keep a room draft after saving the name', async ({ page }) => {
  let screen;
  let roomUnavailable = true;
  const writes = [];
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/media/screens') return route.fulfill({ json: { screens: screen ? [screen] : [] } });
    if (path.startsWith('/api/v1/media/screens/browser:') && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      if ('room' in body && roomUnavailable) return route.fulfill({ status: 409, json: { error: 'Room unavailable' } });
      screen = { id: path.split('/').at(-1), room: null, ...screen, ...body };
      return route.fulfill({ json: { screen, routines: [] } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/media');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-rename-device').click();
  const room = page.getByTestId('settings-rename-room');
  await page.getByTestId('settings-rename-name').fill('Kitchen Tablet');
  await room.fill('Kitchen');
  await page.getByTestId('settings-rename-save').click();
  await expect(page.getByTestId('settings-rename-error')).toContainText('Room unavailable');
  await expect(room).toHaveValue('Kitchen');

  roomUnavailable = false;
  await page.getByTestId('settings-rename-save').click();
  await expect(page.getByTestId('settings-rename-dialog')).toBeHidden();
  expect(writes).toEqual([{ name: 'Kitchen Tablet' }, { room: 'Kitchen' }, { room: 'Kitchen' }]);
});

test('Media screen settings preserve a concurrent rename during a room-only edit', async ({ page }) => {
  let screen = { id: 'fleet:lounge', name: 'Den TV', room: 'Den' };
  const writes = [];
  await mockRegistryVisibility(page);
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/media/screens') return route.fulfill({ json: { screens: [screen] } });
    if (path === '/api/v1/media/screens/fleet:lounge' && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      screen = { ...screen, ...body };
      return route.fulfill({ json: { screen } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?view=screens');
  const row = page.getByTestId('screen-admin-item-fleet:lounge');
  await row.getByTestId('screen-admin-rename-fleet:lounge').click();
  await page.getByTestId('screen-admin-rename-room').fill('Lounge');
  screen = { ...screen, name: 'Family TV' };
  await returnToForeground(page);
  await expect(row).toContainText('Family TV');
  await page.getByTestId('screen-admin-rename-save').click();
  await expect(page.getByTestId('screen-admin-rename-dialog')).toBeHidden();
  await expect(row).toContainText('Family TV· Lounge');
  expect(writes).toEqual([{ room: 'Lounge' }]);
});

test('Media keeps a slow screen registry read through polling and refreshes it on foreground return', async ({ page }) => {
  const registry = [];
  let socket;
  let connections = 0;
  await page.routeWebSocket('**/*', connection => { socket = connection; connections++; });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.clock.install();
  await mockRegistryVisibility(page);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/device/config')) {
      return route.fulfill({ json: { devices: { lounge: { name: 'Configured screen', fleet: true } } } });
    }
    if (pathname === '/api/v1/media/screens') {
      registry.push(route);
      return;
    }
    return route.fulfill({ json: {} });
  });

  const registryResult = name => ({ json: { screens: [{ id: 'fleet:lounge', name }] } });
  const elapseRegistryInterval = async () => {
    for (let seconds = 0; seconds < 120; seconds += 30) {
      // Keep the mocked connection alive as the server normally does. A
      // reconnect would correctly force a new read independently of polling.
      socket.send(JSON.stringify({ type: 'ping' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.clock.fastForward(30_000);
    }
    expect(connections).toBe(1);
  };
  await page.goto('/media?view=fleet');
  const screen = page.getByTestId('fleet-card-lounge');
  await expect(screen).toContainText('Configured screen');
  await expect.poll(() => registry.length).toBeGreaterThan(0);
  await expect.poll(() => connections).toBe(1);
  const initialReads = registry.splice(0);
  await elapseRegistryInterval();
  await elapseRegistryInterval();
  for (const read of initialReads) await read.fulfill(registryResult('Original registry name'));
  await expect(screen).toContainText('Original registry name');
  expect(registry).toHaveLength(0);

  await elapseRegistryInterval();
  await expect.poll(() => registry.length).toBe(1);
  await returnToForeground(page);
  await expect.poll(() => registry.length).toBe(2);
  await registry[1].fulfill(registryResult('Renamed registry screen'));
  await expect(screen).toContainText('Renamed registry screen');
  const staleResponse = page.waitForResponse(response => response.request() === registry[0].request());
  await registry[0].fulfill(registryResult('Superseded registry name'));
  await (await staleResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(screen).toContainText('Renamed registry screen');
});

test('Media favourites revalidate once with Home and desktop search mounted', async ({ page }) => {
  const item = { contentId: 'plex:123', title: 'Fixture Film', type: 'movie' };
  const reads = [];
  const writes = [];
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/media/household/recent') return route.fulfill({ json: { items: [item] } });
    if (pathname === '/api/v1/media/household/favourites') {
      if (request.method() === 'GET') {
        reads.push(route);
        if (reads.length > 2) return route.fulfill({ json: { items: [{ id: item.contentId }] } });
        return;
      }
      writes.push({ method: request.method(), body: request.postDataJSON() });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/media');
  await expect(page.getByRole('textbox', { name: 'Search media…' })).toBeVisible();
  await expect.poll(() => reads.length).toBe(1);
  const tileId = 'home-tile-recent-plex:123';
  const openMenu = () => page.getByTestId(`${tileId}-more`).click();
  await openMenu();
  await page.getByRole('menuitem', { name: 'Add to favourites' }).click();
  await expect.poll(() => reads.length).toBeGreaterThanOrEqual(2);
  expect(writes).toEqual([{ method: 'POST', body: { id: item.contentId, kind: 'item', title: item.title, type: item.type } }]);

  await reads[0].fulfill({ json: { items: [] } });
  await reads[1].fulfill({ json: { items: [{ id: item.contentId }] } });
  await openMenu();
  await expect(page.getByRole('menuitem', { name: 'Remove from favourites' })).toBeVisible();
  expect(reads).toHaveLength(2);
});

test('Media detail waits for the authoritative resume spots and closes their chooser on item navigation', async ({ page }) => {
  const first = { contentId: 'plex:123', title: 'First Fixture Film', type: 'movie' };
  const next = { contentId: 'plex:456', title: 'Next Fixture Film', type: 'movie' };
  const detailUrl = contentId => `/media?view=detail&contentId=${encodeURIComponent(contentId)}`;
  const carryOnPath = '/api/v1/media/household/carry-on?limit=12';
  const recentPath = '/api/v1/media/household/recent?limit=24';
  const reads = new Map();

  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const path = pathname + search;
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/info/plex/123') return route.fulfill({ json: first });
    if (pathname === '/api/v1/info/plex/456') return route.fulfill({ json: next });
    if (pathname === '/api/v1/media/screens') {
      return route.fulfill({ json: { screens: [
        { id: 'fleet:lounge', name: 'Lounge TV' },
        { id: 'browser:tablet', name: 'Kitchen Tablet' },
      ] } });
    }
    if (request.method() === 'GET' && (path === carryOnPath || path === recentPath)) {
      reads.set(path, route);
      return;
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(detailUrl(first.contentId));
  await expect(page.getByRole('heading', { name: first.title })).toBeVisible();
  await expect.poll(() => reads.size).toBe(2);

  const playNow = page.getByRole('button', { name: 'Play Now', exact: true });
  const recent = reads.get(recentPath);
  const recentResponse = page.waitForResponse(response => response.request() === recent.request());
  await recent.fulfill({ json: { items: [{ contentId: first.contentId, playhead: 120, duration: 7200 }] } });
  await (await recentResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.soft(playNow, 'Play Now waits while carry-on can still supersede recent').toBeDisabled();

  await reads.get(carryOnPath).fulfill({ json: { items: [{
    contentId: first.contentId,
    spots: [
      { playhead: 720, duration: 7200, deviceId: 'browser:tablet' },
      { playhead: 4800, duration: 7200, deviceId: 'fleet:lounge' },
    ],
  }] } });
  await expect(playNow).toBeEnabled();
  await playNow.click();
  const chooser = page.getByRole('dialog', { name: 'Continue First Fixture Film from…' });
  await expect(chooser.getByRole('button', { name: '12 m on Kitchen Tablet' })).toBeVisible();
  await expect(chooser.getByRole('button', { name: '1 h 20 m on Lounge TV' })).toBeVisible();

  await page.evaluate(url => {
    history.pushState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, detailUrl(next.contentId));
  // Wait for the next detail to render even if the stale modal still hides it from the accessibility tree.
  await expect(page.getByRole('heading', { name: next.title, includeHidden: true })).toBeVisible();
  await expect(chooser).toBeHidden();
});
