import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const consolesPath = '/api/v1/list/retroarch';
const syncPath = '/api/v1/sync/retroarch';
const syncStatusPath = `${syncPath}/status`;
const schedulePath = '/api/v1/content/schedule/retroarch';
const consolePath = '/api/v1/list/retroarch:gb';
const rosterPath = '/api/v1/content/launch-targets/retroarch';
const labelsPath = '/api/v1/device/config';
const allowedId = 'retroarch:gb/super-mario-land';
const excludedId = 'retroarch:gb/example-quest';
const deviceId = 'fixture-tablet';

test('Admin Games recovers its schedule and the Console retries only its launch targets', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const reads = [];
  const scheduleFailures = [];
  const launches = [];
  let scheduleReads = 0;
  let rosterReads = 0;
  let resultSocket;
  let initialRoster;
  let rosterRetry;

  await page.clock.install();
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.action === 'subscribe' && message.topics?.includes('kiosk.launch.result')) resultSocket = socket;
      if (message.topic === 'kiosk.launch') launches.push(message);
    });
  });
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === schedulePath) scheduleFailures.push(request.method());
  });

  const responses = {
    [consolesPath]: { items: [{ id: 'retroarch:gb', localId: 'gb', title: 'Game Boy', metadata: { gameCount: 2 } }] },
    [syncStatusPath]: { itemCount: 2, lastSynced: null },
    [consolePath]: { items: [
      { id: allowedId, title: 'Super Mario Land', metadata: { parentTitle: 'Game Boy' } },
      { id: excludedId, title: 'Example Quest', metadata: { parentTitle: 'Game Boy' } },
    ] },
    [labelsPath]: { devices: { [deviceId]: { name: 'Fixture Tablet' } } },
  };
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (!(path in responses) && path !== syncPath && path !== schedulePath && path !== rosterPath) {
      return route.fulfill({ json: {} });
    }
    reads.push(`${request.method()} ${path}`);
    if (request.method() !== 'GET' || path === syncPath) return route.fulfill({ status: 405 });
    if (path === schedulePath) {
      if (++scheduleReads === 1) return;
      return route.fulfill({ json: { schedule: null } });
    }
    if (path === rosterPath) {
      if (++rosterReads === 1) initialRoster = route;
      else rosterRetry = route;
      return;
    }
    return route.fulfill({ json: responses[path] });
  });

  const requested = paths => paths.map(path => `GET ${path}`).sort();
  const gamesIndexReads = [consolesPath, syncStatusPath, schedulePath];
  await page.goto('/admin/content/games');
  await expect.poll(() => [...reads].sort()).toEqual(requested(gamesIndexReads));
  const consoleLink = page.getByRole('link', { name: 'Game Boy 2 games' });
  await expect(consoleLink).toHaveCount(0);
  await page.clock.fastForward(5_000);
  await expect.poll(() => scheduleFailures).toEqual(['GET']);
  await expect(consoleLink).toBeVisible();
  await expect(page.getByText('2 games · Last synced never')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Game schedule failed to load');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /Game Schedule/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const recoveredIndexReads = [...gamesIndexReads, schedulePath];
  expect([...reads].sort()).toEqual(requested(recoveredIndexReads));

  await consoleLink.click();
  await expect(page).toHaveURL('/admin/content/games/gb');
  const title = page.getByText('Super Mario Land', { exact: true });
  const launch = page.getByRole('button', { name: 'Launch', exact: true });
  await expect.poll(() => Boolean(initialRoster)).toBe(true);
  await expect(title).toBeVisible();
  await expect(launch).toHaveCount(0);
  await initialRoster.fulfill({ status: 500, json: { error: 'Fixture target roster failed' } });
  await expect(page.getByRole('alert')).toContainText('Launch targets failed to load');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => Boolean(rosterRetry)).toBe(true);
  await expect(title).toBeVisible();
  await expect(launch).toHaveCount(0);
  await expect(page.getByText(/No launch targets configured/)).toHaveCount(0);
  await rosterRetry.fulfill({ json: { targets: [{ deviceId, allow: [allowedId] }] } });

  await expect(page.getByText('1 of 2 titles available on Fixture Tablet.', { exact: false })).toBeVisible();
  const excluded = page.getByRole('button', { name: 'Not on device', exact: true });
  await expect(excluded).toBeDisabled();
  await expect.poll(() => Boolean(resultSocket)).toBe(true);
  const { x, y, width, height } = await excluded.boundingBox();
  await page.mouse.click(x + width / 2, y + height / 2);
  await launch.click();
  await expect.poll(() => launches).toEqual([{ topic: 'kiosk.launch', deviceId, contentId: allowedId }]);
  resultSocket.send(JSON.stringify({ topic: 'kiosk.launch.result', deviceId, contentId: allowedId, ok: true }));
  await expect(page.getByText('Launched.', { exact: true })).toBeVisible();
  expect([...reads].sort()).toEqual(requested([...recoveredIndexReads, consolePath, labelsPath, rosterPath, rosterPath]));
  expect(launches).toHaveLength(1);
});
