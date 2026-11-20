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
      return route.fulfill({ json: { id, name: 'Fixture ' + id, schedule: '* * * * *', runtime: null } });
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
      if (path.endsWith('/scheduler/jobs')) return route.fulfill({ json: job ? [job] : [] });
      if (path.endsWith('/scheduler/jobs/a')) {
        if (request.method() !== 'GET') {
          submissions++;
          await release.promise;
          job = deleting ? null : { ...job, ...request.postDataJSON() };
        }
        return route.fulfill({ json: request.method() === 'GET' ? job : { ok: true, job } });
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

for (const detail of [false, true]) {
  test(`Scheduler ${detail ? 'job detail' : 'roster'} keeps Run focused through refetch and GET-only Retry`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.routeWebSocket('**/*', () => {});
    const writing = Promise.withResolvers();
    const allowWrite = Promise.withResolvers();
    const confirming = Promise.withResolvers();
    const refuseRead = Promise.withResolvers();
    const retrying = Promise.withResolvers();
    const acceptRead = Promise.withResolvers();
    const calls = [];
    const endpoint = '/api/v1/admin/scheduler/jobs';
    const readPath = detail ? `${endpoint}/a` : endpoint;
    const routePath = '/admin/system/scheduler' + (detail ? '/a' : '');
    let reads = 0;
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === `${endpoint}/a/run`) {
        calls.push(request.method());
        writing.resolve();
        await allowWrite.promise;
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname.startsWith(endpoint)) {
        const job = { id: 'a', name: 'Fixture job', schedule: '0 * * * *', runtime: null };
        if (pathname === readPath) {
          calls.push(request.method());
          reads++;
          if (reads === 2) {
            confirming.resolve();
            await refuseRead.promise;
            return route.fulfill({ status: 409, json: { error: 'Runtime unavailable' } });
          }
          if (reads === 3) {
            retrying.resolve();
            await acceptRead.promise;
            job.runtime = { status: 'success', last_run: '2026-01-01T12:00:00Z', duration_ms: 250 };
          }
        }
        return route.fulfill({ json: pathname === endpoint ? [job] : job });
      }
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    try {
      await page.goto(routePath);
      const run = page.getByRole('button', { name: detail ? /^(Run Now|Queued)$/ : /^Run$/ });
      await run.press('Enter');
      await writing.promise;
      await expect(run).toBeDisabled();
      await expect(run).toBeFocused();
      await page.keyboard.press('Enter');
      expect(calls).toEqual(['GET', 'POST']);
      await expect(page).toHaveURL(new RegExp(`${routePath}$`));
      allowWrite.resolve();
      if (detail) {
        await expect(page.getByRole('button', { name: 'Queued', exact: true })).toBeFocused();
        expect(calls).toEqual(['GET', 'POST']);
      }

      await confirming.promise;
      await expect(run).toBeDisabled();
      await expect(run).toBeFocused();
      await page.keyboard.press('Enter');
      expect(calls).toEqual(['GET', 'POST', 'GET']);
      refuseRead.resolve();
      const region = page.getByRole('region', { name: detail ? 'Scheduler job' : 'Scheduler jobs', exact: true });
      await expect(region.getByRole('alert')).toContainText('Runtime unavailable');
      await expect(run).toBeFocused();
      await expect(run).toBeDisabled();
      await region.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
      await retrying.promise;
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      await expect(run).toBeDisabled();
      acceptRead.resolve();
      await expect(run).toBeEnabled();
      await expect(region).toBeFocused();
      await expect(region.getByText('success', { exact: true })).toBeVisible();
      expect(calls).toEqual(['GET', 'POST', 'GET', 'GET']);
      if (!detail) {
        await page.getByRole('link', { name: 'Fixture job', exact: true }).press('Enter');
        await expect(page).toHaveURL(/\/admin\/system\/scheduler\/a$/);
      }
    } finally {
      allowWrite.resolve();
      refuseRead.resolve();
      acceptRead.resolve();
    }
  });
}

test('A cold Scheduler job failure keeps keyboard Back and recovers with the same Retry region', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const pending = Promise.withResolvers();
  const release = Promise.withResolvers();
  const methods = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/scheduler/jobs/a')) {
      methods.push(request.method());
      if (methods.length === 1) return route.fulfill({ status: 409, json: { error: 'Job unavailable' } });
      pending.resolve();
      await release.promise;
      return route.fulfill({ json: { id: 'a', name: 'Recovered job', runtime: null } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  try {
    await page.goto('/admin/system/scheduler/a');
    await expect(page.getByText(/Job unavailable/)).toBeVisible();
    const back = page.getByText('Back to Scheduler', { exact: true });
    await back.focus();
    await expect(back).toBeFocused();
    await expect(back).toHaveAttribute('href', '/admin/system/scheduler');
    await page.keyboard.press('Tab');
    const region = page.getByRole('region', { name: 'Scheduler job', exact: true });
    const retry = region.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await pending.promise;
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();
    release.resolve();
    await expect(region.getByText('Recovered job', { exact: true })).toBeVisible();
    await expect(back).toBeFocused();
    expect(methods).toEqual(['GET', 'GET']);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/system\/scheduler$/);
  } finally {
    release.resolve();
  }
});

test('Scheduler restores roster focus when the focused Run row disappears in readback', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const rowRead = Promise.withResolvers();
  const release = Promise.withResolvers();
  let ran = false;
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const job = { id: 'a', name: 'Fixture job', schedule: '0 * * * *' };
    if (pathname.endsWith('/scheduler/jobs/a/run')) {
      ran = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.endsWith('/scheduler/jobs')) {
      if (!ran) return route.fulfill({ json: [job] });
      rowRead.resolve();
      await release.promise;
      return route.fulfill({ json: [{ ...job, id: 'b', name: 'Replacement job' }] });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  try {
    await page.goto('/admin/system/scheduler');
    const roster = page.getByRole('region', { name: 'Scheduler jobs', exact: true });
    const original = roster.getByRole('row', { name: /Fixture job/ });
    const run = original.getByRole('button', { name: 'Run', exact: true });
    await run.press('Enter');
    await rowRead.promise;
    await expect(run).toBeFocused();
    release.resolve();
    await expect(original).toHaveCount(0);
    await expect(roster).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(roster.getByRole('link', { name: 'Replacement job' })).toBeFocused();
  } finally {
    release.resolve();
  }
});

test('A refused Scheduler Run keeps focus and schedules no runtime read', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const started = Promise.withResolvers();
  const refused = Promise.withResolvers();
  const methods = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/scheduler/jobs/a/run')) {
      methods.push(request.method());
      started.resolve();
      await refused.promise;
      return route.fulfill({ status: 409, json: { error: 'Run refused' } });
    }
    if (pathname.endsWith('/scheduler/jobs/a')) {
      methods.push(request.method());
      return route.fulfill({ json: { id: 'a', name: 'Fixture job' } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  try {
    await page.clock.install();
    await page.goto('/admin/system/scheduler/a');
    const run = page.getByRole('button', { name: /^(Run Now|Queued)$/ });
    await run.press('Enter');
    await started.promise;
    await expect(run).toBeFocused();
    refused.resolve();
    const region = page.getByRole('region', { name: 'Scheduler job', exact: true });
    await expect(region.getByRole('alert')).toContainText('Run refused');
    await expect(run).toBeEnabled();
    await expect(run).toBeFocused();
    await page.clock.runFor(2500);
    expect(methods).toEqual(['GET', 'POST']);
  } finally {
    refused.resolve();
  }
});

test('A Scheduler Run stays pending when a departed detail edit replaces the roster read', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const editing = Promise.withResolvers();
  const finishEdit = Promise.withResolvers();
  const confirming = Promise.withResolvers();
  const finishConfirming = Promise.withResolvers();
  const replacement = Promise.withResolvers();
  const finishReplacement = Promise.withResolvers();
  let first = { id: 'a', name: 'First job', schedule: '0 * * * *' };
  const second = { ...first, id: 'b', name: 'Second job' };
  let reads = 0;
  let runs = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/scheduler/jobs/a') && request.method() === 'PUT') {
      editing.resolve();
      await finishEdit.promise;
      first = { ...first, ...request.postDataJSON() };
      return route.fulfill({ json: { ok: true, job: first } });
    }
    if (pathname.endsWith('/scheduler/jobs/a')) return route.fulfill({ json: first });
    if (pathname.endsWith('/scheduler/jobs/b/run')) {
      runs++;
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.endsWith('/scheduler/jobs')) {
      reads++;
      const snapshot = [first, second];
      if (reads === 3) {
        confirming.resolve();
        await finishConfirming.promise;
      }
      if (reads === 4) {
        replacement.resolve();
        await finishReplacement.promise;
      }
      return route.fulfill({ json: snapshot }).catch(() => {});
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  try {
    await page.goto('/admin/system/scheduler');
    await page.getByRole('link', { name: 'First job', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Edit', exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Edit Job', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Updated job');
    await dialog.getByRole('button', { name: 'Save', exact: true }).press('Enter');
    await editing.promise;
    await page.goBack();
    const roster = page.getByRole('region', { name: 'Scheduler jobs', exact: true });
    const run = roster.getByRole('row', { name: /Second job/ }).getByRole('button', { name: 'Run', exact: true });
    await run.press('Enter');
    await confirming.promise;
    await expect(run).toHaveAttribute('aria-busy', 'true');
    finishEdit.resolve();
    await replacement.promise;
    await expect(run).toHaveAttribute('aria-busy', 'true');
    await expect(run).toBeFocused();
    await page.keyboard.press('Enter');
    expect(runs).toBe(1);
    finishReplacement.resolve();
    await expect(roster.getByRole('link', { name: 'Updated job', exact: true })).toBeVisible();
    await expect(run).toBeEnabled();
    await expect(run).toBeFocused();
    finishConfirming.resolve();
    expect(reads).toBe(4);
  } finally {
    finishEdit.resolve();
    finishConfirming.resolve();
    finishReplacement.resolve();
  }
});
