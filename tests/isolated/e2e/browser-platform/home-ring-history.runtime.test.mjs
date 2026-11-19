import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Home retires old doorbell clip reads and keeps the accessible recordings in the new range', async ({ page }) => {
  const camera = 'porch-cam';
  const room = { id: 'porch', name: 'Porch' };
  const entity = {
    id: 'binary_sensor.porch_visitor', domain: 'binary_sensor', type: 'presence',
    name: 'Porch doorbell', state: 'off', stateClass: 'off', room, detail: {},
  };
  const days = ['2026-11-16', '2026-11-17', '2026-11-18'];
  const mark = day => Date.parse(day + 'T12:00:00Z');
  const response = day => ({ clips: [{
    name: day + '.mp4', start: day + 'T11:59:55Z', end: day + 'T12:00:30Z',
  }] });
  const reads = [];
  let original;
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/home-dashboard/entities', route => route.fulfill({ json: {
    entities: [entity], rooms: [room], types: [{ id: 'presence', label: 'Motion & presence' }],
    summary: { power: { wholeHouse: null }, on: [], open: [], motion: [], lowBattery: [], unavailable: [] },
  } }));
  await page.route('**/home-dashboard/entities/' + entity.id + '/history?range=*', route => {
    const range = new URL(route.request().url()).searchParams.get('range');
    return route.fulfill({ json: {
      range, kind: 'events', hasData: true, timeZone: 'UTC', camera,
      sinceIso: (range === '24h' ? days[2] : days[0]) + 'T00:00:00Z',
      endIso: '2026-11-18T23:59:59Z',
      marks: (range === '24h' ? [days[2]] : days.slice(0, 2)).map(mark),
    } });
  });
  await page.route('**/camera/' + camera + '/clips/file?*', () => {});
  await page.route('**/camera/' + camera + '/clips?day=*', route => {
    const day = new URL(route.request().url()).searchParams.get('day');
    reads.push(day);
    if (day === days[2] && !original) {
      original = route;
      return;
    }
    if (day === days[1] || (day === days[2] && reads.filter(value => value === day).length === 2)) {
      return route.fulfill({ status: 503, json: { error: 'Camera unavailable' } });
    }
    return route.fulfill({ json: response(day) });
  });

  await page.goto('/home');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Porch', exact: true }).click();
  await page.getByRole('button', { name: 'Show all 1 readings and switches' }).click();
  await page.getByRole('button', { name: 'Porch doorbell, Off' }).click();
  const sheet = page.getByRole('dialog', { name: 'Porch doorbell' });
  const rings = sheet.getByRole('region', { name: 'Rings' });
  await expect.poll(() => reads).toEqual([days[2]]);

  const retired = page.waitForEvent('requestfailed', request => request === original.request());
  await sheet.getByText('7 d', { exact: true }).click();
  await retired;
  await expect(rings.locator('video')).toHaveAttribute('src', new RegExp(days[0] + '\\.mp4'));
  await expect(rings.locator('time')).toHaveCount(2);
  await expect(rings.getByText('No recording near this ring')).toHaveCount(1);
  await expect(rings.getByRole('alert')).toHaveCount(0);
  expect(reads.slice().sort()).toEqual(days);

  await sheet.getByText('24 h', { exact: true }).click();
  const error = rings.getByRole('alert');
  await expect(error).toContainText('Clips could not be loaded');
  await expect(rings.locator('time')).toHaveCount(1);
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(rings.locator('video')).toHaveAttribute('src', new RegExp(days[2] + '\\.mp4'));
  await expect(error).toHaveCount(0);
  expect(reads.slice(3)).toEqual([days[2], days[2]]);
});
