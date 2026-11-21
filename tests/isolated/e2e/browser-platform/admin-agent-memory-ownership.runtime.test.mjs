import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const agentPath = '/api/v1/agents/coach';
const memoryPath = `${agentPath}/memory/alice`;

test('Admin Agent Clear All retires an older working-memory read', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const calls = [];
  let held;
  let reads = 0;
  let cleared = false;
  let assignments = 0;
  const releaseClear = Promise.withResolvers();
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/admin/household') return route.fulfill({ json: { members: [{ username: 'alice' }] } });
    if (path === `${agentPath}/assignments`) {
      assignments++;
      return route.fulfill({ json: { assignments: [{ id: 'fixture-assignment' }] } });
    }
    if (path === memoryPath || path === `${memoryPath}/note`) {
      const method = request.method();
      calls.push([method, path]);
      if (method === 'DELETE') {
        if (path === memoryPath) {
          await releaseClear.promise;
          cleared = true;
        }
        return route.fulfill({ json: {} });
      }
      if (method === 'GET' && path === memoryPath) {
        if (++reads === 2) { held = route; return; }
        return route.fulfill({ json: { entries: cleared ? {} : {
          note: { value: 'Remove this first' }, keep: { value: 'Memory entry to clear' },
        } } });
      }
      return route.fulfill({ status: 405 });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/admin/agents/coach');
  await expect(page.getByText('Memory entry to clear')).toBeVisible();
  await page.getByRole('button', { name: 'Delete memory entry note' }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear All Memory' });
  const clear = dialog.getByRole('button', { name: 'Clear All', exact: true });
  await clear.press('Enter');
  try {
    await expect.poll(() => calls.filter(([method, path]) => method === 'DELETE' && path === memoryPath)).toHaveLength(1);
    await expect(clear).toBeFocused();
    await expect(clear).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally {
    releaseClear.resolve();
  }
  await expect.poll(() => cleared).toBe(true);
  await expect(page.getByText('No memory entries')).toBeVisible();
  await expect.poll(() => held.request().failure()).not.toBeNull();
  await expect(page.getByText('Memory entry to clear')).toHaveCount(0);
  expect(calls).toEqual([
    ['GET', memoryPath], ['DELETE', `${memoryPath}/note`], ['GET', memoryPath],
    ['DELETE', memoryPath], ['GET', memoryPath],
  ]);
  expect(assignments).toBe(1);
});
