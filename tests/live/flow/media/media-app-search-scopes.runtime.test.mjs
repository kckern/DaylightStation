import { openRowMenuAll } from './lib/search.mjs';
import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { aimAt, aimHere } from './lib/aim.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

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
  // Four verbs lead the menu; Play First and Open detail are behind its More (k).
  await openRowMenuAll(page, id);
  const menu = page.getByTestId(`result-more-menu-${id}`);
  await expect(menu).toBeVisible();
  const ids = ['playNow', 'playNext', 'upNext', 'add', 'detail'];
  const snapshot = await Promise.all(ids.map(async (action) => {
    const item = page.getByTestId(`result-action-${action}-${id}`);
    // The same verb whatever the destination: a menu item names the screen it
    // acts on ("Play Next on Acceptance receiver"), so compare the verb itself.
    const verb = (await item.textContent()).replace(/ on .+$/, '').replace(/^Play( Now| here)?$/, 'Play');
    return { action, verb, disabled: await item.isDisabled() };
  }));
  await page.keyboard.press('Escape');
  return snapshot;
}

function searchSurface(page, isPhone) {
  return isPhone ? page.getByTestId('search-mode') : page.getByTestId('media-search-bar');
}

// The destination is read and changed where it lives: the destination chip inside the phone's
// search sheet, the search box's "▶ <name>" destination chip everywhere else.
const destinationName = (page, isPhone) => (isPhone
  ? searchSurface(page, true).getByTestId('search-destination-chip')
  : page.getByTestId('search-destination-chip'));

async function setDestination(page, isPhone, targetId) {
  if (!isPhone) {
    // The search box chip: cycle to the screen, or to This device.
    if (targetId) await aimAt(page, targetId); else await aimHere(page);
    return;
  }
  // Phone: the search sheet's own chip (aimAt/aimHere step it while the sheet is open).
  if (targetId) await aimAt(page, targetId); else await aimHere(page);
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

    // A fresh browser has no destination yet ("Choose a screen"): start from This device.
    await setDestination(page, isPhone, null);
    const baseline = {
      query: await input.inputValue(),
      scope: await scopeChip(page, isPhone, selectable.key).getAttribute('aria-pressed'),
      id,
      actions: await actionSnapshot(page, id),
    };
    expect(baseline.scope).toBe('true');
    await expect(destinationName(page, isPhone)).toHaveText(/^(▶ )?(This device|this device)/);

    await setDestination(page, isPhone, 'acceptance-media');
    await expect(destinationName(page, isPhone)).toHaveText(/^(▶ |Playing on )?Acceptance receiver/);
    expect({
      query: await input.inputValue(),
      scope: await scopeChip(page, isPhone, selectable.key).getAttribute('aria-pressed'),
      id: await firstLeafId(page),
      actions: await actionSnapshot(page, id),
    }).toEqual(baseline);

    await setDestination(page, isPhone, null);
    await expect(destinationName(page, isPhone)).toHaveText(/^(▶ )?(This device|this device)/);
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

  test(`[FIND.2a/AC2,AC4] ${surface}: selecting a configured kind reruns the same query; reopening the phone sheet resets to All, the dock keeps it`, async ({ page }) => {
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
      // Back into the box (the narrow tablet box is mostly destination chip, so focus it).
      await input.focus();
    }
    if (isPhone) {
      // The phone's sheet opens a new search session: All again.
      await expect(scopeChip(page, isPhone, 'all')).toHaveAttribute('aria-pressed', 'true');
      await expect(scopeChip(page, isPhone, 'video')).toHaveAttribute('aria-pressed', 'false');
    } else {
      // The dock's box keeps its words on close, and with them their kind, so
      // the results on reopen are the ones it found (MediaContentSearch).
      await expect(input).toHaveValue(query);
      await expect(scopeChip(page, isPhone, 'video')).toHaveAttribute('aria-pressed', 'true');
    }
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

// A picked scope is honoured (2026-11-27). Books › Scripture searched "Nephi"
// and found nothing (the scripture search only knew Bible book names), and the
// search then widened to everything on its own, so the person saw unrelated
// results under the Scripture chip.
function findScope(scopes, key) {
  for (const scope of scopes) {
    if (scope.key === key) return { scope, parent: null };
    const child = (scope.children || []).find((c) => c.key === key);
    if (child) return { scope: child, parent: scope };
  }
  return { scope: null, parent: null };
}

async function pickScope(page, isPhone, scopes, key) {
  const { scope, parent } = findScope(scopes, key);
  expect(scope, `the live media config must offer the "${key}" scope`).toBeTruthy();
  if (parent) await scopeChip(page, isPhone, parent.key).click();
  await scopeChip(page, isPhone, key).click();
  await expect(scopeChip(page, isPhone, key)).toHaveAttribute('aria-pressed', 'true');
  return scope;
}

for (const [surface, viewport, isPhone] of surfaces) {
  test(`[SCOPE.honoured] ${surface}: Books › Scripture finds "Nephi" in the Book of Mormon`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const input = await openSearch(page, isPhone);
    const scopes = await readLiveScopes(page);
    const scripture = await pickScope(page, isPhone, scopes, 'books-scripture');

    const request = streamRequestFor(page, 'Nephi', scripture);
    await input.fill('Nephi');
    await request;
    await waitForSearchSettled(page);
    await expect.poll(() => resultRows(page, isPhone).count(), { timeout: 30000 }).toBeGreaterThan(0);
    const text = (await visibleResultText(page, isPhone)).join('\n');
    expect(text).toMatch(/1 Nephi/);
    expect(text).toMatch(/2 Nephi/);
    await expect(scopeChip(page, isPhone, 'books-scripture')).toHaveAttribute('aria-pressed', 'true');
  });

  test(`[SCOPE.honoured] ${surface}: a picked scope with nothing stays picked and offers Search everything`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const input = await openSearch(page, isPhone);
    const scopes = await readLiveScopes(page);
    const scripture = await pickScope(page, isPhone, scopes, 'books-scripture');
    const words = 'zzqx nothing here';

    const unscoped = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.pathname.endsWith('/api/v1/content/query/search/stream')
        && url.searchParams.get('text') === words
        && !url.searchParams.get('source')) unscoped.push(url.search);
    });
    const request = streamRequestFor(page, words, scripture);
    await input.fill(words);
    await request;

    const notice = page.getByTestId(isPhone ? 'search-mode-scope-empty' : 'combobox-scope-empty');
    await expect(notice).toContainText(`Nothing for “${words}” in ${scripture.label}`, { timeout: 30000 });
    await expect(resultRows(page, isPhone)).toHaveCount(0);
    await expect(scopeChip(page, isPhone, 'books-scripture')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1500); // nothing widens behind the person's back
    expect(unscoped).toEqual([]);

    const all = scopes[0];
    const widened = streamRequestFor(page, words, all);
    if (isPhone) {
      await page.getByTestId('search-mode-widen').click();
    } else {
      // A keyboard row: Enter on the empty scope searches everything.
      await input.press('Enter');
    }
    await widened;
    expect(unscoped.length).toBe(1);
  });
}
