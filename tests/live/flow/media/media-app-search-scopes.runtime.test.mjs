import { test, expect } from '@playwright/test';

test.setTimeout(90000);

const surfaces = [
  ['phone SearchMode', { width: 390, height: 844 }, true],
  ['tablet dock search', { width: 768, height: 1024 }, false],
  ['laptop dock search', { width: 1440, height: 900 }, false],
];

const query = process.env.MEDIA_ACCEPTANCE_SCOPE_QUERY || 'Frozen';

async function openSearch(page, isPhone) {
  await page.goto('/media');
  if (isPhone) {
    await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('media-search-launcher').click();
    await expect(page.getByTestId('search-mode')).toBeVisible();
    return page.getByTestId('search-mode-input');
  }

  await expect(page.getByTestId('media-search-bar')).toBeVisible({ timeout: 30000 });
  const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await input.click();
  return input;
}

async function readLiveScopes(page) {
  const response = await page.request.get('/api/v1/media/config');
  expect(response.ok(), 'the real media config endpoint must load').toBe(true);
  const config = await response.json();
  const scopes = config?.searchScopes;
  expect(Array.isArray(scopes) && scopes.length > 0, 'real config must expose search choices').toBe(true);
  return scopes;
}

function streamRequestFor(page, text, scope) {
  const expected = new URLSearchParams(scope.params || '');
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/api/v1/content/query/search/stream')
      || url.searchParams.get('text') !== text) return false;
    for (const [key, value] of expected) {
      if (!url.searchParams.getAll(key).includes(value)) return false;
    }
    return true;
  }, { timeout: 20000 });
}

async function waitForSearchSettled(page) {
  await expect.poll(async () => {
    const status = page.getByTestId('stream-status-line');
    if (await status.count() === 0) return true;
    return !(await status.first().getAttribute('class') || '').includes('--pending');
  }, { timeout: 30000, message: 'the real scoped result stream should settle' }).toBe(true);
}

function resultRows(page, isPhone) {
  return isPhone
    ? page.getByTestId('search-mode-results').locator('[data-testid^="search-mode-result-"]')
    : page.locator('[data-testid^="combobox-option-"]');
}

function scopeChip(page, isPhone, key) {
  const surface = isPhone ? page.getByTestId('search-mode') : page.getByTestId('media-search-bar');
  return surface.getByTestId(`scope-chip-${key}`);
}

async function actionSnapshot(page, id) {
  const more = page.getByTestId(`result-more-${id}`);
  await expect(more).toBeVisible();
  await more.click();
  const menu = page.getByTestId(`result-more-menu-${id}`);
  await expect(menu).toBeVisible();
  const ids = ['playNow', 'playNext', 'upNext', 'add', 'detail'];
  const snapshot = await Promise.all(ids.map(async (action) => {
    const item = page.getByTestId(`result-action-${action}-${id}`);
    return { action, text: await item.textContent(), disabled: await item.isDisabled() };
  }));
  await page.keyboard.press('Escape');
  return snapshot;
}

function searchSurface(page, isPhone) {
  return isPhone ? page.getByTestId('search-mode') : page.getByTestId('media-search-bar');
}

async function setDestination(page, isPhone, targetId) {
  await searchSurface(page, isPhone).getByTestId('destination-line').click();
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  if (!targetId) {
    await page.getByTestId('picker-this-device').click();
    return;
  }
  await page.getByTestId(`picker-device-${targetId}`).click();
  await page.getByTestId('picker-submit').click();
}

async function firstLeafId(page) {
  const more = page.locator('[data-testid^="result-more-"]').first();
  if (await more.count() === 0) return null;
  return (await more.getAttribute('data-testid'))?.replace('result-more-', '') ?? null;
}

async function visibleResultIds(page, isPhone) {
  const rows = resultRows(page, isPhone);
  return rows.evaluateAll((elements) => elements.map((element) => (
    element.getAttribute('data-value') || element.getAttribute('data-testid')
  )));
}

async function visibleResultText(page, isPhone) {
  return resultRows(page, isPhone).evaluateAll((elements) => elements.map((element) => element.innerText));
}

async function visibleResultKinds(page, isPhone) {
  return resultRows(page, isPhone).evaluateAll((elements, phoneSurface) => elements.map((element) => {
    const subtitle = phoneSurface
      ? element.querySelector('.media-result-subtitle')
      : element.querySelectorAll('.mantine-Text-root')[1];
    return subtitle?.textContent?.trim() ?? '';
  }), isPhone);
}

function hasVideoKindSubtitle(subtitle) {
  return subtitle.split(/\s+[·•]\s+/u).some((token) => /^(movie|tv show|series|season|episode|video)$/i.test(token.trim()));
}

async function closeSearch(page, input, isPhone) {
  if (isPhone) {
    await page.getByTestId('search-mode-close').click();
    await expect(page.getByTestId('search-mode')).toBeHidden();
    await expect(page.getByTestId('media-search-launcher')).toBeVisible();
  } else {
    await input.press('Escape');
    await expect(page.locator('[data-testid^="combobox-option-"]').first()).toBeHidden();
  }
}

for (const [surface, viewport, isPhone] of surfaces) {
  test(`[FIND.1b/AC1,AC2] ${surface}: one search and identical result verbs survive destination switches`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const input = await openSearch(page, isPhone);
    const scopes = await readLiveScopes(page);
    const selectable = scopes.find((scope) => scope.params != null) ?? scopes[0];
    test.skip(!selectable, 'Live media config exposes no selectable scope; FIND.1b cannot select a real configured scope.');

    await input.fill(query);
    if (selectable.key !== 'all') await scopeChip(page, isPhone, selectable.key).click();
    await waitForSearchSettled(page);
    await expect.poll(() => resultRows(page, isPhone).count(), { timeout: 20000 }).toBeGreaterThan(0);
    const id = await firstLeafId(page);
    test.skip(!id, `Live ${selectable.label} search for ${query} returned no leaf result; FIND.1b action parity requires a selectable leaf.`);

    const baseline = {
      query: await input.inputValue(),
      scope: await scopeChip(page, isPhone, selectable.key).getAttribute('aria-pressed'),
      id,
      actions: await actionSnapshot(page, id),
    };
    expect(baseline.scope).toBe('true');
    await expect(searchSurface(page, isPhone).getByTestId('destination-line-name')).toHaveText('This device');

    await setDestination(page, isPhone, 'acceptance-media');
    await expect(searchSurface(page, isPhone).getByTestId('destination-line-name')).toHaveText('Acceptance receiver');
    expect({
      query: await input.inputValue(),
      scope: await scopeChip(page, isPhone, selectable.key).getAttribute('aria-pressed'),
      id: await firstLeafId(page),
      actions: await actionSnapshot(page, id),
    }).toEqual(baseline);

    await setDestination(page, isPhone, null);
    await expect(searchSurface(page, isPhone).getByTestId('destination-line-name')).toHaveText('This device');
    expect({
      query: await input.inputValue(),
      scope: await scopeChip(page, isPhone, selectable.key).getAttribute('aria-pressed'),
      id: await firstLeafId(page),
      actions: await actionSnapshot(page, id),
    }).toEqual(baseline);
  });

  test(`[FIND.2a/AC1] ${surface}: every scope choice is visible beside search and All is current`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const input = await openSearch(page, isPhone);
    const scopes = await readLiveScopes(page);

    expect(scopes[0].key).toBe('all');
    await expect(scopeChip(page, isPhone, 'all')).toBeVisible();
    await expect(scopeChip(page, isPhone, 'all')).toHaveText(scopes[0].label);
    await expect(scopeChip(page, isPhone, 'all')).toHaveAttribute('aria-pressed', 'true');
    for (const scope of scopes) {
      await expect(scopeChip(page, isPhone, scope.key)).toBeVisible();
      await expect(scopeChip(page, isPhone, scope.key)).toHaveText(scope.label);
    }
    await expect(input).toBeVisible();
  });

  test(`[FIND.2a/AC2,AC4] ${surface}: selecting a configured kind reruns the same query and reopening resets to All`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const input = await openSearch(page, isPhone);
    const scopes = await readLiveScopes(page);
    const all = scopes[0];
    const video = scopes.find((scope) => scope.key === 'video');
    test.skip(!video, 'Live GET /api/v1/media/config does not expose scope key "video"; configured-scope result filtering cannot be assessed here.');
    test.skip(video.params == null, 'Live Video scope is grouping-only; its configured child scope is assessed separately under AC3.');

    await expect(scopeChip(page, isPhone, 'all')).toHaveAttribute('aria-pressed', 'true');
    const allRequest = streamRequestFor(page, query, all);
    await input.fill(query);
    await allRequest;
    await waitForSearchSettled(page);
    await expect.poll(() => resultRows(page, isPhone).count(), { timeout: 20000 })
      .toBeGreaterThan(0);
    const allResultIds = await visibleResultIds(page, isPhone);
    expect(allResultIds.length, `the real All search for ${query} should return results`).toBeGreaterThan(0);

    const scopedRequest = streamRequestFor(page, query, video);
    await scopeChip(page, isPhone, 'video').click();
    await scopedRequest;
    await expect(input).toHaveValue(query);
    await expect(scopeChip(page, isPhone, 'video')).toHaveAttribute('aria-pressed', 'true');
    await waitForSearchSettled(page);
    await expect.poll(() => resultRows(page, isPhone).count(), { timeout: 20000 })
      .toBeGreaterThan(0);
    const videoResultIds = await visibleResultIds(page, isPhone);
    expect(videoResultIds.length, 'the configured Video query should render its actual results').toBeGreaterThan(0);
    const videoKinds = await visibleResultKinds(page, isPhone);
    expect(videoKinds.length, 'each result exposes its dedicated kind subtitle').toBe(videoResultIds.length);
    expect(videoKinds.every(hasVideoKindSubtitle),
      'the dedicated result-kind subtitles returned by Video scope should identify video kinds').toBe(true);

    await closeSearch(page, input, isPhone);
    if (isPhone) {
      await page.getByTestId('media-search-launcher').click();
      await expect(page.getByTestId('search-mode')).toBeVisible();
    } else {
      await input.click();
    }
    await expect(scopeChip(page, isPhone, 'all')).toHaveAttribute('aria-pressed', 'true');
    await expect(scopeChip(page, isPhone, 'video')).toHaveAttribute('aria-pressed', 'false');
  });

  test(`[FIND.2a/AC3] ${surface}: configured parent and child scopes are both selectable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const input = await openSearch(page, isPhone);
    const scopes = await readLiveScopes(page);
    const parent = scopes.find((scope) => Array.isArray(scope.children) && scope.children.length > 0);
    test.skip(!parent, 'Live GET /api/v1/media/config exposes no parent with child scopes; FIND.2a AC3 is unverified for this household config.');
    test.skip(parent.params == null, `Live parent scope "${parent.key}" is grouping-only (no params), so it has no independently selectable parent-level search to compare with its child.`);

    const child = parent.children.find((scope) => scope.params != null);
    test.skip(!child, `Live parent scope "${parent.key}" exposes children but no searchable child scope; FIND.2a AC3 cannot be verified from this config.`);

    const parentChip = scopeChip(page, isPhone, parent.key);
    const childChip = scopeChip(page, isPhone, child.key);
    const parentRequest = streamRequestFor(page, query, parent);
    await input.fill(query);
    await parentChip.click();
    await parentRequest;
    await expect(parentChip).toHaveAttribute('aria-pressed', 'true');
    await waitForSearchSettled(page);

    await expect(childChip).toBeVisible();
    const childRequest = streamRequestFor(page, query, child);
    await childChip.click();
    await childRequest;
    await expect(input).toHaveValue(query);
    await expect(childChip).toHaveAttribute('aria-pressed', 'true');
    await expect(parentChip).toHaveAttribute('aria-pressed', 'false');
    await waitForSearchSettled(page);
    await expect.poll(() => resultRows(page, isPhone).count(), { timeout: 20000 })
      .toBeGreaterThan(0);
    expect(await visibleResultIds(page, isPhone).then((ids) => ids.length)).toBeGreaterThan(0);
  });
}
