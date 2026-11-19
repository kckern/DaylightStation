import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({ hasTouch: true, viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

test('Health keeps suggestions and saved-food actions inside a shrunken visual viewport', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  const foods = Array.from({ length: 16 }, (_, index) => ({
    id: 'food-' + index, name: 'Fixture food ' + index, grams: 100, calories: 120,
  }));
  const fixture = await installHealthFixtures(page, { foods });
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/v1/system/boot-error', route => route.fulfill({ json: {} }));
  await page.goto('/health');

  const input = page.getByRole('combobox', { name: 'Add to Dinner' });
  await input.click();
  const list = page.getByRole('listbox', { name: 'Suggested foods' });
  const popup = list.locator('..');
  await expect(list.getByRole('option')).toHaveCount(16);

  const setVisibleRoom = (above, below, event) => input.evaluate((element, { above, below, event }) => {
    const bounds = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = bounds.top - above;
    const bottom = bounds.bottom + below;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: bottom - top },
      offsetTop: { configurable: true, value: top },
    });
    viewport.dispatchEvent(new Event(event));
  }, { above, below, event });

  const placement = () => popup.evaluate(element => {
    const popup = element.getBoundingClientRect();
    const input = document.activeElement.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      side: popup.bottom <= input.top ? 'above' : 'below',
      inside: popup.top >= viewport.offsetTop && popup.bottom <= viewport.offsetTop + viewport.height,
    };
  });

  await setVisibleRoom(65, 150, 'resize');
  await expect.poll(placement).toEqual({ side: 'below', inside: true });
  await setVisibleRoom(165, 55, 'scroll');
  await expect.poll(placement).toEqual({ side: 'above', inside: true });
  await expect(list.getByRole('option').first()).toBeVisible();
  const manage = popup.getByRole('button', { name: 'Manage saved foods' });
  await expect.poll(() => manage.evaluate(button => {
    const { left, top, width, height } = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    return top >= viewport.offsetTop && top + height <= viewport.offsetTop + viewport.height
      && button.contains(document.elementFromPoint(left + width / 2, top + height / 2));
  })).toBe(true);
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => list.evaluate(element =>
    element.scrollTop > 0 && element.scrollTop + element.clientHeight >= element.scrollHeight - 1
  )).toBe(true);
  await expect(input).toBeFocused();
  expect(fixture.unexpected).toEqual([]);
});
