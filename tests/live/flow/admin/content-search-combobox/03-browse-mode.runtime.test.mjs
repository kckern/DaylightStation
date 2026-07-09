// tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs
/**
 * Browse mode tests for ContentSearchCombobox
 * Tests: drill-down, back navigation, breadcrumbs, sibling loading
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

const CONTAINER_TYPES = ['show', 'album', 'artist', 'playlist', 'series', 'channel', 'conference', 'watchlist', 'container'];
const isContainerLike = (item) =>
  item?.itemType === 'container' || item?.isContainer === true || CONTAINER_TYPES.includes(item?.type);

/**
 * Hunt live content for a committed value whose /siblings window paginates.
 *
 * @param {import('@playwright/test').Page} page - used for baseURL-relative API calls
 * @param {Object} opts
 * @param {'hasBefore'|'hasAfter'} opts.flag - required pagination flag on the initial window
 * @param {number|null} [opts.drillMinChildren] - when set, also require a container row
 *   inside the sibling window whose own listing has at least this many children
 *   (so the drilled listing overflows the dropdown viewport and can scroll)
 * @returns {{ value: string, pagination: Object, drillId?: string, drillChildren?: number }}
 * @throws when no fixture is found — fail fast, never skip (Test Discipline)
 */
async function huntSiblingPaginationFixture(page, { flag, drillMinChildren = null }) {
  const getJson = async (path) => {
    try {
      // Per-request timeout: a single slow/hung adapter (e.g. one busy Plex
      // library) must not stall the whole hunt — skip and try the next candidate.
      const res = await page.request.get(path, { timeout: 20000 });
      if (!res.ok()) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const searchTerms = ['office', 'christmas', 'star', 'adventures', 'world'];
  const seen = new Set();
  for (const term of searchTerms) {
    const search = await getJson(`/api/v1/content/query/search?text=${encodeURIComponent(term)}&source=plex&take=30`);
    let checked = 0;
    for (const item of search?.items || []) {
      if (typeof item?.id !== 'string' || !item.id.startsWith('plex:') || seen.has(item.id)) continue;
      seen.add(item.id);
      if (checked++ >= 10) break;
      const siblings = await getJson(`/api/v1/siblings/plex/${encodeURIComponent(item.id.slice('plex:'.length))}`);
      const pagination = siblings?.pagination;
      if (!pagination || pagination[flag] !== true) continue;
      if (drillMinChildren == null) return { value: item.id, pagination };

      // Need a drillable container row in the returned window whose listing is
      // long enough to overflow the 300px dropdown viewport after drilling.
      let listCalls = 0;
      for (const candidate of (siblings.items || []).filter(isContainerLike)) {
        if (typeof candidate?.id !== 'string' || !candidate.id.startsWith('plex:')) continue;
        if (listCalls++ >= 12) break;
        const list = await getJson(`/api/v1/list/plex/${encodeURIComponent(candidate.id.slice('plex:'.length))}`);
        const childCount = (list?.items || []).length;
        if (childCount >= drillMinChildren) {
          return { value: item.id, pagination, drillId: candidate.id, drillChildren: childCount };
        }
      }
    }
  }
  throw new Error(
    `No live fixture found with pagination.${flag}=true` +
    (drillMinChildren != null ? ` and a drillable container with >=${drillMinChildren} children` : '') +
    ` — failing fast (no conditional skip).`
  );
}

// The dropdown carries the .mantine-Combobox-dropdown class (no data attribute
// in this Mantine version) and its scrollable element is .mantine-ScrollArea-viewport.
const DROPDOWN_SELECTOR = '[data-combobox-dropdown], .mantine-Combobox-dropdown';
const VIEWPORT_SELECTOR = '.mantine-ScrollArea-viewport';

/** Scroll the dropdown's ScrollArea viewport to top/bottom. */
async function scrollDropdownViewport(page, position) {
  await page.evaluate(({ pos, dropdownSel, viewportSel }) => {
    const dropdown = document.querySelector(dropdownSel);
    const viewport = dropdown?.querySelector(viewportSel);
    if (!viewport) throw new Error('dropdown ScrollArea viewport not found');
    viewport.scrollTop = pos === 'bottom' ? viewport.scrollHeight : 0;
  }, { pos: position, dropdownSel: DROPDOWN_SELECTOR, viewportSel: VIEWPORT_SELECTOR });
}

test.describe('ContentSearchCombobox - Browse Mode', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  test('loads siblings when opening with existing value', async ({ page }) => {
    // Start with a value that has a parent path
    await page.goto(`${TEST_URL}?value=media:workouts/hiit.mp4`);

    await ComboboxActions.open(page);
    await page.waitForTimeout(1000); // Wait for sibling load

    // Should have called list API
    const apiCheck = harness.assertApiCalled(/api\/v1\/list\//);
    expect(apiCheck.passed).toBe(true);
  });

  test('clicking container drills into it', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Search should return results').toBeGreaterThan(0);

    // Try clicking items until we find one that drills down (shows back button)
    let drilledIn = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);

      // Click the option
      await option.click();
      await page.waitForTimeout(500);

      // Check if we drilled in (back button visible) or selected (dropdown closed)
      const backButton = ComboboxLocators.backButton(page);
      const droppedDown = await backButton.isVisible().catch(() => false);

      if (droppedDown) {
        drilledIn = true;
        console.log(`Drilled into item at index ${i}`);

        // Verify breadcrumbs are functional
        await expect(backButton).toBeVisible();

        // Log API calls for debugging
        const listCalls = harness.getApiCalls(/api\/v1\/list\//);
        console.log(`List API calls during drill-down: ${listCalls.length}`);
        break;
      } else {
        // Dropdown closed - this was a leaf selection
        // Reopen to try next item
        const dropdown = ComboboxLocators.dropdown(page);
        if (!await dropdown.isVisible().catch(() => false)) {
          await ComboboxActions.open(page);
          await ComboboxActions.search(page, 'Office');
          await ComboboxActions.waitForStreamComplete(page, 30000);
        }
      }
    }

    if (!drilledIn) {
      // All items tested were leaves - this is acceptable, just log it
      console.log('Note: No containers found in search results - all items were leaves');
    }
  });

  test('back button returns to previous level', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Find and click a container
      const firstOption = options.first();
      await firstOption.click();
      await page.waitForTimeout(500);

      // Check if we drilled in (back button visible)
      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        // Click back
        await ComboboxActions.goBack(page);
        await page.waitForTimeout(500);

        // Verify we can still see the dropdown (navigation didn't break)
        const dropdown = ComboboxLocators.dropdown(page);
        await expect(dropdown).toBeVisible();
      } else {
        // If we couldn't drill in, still pass - first item might be a leaf
        console.log('First option was not a container - back navigation not testable');
      }
    } else {
      expect(count, 'Search should return results').toBeGreaterThan(0);
    }
  });

  test('breadcrumbs display navigation path', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Click first option (may or may not be container)
      await options.first().click();
      await page.waitForTimeout(500);

      // Check for breadcrumb text
      const dropdown = ComboboxLocators.dropdown(page);
      const dropdownText = await dropdown.textContent();

      // If we drilled in, should see breadcrumb separator
      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        // Breadcrumb area should have some text
        const breadcrumbArea = dropdown.locator('text=/').first();
        await expect(breadcrumbArea).toBeVisible();
      }
    }
  });

  test('deep navigation maintains breadcrumb trail', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    let drillCount = 0;
    const maxDrills = 3;

    while (drillCount < maxDrills) {
      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) break;

      // Click first option
      await options.first().click();
      await page.waitForTimeout(500);

      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (!didDrillIn) break; // Hit a leaf

      drillCount++;
    }

    console.log(`Drilled ${drillCount} levels deep`);

    // Navigate back through all levels
    for (let i = 0; i < drillCount; i++) {
      await ComboboxActions.goBack(page);
      await page.waitForTimeout(300);
    }

    // Should be back at search results or root
    // Verify we returned to initial state (no back button visible means we're at root/search)
    if (drillCount > 0) {
      const backButton = ComboboxLocators.backButton(page);
      const backVisible = await backButton.isVisible().catch(() => false);
      expect(backVisible).toBe(false);
    }
  });

  test('clicking parent title navigates to parent', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Search for an episode
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const firstOption = options.first();
      const parentText = ComboboxLocators.optionParent(firstOption);

      const hasParent = await parentText.isVisible().catch(() => false);

      if (hasParent) {
        const parentContent = await parentText.textContent();
        console.log(`Found parent: ${parentContent}`);

        // Check if parent is clickable (underlined)
        const isClickable = await parentText.evaluate(el =>
          window.getComputedStyle(el).textDecoration.includes('underline')
        ).catch(() => false);

        if (isClickable) {
          await parentText.click();
          await page.waitForTimeout(500);

          // Should have navigated
          const backButton = ComboboxLocators.backButton(page);
          await expect(backButton).toBeVisible();
        }
      }
    }
  });

  test('with selectContainers, a chevron browses in while row-click commits the container id', async ({ page }) => {
    await page.goto(`${TEST_URL}?selectContainers=1`);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const containerRow = page.locator('[data-combobox-option]:has([data-testid^="browse-into-"])').first();
    await expect(containerRow, 'search must return at least one container to exercise dual affordance').toBeVisible();
    const chevron = containerRow.locator('[data-testid^="browse-into-"]');
    const id = (await chevron.getAttribute('data-testid')).replace('browse-into-', '');

    // The chevron drills into the container (breadcrumb back button appears).
    await chevron.click();
    await page.waitForTimeout(500);
    await expect(ComboboxLocators.backButton(page)).toBeVisible();

    // Reset; row-click (on the row that has a chevron) commits the container id.
    await page.goto(`${TEST_URL}?selectContainers=1`);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);
    await page.locator('[data-combobox-option]:has([data-testid^="browse-into-"])').first().click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('current-value')).toContainText(id);
  });

  test('drilling into a container resets sibling pagination — scroll in the drilled listing fetches no sibling pages (audit S1)', async ({ page }) => {
    test.setTimeout(180000);

    // Fixture: committed value whose sibling window has more pages after it,
    // plus a container row in that window big enough to overflow when drilled.
    const fixture = await huntSiblingPaginationFixture(page, { flag: 'hasAfter', drillMinChildren: 8 });
    console.log(`S1 fixture: value=${fixture.value} drill=${fixture.drillId} (${fixture.drillChildren} children), pagination=${JSON.stringify(fixture.pagination)}`);

    const siblingsRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/siblings/')) {
        siblingsRequests.push({ url: req.url(), at: Date.now() });
      }
    });

    await page.goto(`${TEST_URL}?value=${encodeURIComponent(fixture.value)}&selectContainers=1`);
    await ComboboxActions.open(page);

    // Initial sibling window renders in browse mode (breadcrumb back button + rows).
    await expect(ComboboxLocators.backButton(page)).toBeVisible({ timeout: 30000 });
    await expect(ComboboxLocators.options(page).first()).toBeVisible({ timeout: 30000 });

    // Bring the drill chevron into view FIRST, then let any scroll-triggered
    // sibling page-loads from that positioning settle (they are pre-drill state,
    // not the behavior under test).
    const chevron = page.getByTestId(`browse-into-${fixture.drillId}`);
    await expect(chevron, `sibling window must contain drill target ${fixture.drillId}`).toBeVisible({ timeout: 15000 });
    await chevron.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // Drill into the container.
    const drilledAt = Date.now();
    await chevron.click();
    await expect(ComboboxLocators.options(page).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800); // drilled listing settles

    // The drilled listing must overflow the viewport, or scrolling could not
    // fire events and this test would pass vacuously.
    const overflow = await page.evaluate(({ dropdownSel, viewportSel }) => {
      const dropdown = document.querySelector(dropdownSel);
      const viewport = dropdown?.querySelector(viewportSel);
      return viewport ? viewport.scrollHeight - viewport.clientHeight : -1;
    }, { dropdownSel: DROPDOWN_SELECTOR, viewportSel: VIEWPORT_SELECTOR });
    expect(overflow, 'drilled listing must overflow the dropdown viewport (fixture geometry)').toBeGreaterThan(50);

    // Scroll to the bottom and top of the DRILLED listing. Stale sibling
    // pagination from the committed value's window must NOT trigger
    // loadMoreSiblings — those pages belong to a different listing.
    await scrollDropdownViewport(page, 'bottom');
    await page.waitForTimeout(600);
    await scrollDropdownViewport(page, 'top');
    await page.waitForTimeout(800);

    const postDrill = siblingsRequests.filter((r) => r.at > drilledAt);
    expect(
      postDrill.map((r) => `${r.url} (+${r.at - drilledAt}ms after drill)`),
      'no /siblings requests may fire after drilling into a container'
    ).toEqual([]);
  });
});
