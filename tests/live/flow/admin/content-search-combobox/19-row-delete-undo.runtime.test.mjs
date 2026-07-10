// tests/live/flow/admin/content-search-combobox/19-row-delete-undo.runtime.test.mjs
/**
 * Row-delete undo-toast regression (audit C4).
 *
 * The row overflow menu's Delete removes the item immediately and shows a
 * transient Undo toast; clicking Undo re-adds the item at its original
 * position. Pins:
 *   A. Delete removes the row and shows the Undo toast.
 *   B. Undo restores the row (same content) — verified via the API.
 *
 * Mutates the REAL household list `menus/adhoc`. Because Undo re-adds with a
 * fresh uid, restoration is verified/repaired by CONTENT (input/label/action
 * + count + order), not by uid deep-equality.
 *
 * Created: 2026-07-10
 */
import { test, expect } from '@playwright/test';

const LIST_URL = '/admin/content/lists/menus/adhoc';
const API_PATH = '/api/v1/admin/content/lists/menus/adhoc';
const ROW0_INPUT = 'plex:660440';
const ROW1_INPUT = 'app:wrapup';

async function apiGetList(baseURL) {
  const res = await fetch(`${baseURL}${API_PATH}`);
  if (!res.ok) throw new Error(`GET ${API_PATH} failed: ${res.status}`);
  return res.json();
}
async function apiAddItem(baseURL, sectionIndex, item) {
  const res = await fetch(`${baseURL}${API_PATH}/items?section=${sectionIndex}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`POST item failed: ${res.status}`);
  return res.json();
}
async function apiDeleteItem(baseURL, sectionIndex, itemIndex) {
  const res = await fetch(`${baseURL}${API_PATH}/items/${itemIndex}?section=${sectionIndex}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE item failed: ${res.status}`);
  return res.json();
}
function sectionItems(list, si = 0) {
  return list.sections?.[si]?.items || [];
}
function inputsOf(list, si = 0) {
  return sectionItems(list, si).map((i) => i.input);
}

test.describe('Row delete + undo (menus/adhoc)', () => {
  let snapshot;

  test.beforeEach(async ({ page, baseURL }) => {
    snapshot = await apiGetList(baseURL);
    // Fail fast if the fixture has drifted (a prior aborted run).
    expect(inputsOf(snapshot)).toEqual([ROW0_INPUT, ROW1_INPUT]);
  });

  test.afterEach(async ({ page, baseURL }) => {
    await page.close();
    // Content-based repair to the canonical 2-row fixture (uid may differ
    // after an undo re-add; that's fine — beforeEach only checks inputs).
    let current = await apiGetList(baseURL);
    // Delete any rows beyond the canonical two, or wrong content, high index first.
    let items = sectionItems(current);
    for (let ii = items.length - 1; ii >= 0; ii--) {
      const okAt0 = ii === 0 && items[ii].input === ROW0_INPUT;
      const okAt1 = ii === 1 && items[ii].input === ROW1_INPUT;
      if (!okAt0 && !okAt1) await apiDeleteItem(baseURL, 0, ii);
    }
    // Re-add any missing canonical row in order.
    current = await apiGetList(baseURL);
    if (!inputsOf(current).includes(ROW0_INPUT)) {
      const orig = snapshot.sections[0].items.find((i) => i.input === ROW0_INPUT);
      await apiAddItem(baseURL, 0, { label: orig.label, action: orig.action, input: orig.input, active: true });
    }
    current = await apiGetList(baseURL);
    if (!inputsOf(current).includes(ROW1_INPUT)) {
      const orig = snapshot.sections[0].items.find((i) => i.input === ROW1_INPUT);
      await apiAddItem(baseURL, 0, { label: orig.label, action: orig.action, input: orig.input, active: true });
    }
    const final = await apiGetList(baseURL);
    expect(inputsOf(final)).toEqual([ROW0_INPUT, ROW1_INPUT]);
  });

  test('deletes the row, shows Undo toast, and Undo restores it', async ({ page, baseURL }) => {
    await page.goto(LIST_URL);
    await expect(page.getByTestId('item-row-0-0')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('item-row-0-1')).toBeVisible({ timeout: 20000 });

    // Delete the last row (app:wrapup) via its overflow menu.
    await page.getByTestId('row-menu-0-1').click();
    await page.getByTestId('row-delete-0-1').click();

    // Undo toast appears.
    const undoBtn = page.getByTestId('undo-toast-button');
    await expect(undoBtn).toBeVisible({ timeout: 5000 });

    // The row is gone (list now has 1 item on the server).
    await expect.poll(async () => inputsOf(await apiGetList(baseURL)).length, { timeout: 8000 }).toBe(1);
    expect(inputsOf(await apiGetList(baseURL))).toEqual([ROW0_INPUT]);

    // Click Undo → row restored (same content, back at index 1).
    await undoBtn.click();
    await expect.poll(async () => inputsOf(await apiGetList(baseURL)).length, { timeout: 8000 }).toBe(2);
    expect(inputsOf(await apiGetList(baseURL))).toEqual([ROW0_INPUT, ROW1_INPUT]);
  });
});
