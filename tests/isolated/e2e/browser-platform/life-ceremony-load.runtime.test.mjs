import { expect, test } from '@playwright/test';
import express from 'express';
import request from 'supertest';
import createPlanRouter from '../../../../__app_modules/personal/life/server/api/life/plan.mjs';
import { YamlLifePlanStore } from '../../../../__app_modules/personal/life/server/adapters/persistence/YamlLifePlanStore.mjs';
import { LifePlanOperations } from '../../../../__app_modules/personal/life/server/application/LifePlanOperations.mjs';
import { CadenceService } from '../../../../__app_modules/personal/life/server/domain/services/CadenceService.mjs';

test.use({ serviceWorkers: 'block' });

async function installCeremony(page, { holdRetry = false, missingPlan = false } = {}) {
  const members = ['amy', 'bob'].map(username => ({ username, displayName: username.toUpperCase() }));
  const requests = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const username = searchParams.get('username');
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: members } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: members.find(member => member.username === username) || members[0] });
    if (pathname.includes('/plan/ceremony/')) {
      requests.push({ method: request.method(), username });
      if (missingPlan) return route.fulfill({ status: 409, json: { error: 'Plan required', code: 'NO_PLAN' } });
      if (requests.length === 1) return route.fulfill({ status: 503, json: { error: 'Ceremony server restarting' } });
      if (holdRetry && username === 'amy') return;
      return route.fulfill({ json: { periodId: 'fixture', activeGoals: [{ id: 'walk', name: username + ' walking goal' }] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/life/ceremony/unit_intention');
  await expect(page.getByText(missingPlan ? "You don't have a life plan yet" : 'Ceremony server restarting')).toBeVisible();
  return requests;
}

test('Life retries the selected member’s ceremony content without submitting a completion', async ({ page }) => {
  const requests = await installCeremony(page);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('amy walking goal')).toBeVisible();
  expect(requests).toEqual([{ method: 'GET', username: 'amy' }, { method: 'GET', username: 'amy' }]);
});

test('switching members retires a held ceremony retry and opens the new member’s content', async ({ page }) => {
  const requests = await installCeremony(page, { holdRetry: true });
  const retry = page.waitForRequest(request => request.url().includes('/ceremony/unit_intention?username=amy'));
  await page.getByRole('button', { name: 'Retry' }).click();
  const held = await retry;
  const retired = page.waitForEvent('requestfailed', request => request === held);
  await page.getByRole('textbox', { name: 'Switch household member' }).click();
  await page.getByRole('option', { name: 'BOB', exact: true }).click();
  await retired;
  await expect(page.getByText('bob walking goal')).toBeVisible();
  expect(requests).toEqual([
    { method: 'GET', username: 'amy' }, { method: 'GET', username: 'amy' }, { method: 'GET', username: 'bob' },
  ]);
});

test('Life Ceremony recovery links to Plan and Coach without submitting', async ({ page }) => {
  const requests = await installCeremony(page, { missingPlan: true });
  const plan = page.getByRole('link', { name: 'See the plan page', exact: true });
  const coach = page.getByRole('link', { name: 'Talk to your coach', exact: true });
  await expect(plan).toHaveAttribute('href', '/life/plan');
  await expect(coach).toHaveAttribute('href', '/life/coach');
  await plan.press('Enter');
  await expect(page).toHaveURL('/life/plan');
  await page.goBack();
  await coach.press('Enter');
  await expect(page).toHaveURL('/life/coach');
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});

for (const width of [390, 1440]) {
  test(`Life ceremony switches keep focus and persist independent changes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    const plans = new YamlLifePlanStore({ basePath: testInfo.outputPath('plans') });
    plans.save('amy', {
      cadence: { unit: 'day' },
      ceremonies: { unit_intention: { at: '08:00' }, unit_capture: { at: '20:00' } },
    });
    const planApi = express();
    planApi.use(express.json());
    planApi.use(createPlanRouter({ lifePlanOperations: new LifePlanOperations({ plans, cadence: new CadenceService() }) }));
    const writes = [];
    const member = { username: 'amy', displayName: 'Amy' };
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const outgoing = route.request();
      const { pathname, search } = new URL(outgoing.url());
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [member] } });
      if (pathname.endsWith('/life/user')) return route.fulfill({ json: member });
      const base = '/api/v1/life/plan';
      if (!pathname.startsWith(`${base}/`)) return route.fulfill({ json: {} });
      const path = pathname.slice(base.length) + search;
      if (outgoing.method() === 'PATCH') {
        const ready = Promise.withResolvers();
        const body = outgoing.postDataJSON();
        writes.push({ path, body, allow: ready.resolve });
        await ready.promise;
        const response = await request(planApi).patch(path).send(body);
        return route.fulfill({ status: response.status, json: response.body });
      }
      const response = await request(planApi).get(path);
      return route.fulfill({ status: response.status, json: response.body });
    });

    await page.goto('/life/plan/ceremonies');
    const intention = page.getByRole('switch', { name: 'Unit Intention' });
    const capture = page.getByRole('switch', { name: 'Daily Capture' });
    await expect(intention).toBeChecked();
    await expect(capture).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Season Alignment' })).not.toBeChecked();
    await intention.press('Space');
    await expect(intention).toHaveAttribute('aria-disabled', 'true');
    await intention.press('Space');
    await capture.press('Space');
    await expect.poll(() => writes.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: '/ceremonies/unit_intention?username=amy', body: { enabled: false } },
      { path: '/ceremonies/unit_capture?username=amy', body: { enabled: false } },
    ]);

    writes[1].allow();
    await expect(capture).not.toBeChecked();
    await expect(capture).toBeFocused();
    await expect(intention).toBeChecked();
    writes[0].allow();
    await expect(intention).not.toBeChecked();
    await expect(capture).toBeFocused();

    await page.reload();
    await expect(intention).toHaveCount(1);
    await expect(capture).toHaveCount(1);
    await expect(intention).not.toBeChecked();
    await expect(capture).not.toBeChecked();
    expect(writes).toHaveLength(2);
    expect(plans.load('amy').ceremonies).toEqual({
      unit_intention: { enabled: false, at: '08:00' },
      unit_capture: { enabled: false, at: '20:00' },
    });
  });
}
