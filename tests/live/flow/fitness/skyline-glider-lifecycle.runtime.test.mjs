import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { getEquipment, setEquipmentRider, setRpm } from '#testlib/FitnessSimHelper.mjs';

test('Skyline Glider shipped course scrolls smoothly, responds, resumes, and saves', async ({ page }) => {
  test.setTimeout(120_000);
  let savedRun = null;
  await page.route('**/api/v1/fitness/skyline-glider/runs', async (route) => {
    savedRun = (await route.request().postDataJSON()).record;
    await route.fulfill({ status: 201, json: { created: true, record: savedRun } });
  });

  await page.goto(`${FRONTEND_URL}/fitness`);
  const equipment = await getEquipment(page);
  const bike = equipment.find((item) => item.equipmentId === 'niceday' && item.cadenceDeviceId)
    || equipment.find((item) => item.equipmentId === 'cycle_ace' && item.cadenceDeviceId)
    || equipment.find((item) => item.cadenceDeviceId);
  expect(bike).toBeTruthy();
  await setEquipmentRider(page, bike.equipmentId, bike.eligibleUsers[0]);
  await setRpm(page, bike.equipmentId, 60);
  await page.goto(`${FRONTEND_URL}/fitness/module/skyline_glider`);
  await expect(page.getByTestId('skyline-glider-lobby')).toBeVisible();
  await page.getByRole('button', { name: 'Start flight' }).click();
  await expect(page.getByTestId('skyline-glider-flight')).toBeVisible({ timeout: 10_000 });

  const positions = await page.evaluate(async () => {
    const samples = [];
    for (let index = 0; index < 32; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(document.querySelector('[data-testid="course-segment-valley-rise"] rect')?.getAttribute('x'));
    }
    return samples.filter(Boolean);
  });
  expect(new Set(positions).size).toBeGreaterThanOrEqual(20);

  await setRpm(page, bike.equipmentId, 35);
  await page.waitForTimeout(700);
  const lowTransform = await page.locator('.skyline-glider__craft').getAttribute('transform');
  await setRpm(page, bike.equipmentId, 100);
  await page.waitForTimeout(900);
  const highTransform = await page.locator('.skyline-glider__craft').getAttribute('transform');
  expect(highTransform).not.toBe(lowTransform);

  await expect.poll(async () => Number(await page.getByTestId('skyline-glider-flight').getAttribute('data-course-time')), { timeout: 30_000 }).toBeGreaterThan(20);
  await expect(page.locator('.skyline-glider__hud')).toContainText('♥ 3');
  await setRpm(page, bike.equipmentId, 30);
  await expect.poll(async () => Number(await page.getByTestId('skyline-glider-flight').getAttribute('data-course-time')), { timeout: 25_000 }).toBeGreaterThan(36);
  await expect(page.locator('.skyline-glider__hud')).toContainText('♥ 3');
  await setRpm(page, bike.equipmentId, 65);
  await expect.poll(async () => Number(await page.getByTestId('skyline-glider-flight').getAttribute('data-course-time')), { timeout: 25_000 }).toBeGreaterThan(54);
  await expect(page.locator('.skyline-glider__hud')).toContainText('♥ 3');
  await expect.poll(async () => Number(await page.getByTestId('skyline-glider-flight').getAttribute('data-course-time')), { timeout: 30_000 }).toBeGreaterThan(76);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume flight' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Resume flight' }).click();
  await setRpm(page, bike.equipmentId, 70);
  await expect(page.getByTestId('skyline-glider-flight')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => Number(await page.getByTestId('skyline-glider-flight').getAttribute('data-course-time'))).toBeGreaterThan(75);
  await page.getByRole('button', { name: 'End flight' }).click();
  await expect(page.getByTestId('skyline-glider-result')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => savedRun).not.toBeNull();
  expect(savedRun.result.schema).toBe('gaming-result/v1');
  expect(savedRun.run).toMatchObject({ status: 'abandoned', course_id: 'mountain-pass', course_version: 2, equipment_id: bike.equipmentId });
});
