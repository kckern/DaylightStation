import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function installJobs(page, holdRun) {
  const reads = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (holdRun && path.endsWith('/jobs/a/run')) await holdRun;
    const match = path.match(/\/scheduler\/jobs\/(a|b)$/);
    if (match) {
      const id = match[1];
      reads.push(id);
      return route.fulfill({ json: { job: { id, name: 'Fixture ' + id, schedule: '* * * * *' } } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  return reads;
}

async function openJobB(page) {
  await page.evaluate(() => {
    history.pushState({}, '', '/admin/system/scheduler/b');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByText('Fixture b', { exact: true })).toBeVisible();
}

test('a queued Scheduler run refreshes only its own mounted job', async ({ page }) => {
  const reads = await installJobs(page);
  await page.goto('/admin/system/scheduler/a');
  await page.getByRole('button', { name: 'Run Now' }).click();
  await expect(page.getByText('Job triggered', { exact: true })).toBeVisible();
  await openJobB(page);

  // The second run reaching its own two-second deadline also outlasts the first deadline.
  await page.getByRole('button', { name: 'Run Now' }).click();
  await expect.poll(() => reads.filter(id => id === 'b').length).toBe(2);
  await expect(page.getByText('Fixture b', { exact: true })).toBeVisible();
  expect(reads).toEqual(['a', 'b', 'b']);
});

test('a run response received after leaving its job cannot start a delayed refresh', async ({ page }) => {
  let release;
  const holdRun = new Promise(resolve => { release = resolve; });
  const reads = await installJobs(page, holdRun);
  await page.goto('/admin/system/scheduler/a');
  const requested = page.waitForRequest(request => request.url().endsWith('/jobs/a/run'));
  await page.getByRole('button', { name: 'Run Now' }).click();
  await requested;
  await openJobB(page);
  const answered = page.waitForResponse(response => response.url().endsWith('/jobs/a/run'));
  release();
  await answered;

  await page.getByRole('button', { name: 'Run Now' }).click();
  await expect.poll(() => reads.filter(id => id === 'b').length).toBe(2);
  expect(reads).toEqual(['a', 'b', 'b']);
  await expect(page.getByText('Fixture b', { exact: true })).toBeVisible();
});

for (const [action, destination] of [['edit', 'roster'], ['edit', 'job'], ['delete', 'roster']]) {
  test(`Scheduler reconciles a committed ${action} with the current ${destination}`, async ({ page }) => {
    const deleting = action === 'delete';
    const release = Promise.withResolvers();
    let job = { id: 'a', name: 'Original job', schedule: '* * * * *' };
    let submissions = 0;
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/scheduler/jobs')) return route.fulfill({ json: { jobs: job ? [job] : [] } });
      if (path.endsWith('/scheduler/jobs/a')) {
        if (request.method() !== 'GET') {
          submissions++;
          await release.promise;
          job = deleting ? null : { ...job, ...request.postDataJSON() };
        }
        return route.fulfill({ json: { job } });
      }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });
    await page.goto('/admin/system/scheduler');
    await page.getByText('Original job', { exact: true }).click();
    await page.getByRole('button', { name: deleting ? 'Delete' : 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog');
    if (!deleting) await dialog.getByLabel('Name', { exact: true }).fill('Updated job');
    await dialog.getByRole('button', { name: deleting ? 'Delete' : 'Save', exact: true }).click();
    await expect.poll(() => submissions).toBe(1);
    await page.goBack();
    await expect(page.getByText('Scheduler Jobs', { exact: true })).toBeVisible();
    const original = page.getByText('Original job', { exact: true });
    await expect(original).toBeVisible();
    if (destination === 'job') {
      await original.click();
      await expect(page.getByText('Job Info', { exact: true })).toBeVisible();
    }
    release.resolve();
    await expect(page.getByText(deleting ? 'No scheduler jobs found. Create one to get started.' : 'Updated job', { exact: true })).toBeVisible();
    expect(submissions).toBe(1);
  });
}
