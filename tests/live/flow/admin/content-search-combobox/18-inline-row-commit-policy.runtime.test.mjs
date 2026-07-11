// tests/live/flow/admin/content-search-combobox/18-inline-row-commit-policy.runtime.test.mjs
/**
 * Commit-policy regression suite for the INLINE row combobox
 * (ContentSearchCombobox inside ListsItemRow.jsx) — the twin that lives on
 * the real list-row surface at /admin/content/lists/menus/adhoc, NOT the
 * /admin/test/combobox harness page.
 *
 * Pins the commit policy:
 *   A. Blur must NOT commit exploratory (non id-like) text   — EXPECTED RED today
 *   B. Id-like text MUST commit exactly once on blur          — expected green (Mar-01 invariant)
 *   C. EmptyItemRow must not auto-add freeform text           — EXPECTED RED today
 *
 * A and C are deliberate failing specs (see docs/_wip/bugs/2026-03-01-admin-menu-editor-junk-entries.md
 * and the admin UX remediation plan). Tasks 3-4 turn them green. Do NOT
 * "fix" these tests by loosening assertions.
 *
 * IMPORTANT: this suite mutates the REAL household list `menus/adhoc`.
 * beforeEach snapshots the full list via the API; afterEach deep-restores it
 * (delete junk rows, restore mutated fields) and asserts the final GET is
 * deep-equal to the snapshot — even when a test body fails.
 *
 * Created: 2026-07-09
 */
import { test, expect } from '@playwright/test';

const LIST_URL = '/admin/content/lists/menus/adhoc';
const API_PATH = '/api/v1/admin/content/lists/menus/adhoc';
const ORIGINAL_ROW0_INPUT = 'plex:660440';
const ID_LIKE_TEXT = 'plex:999999999';
const JUNK_MARKER = 'zzqx';

// Blur commit chain: 150ms blur timeout + PUT + refetch. 900ms gives margin.
const BLUR_COMMIT_WAIT_MS = 900;
// Search debounce inside the combobox is 300ms.
const SEARCH_DEBOUNCE_WAIT_MS = 450;

// ── API helpers (node-side fetch, same origin as the page via baseURL) ──────

async function apiGetList(baseURL) {
  const res = await fetch(`${baseURL}${API_PATH}`);
  if (!res.ok) throw new Error(`GET ${API_PATH} failed: ${res.status}`);
  return res.json();
}

async function apiUpdateItem(baseURL, sectionIndex, itemIndex, updates) {
  const res = await fetch(`${baseURL}${API_PATH}/items/${itemIndex}?section=${sectionIndex}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`PUT item ${sectionIndex}/${itemIndex} failed: ${res.status}`);
  return res.json();
}

async function apiDeleteItem(baseURL, sectionIndex, itemIndex) {
  const res = await fetch(`${baseURL}${API_PATH}/items/${itemIndex}?section=${sectionIndex}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`DELETE item ${sectionIndex}/${itemIndex} failed: ${res.status}`);
  return res.json();
}

function countItems(list) {
  return (list.sections || []).reduce((n, s) => n + (s.items?.length || 0), 0);
}

// ── UI helpers ───────────────────────────────────────────────────────────────

async function openListPage(page) {
  await page.goto(LIST_URL);
  // Wait for both real rows to render (fixture: 1 section, 2 rows).
  await expect(page.getByTestId('item-row-0-0')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('item-row-0-1')).toBeVisible({ timeout: 20000 });
  expect(await page.locator('.item-row').count()).toBeGreaterThanOrEqual(2);
}

/** Click the display card in a row's .col-input and wait for the edit textbox. */
async function enterEditMode(rowLocator) {
  const display = rowLocator.locator('.col-input .content-display');
  await expect(display).toBeVisible({ timeout: 15000 });
  await display.click();
  const input = rowLocator.locator('.col-input input');
  await expect(input).toBeVisible({ timeout: 5000 });
  return input;
}

/** Blur the combobox by clicking an inert element elsewhere (the page title). */
async function blurByClickingAway(page) {
  await page.locator('.ds-page-title').click();
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Inline row combobox — commit policy (menus/adhoc)', () => {
  /** @type {object} full list JSON captured before each test */
  let snapshot;
  /** @type {Array<{method: string, url: string, postData: string|null}>} */
  let recorded;

  test.beforeEach(async ({ page, baseURL }) => {
    // Snapshot the live fixture. Fail fast if it has drifted from the known
    // state (a prior aborted run left junk behind) — restoring blind would
    // mask that.
    snapshot = await apiGetList(baseURL);
    expect(snapshot.sections[0].items[0].input).toBe(ORIGINAL_ROW0_INPUT);
    const preExistingJunk = snapshot.sections.flatMap(s => s.items)
      .filter(i => (i.input || '').includes(JUNK_MARKER) || (i.label || '').includes(JUNK_MARKER));
    expect(preExistingJunk).toEqual([]);

    // Record every admin-content API request without blocking it.
    recorded = [];
    await page.route('**/api/v1/admin/content/**', async (route) => {
      const req = route.request();
      recorded.push({ method: req.method(), url: req.url(), postData: req.postData() });
      await route.continue();
    });
  });

  test.afterEach(async ({ page, baseURL }) => {
    // Kill the page first so no in-flight timer (blur commit, 15s auto-resolve)
    // can fire another mutation while/after we restore.
    await page.close();

    // 1) Delete any row not present in the snapshot (junk auto-adds),
    //    highest index first so indices stay valid.
    let current = await apiGetList(baseURL);
    for (let si = 0; si < current.sections.length; si++) {
      const origUids = new Set((snapshot.sections[si]?.items || []).map(i => i.uid));
      const items = current.sections[si].items || [];
      for (let ii = items.length - 1; ii >= 0; ii--) {
        if (!origUids.has(items[ii].uid)) {
          await apiDeleteItem(baseURL, si, ii);
        }
      }
    }

    // 2) Restore any mutated fields on the surviving original rows.
    current = await apiGetList(baseURL);
    for (let si = 0; si < snapshot.sections.length; si++) {
      const origItems = snapshot.sections[si].items || [];
      for (let ii = 0; ii < origItems.length; ii++) {
        const orig = origItems[ii];
        const cur = current.sections[si]?.items?.[ii];
        if (!cur) throw new Error(`Restore failed: item ${si}/${ii} missing after junk cleanup`);
        const updates = {};
        if (cur.label !== orig.label) updates.label = orig.label;
        if (cur.input !== orig.input) updates.input = orig.input;
        if (cur.action !== orig.action) updates.action = orig.action;
        if (Object.keys(updates).length > 0) {
          await apiUpdateItem(baseURL, si, ii, updates);
        }
      }
    }

    // 3) Verify restoration: the list must be deep-equal to the pre-test snapshot.
    const final = await apiGetList(baseURL);
    expect(final).toEqual(snapshot);
  });

  // ── Case A — EXPECTED RED today (blur commits exploratory text) ───────────
  test('A. blur must NOT commit exploratory (non id-like) text', async ({ page, baseURL }) => {
    await openListPage(page);

    const row0 = page.getByTestId('item-row-0-0');
    const input = await enterEditMode(row0);
    // Edit mode primes the textbox with the current value — proves we are on
    // the real inline combobox, not a stale selector.
    await expect(input).toHaveValue(ORIGINAL_ROW0_INPUT);

    await input.fill('');
    await input.pressSequentially(`${JUNK_MARKER} exploratory text`, { delay: 20 });
    await expect(input).toHaveValue(`${JUNK_MARKER} exploratory text`);

    await blurByClickingAway(page);
    await page.waitForTimeout(BLUR_COMMIT_WAIT_MS);

    // No mutation containing the exploratory text may have been sent.
    const junkMutations = recorded.filter(r =>
      (r.method === 'PUT' || r.method === 'POST') &&
      ((r.postData || '').includes(JUNK_MARKER) || r.url.includes(JUNK_MARKER))
    );
    expect(junkMutations).toEqual([]);

    // And the persisted state must still hold the original input (assert via
    // the API, not the DOM). Note: even if the junk PUT above was somehow
    // missed, a background auto-resolve may have replaced the value with a
    // search hit — this catches that variant too.
    await page.reload();
    const list = await apiGetList(baseURL);
    expect(list.sections[0].items[0].input).toBe(ORIGINAL_ROW0_INPUT);
  });

  // ── Case B — expected GREEN (the Mar-01 invariant) ─────────────────────────
  test('B. id-like text MUST commit exactly once on blur', async ({ page, baseURL }) => {
    await openListPage(page);

    const row0 = page.getByTestId('item-row-0-0');
    const input = await enterEditMode(row0);
    await expect(input).toHaveValue(ORIGINAL_ROW0_INPUT);

    await input.fill('');
    await input.pressSequentially(ID_LIKE_TEXT, { delay: 20 });
    await expect(input).toHaveValue(ID_LIKE_TEXT);

    await blurByClickingAway(page);
    await page.waitForTimeout(BLUR_COMMIT_WAIT_MS);

    // Exactly one update request carrying the id-like value.
    const commits = recorded.filter(r =>
      (r.method === 'PUT' || r.method === 'POST') &&
      (r.postData || '').includes(ID_LIKE_TEXT)
    );
    expect(commits).toHaveLength(1);
    expect(commits[0].method).toBe('PUT');
    expect(commits[0].url).toContain('/items/0?section=0');

    // Persisted via the API.
    const list = await apiGetList(baseURL);
    expect(list.sections[0].items[0].input).toBe(ID_LIKE_TEXT);

    // Inline restore + verify (afterEach re-verifies the full snapshot).
    await apiUpdateItem(baseURL, 0, 0, { input: ORIGINAL_ROW0_INPUT });
    const restored = await apiGetList(baseURL);
    expect(restored.sections[0].items[0].input).toBe(ORIGINAL_ROW0_INPUT);
  });

  // ── Case C — EXPECTED RED today (EmptyItemRow auto-adds freeform text) ────
  // Two abandonment paths, neither may create a row:
  //   C1: type junk → Escape → click away   (explicit cancel)
  //   C2: type junk → click away            (blur-commit → setInput → auto-add,
  //       the exact chain behind docs/_wip/bugs/2026-03-01-admin-menu-editor-junk-entries.md —
  //       this is the path that fires a POST today)
  test('C. EmptyItemRow must not auto-add freeform text', async ({ page, baseURL }) => {
    const before = await apiGetList(baseURL);
    const beforeCount = countItems(before);

    await openListPage(page);

    const emptyRow = page.locator('.item-row.empty-row');
    await expect(emptyRow).toBeVisible({ timeout: 15000 });

    // C1: explicit cancel via Escape must never add.
    let input = await enterEditMode(emptyRow);
    await input.pressSequentially(`${JUNK_MARKER} junk entry`, { delay: 20 });
    await expect(input).toHaveValue(`${JUNK_MARKER} junk entry`);
    await page.waitForTimeout(SEARCH_DEBOUNCE_WAIT_MS); // let the search debounce fire
    await input.press('Escape');
    await blurByClickingAway(page);
    await page.waitForTimeout(BLUR_COMMIT_WAIT_MS);

    // C2: plain click-away (no Escape) must not add either.
    input = await enterEditMode(emptyRow);
    await input.pressSequentially(`${JUNK_MARKER} junk entry`, { delay: 20 });
    await expect(input).toHaveValue(`${JUNK_MARKER} junk entry`);
    await page.waitForTimeout(SEARCH_DEBOUNCE_WAIT_MS);
    await blurByClickingAway(page);
    await page.waitForTimeout(BLUR_COMMIT_WAIT_MS);

    // No add (POST) may have been fired on either path.
    const adds = recorded.filter(r => r.method === 'POST');
    expect(adds).toEqual([]);

    // And the item count must be unchanged (assert via the API).
    const after = await apiGetList(baseURL);
    expect(countItems(after)).toBe(beforeCount);
  });
});
