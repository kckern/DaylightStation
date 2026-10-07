import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { getEquipment, setEquipmentRider, setRpm } from '#testlib/FitnessSimHelper.mjs';

const shortCourse = {
  schema: 'skyline-glider-course/v1', id: 'mountain-pass', version: 1, name: 'Mountain Pass — Test Run', duration_s: 6,
  description: 'Short simulator course',
  motion: { filter_s: .2, deadband_rpm: 2, response_s: .4, max_climb_rate: .8, max_descent_rate: .8, coast_s: .2, disconnect_grace_s: .25 },
  rules: { lives: 3, invincibility_s: .2, restart_delay_s: .25 },
  segments: [
    { id: 'open', type: 'open', start_s: 0, end_s: 6 },
    { id: 'checkpoint', type: 'checkpoint', start_s: 1 },
    { id: 'finish', type: 'finish', start_s: 6 },
  ],
};

test('Skyline Glider cadence, checkpoint resume, completion, and save', async ({ page }) => {
  test.setTimeout(90_000);
  let savedRun = null;
  await page.route('**/api/v1/fitness/skyline-glider/courses', (route) => route.fulfill({ json: { courses: [shortCourse] } }));
  await page.route('**/api/v1/fitness/skyline-glider/runs', async (route) => {
    savedRun = (await route.request().postDataJSON()).record;
    await route.fulfill({ status: 201, json: { created: true, record: savedRun } });
  });

  await page.goto(`${FRONTEND_URL}/fitness`);
  const equipment = await getEquipment(page);
  const bike = equipment.find((item) => item.cadenceDeviceId);
  expect(bike).toBeTruthy();
  await setEquipmentRider(page, bike.equipmentId, bike.eligibleUsers[0]);
  await page.goto(`${FRONTEND_URL}/fitness/module/skyline_glider`);
  await expect(page.getByTestId('skyline-glider-lobby')).toBeVisible();
  await page.getByRole('button', { name: 'Start flight' }).click();
  await expect(page.getByTestId('skyline-glider-flight')).toBeVisible({ timeout: 10_000 });

  await setRpm(page, bike.equipmentId, 35);
  await page.waitForTimeout(700);
  const lowTransform = await page.locator('.skyline-glider__craft').getAttribute('transform');
  await setRpm(page, bike.equipmentId, 100);
  await page.waitForTimeout(900);
  const highTransform = await page.locator('.skyline-glider__craft').getAttribute('transform');
  expect(highTransform).not.toBe(lowTransform);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume flight' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Resume flight' }).click();
  await setRpm(page, bike.equipmentId, 70);
  await expect(page.getByTestId('skyline-glider-result')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => savedRun).not.toBeNull();
  expect(savedRun.result.schema).toBe('gaming-result/v1');
  expect(savedRun.run.status).toBe('completed');
});
