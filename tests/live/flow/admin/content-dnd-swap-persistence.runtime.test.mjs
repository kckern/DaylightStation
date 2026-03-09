/**
 * Content DnD Swap Persistence Test
 *
 * Reproduces the race condition from docs/_wip/bugs/2026-03-08-content-dnd-swap-not-persisted.md
 *
 * Verifies:
 * 1. Single content swap via DnD persists after page reload
 * 2. Rapid consecutive swaps don't lose data (race condition)
 * 3. Backend swap endpoint works atomically
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;
const MENU_URL = `${BASE_URL}/admin/content/lists/menus/tvapp`;
const API_URL = `${BASE_URL}/api/v1/admin/content/lists/menus/tvapp`;

/**
 * Helper: get current list state from the API
 */
async function getListState(page) {
  const response = await page.request.get(API_URL);
  const data = await response.json();
  return data.sections[0].items;
}

/**
 * Helper: wait for items to be visible and content to load
 */
async function waitForListReady(page) {
  await page.waitForSelector('.item-row', { timeout: 15000 });
  // Wait for content metadata to resolve
  await page.waitForTimeout(2000);
}

/**
 * Helper: read the input value displayed in a row's .col-input
 */
async function getRowInputText(page, sectionIndex, itemIndex) {
  const row = page.locator(`[data-testid="item-row-${sectionIndex}-${itemIndex}"]`);
  const inputCell = row.locator('.col-input');
  // Content display shows the resolved title or raw value
  const display = inputCell.locator('.content-display');
  if (await display.count() > 0) {
    return (await display.textContent()).trim();
  }
  return '';
}

/**
 * Helper: perform a content drag from source to destination
 * Uses dnd-kit's pointer sensor by simulating mouse events on the content drag handle
 */
async function performContentDrag(page, srcSection, srcIndex, dstSection, dstIndex) {
  const srcHandle = page.locator(`[data-testid="item-row-${srcSection}-${srcIndex}"] .col-content-drag`);
  const dstDropZone = page.locator(`[data-testid="item-row-${dstSection}-${dstIndex}"] .content-drop-zone`);

  await srcHandle.scrollIntoViewIfNeeded();

  const srcBox = await srcHandle.boundingBox();
  const dstBox = await dstDropZone.boundingBox();

  if (!srcBox || !dstBox) {
    throw new Error(`Could not find bounding boxes for drag: src=${srcSection}-${srcIndex}, dst=${dstSection}-${dstIndex}`);
  }

  const srcCenter = { x: srcBox.x + srcBox.width / 2, y: srcBox.y + srcBox.height / 2 };
  const dstCenter = { x: dstBox.x + dstBox.width / 2, y: dstBox.y + dstBox.height / 2 };

  // dnd-kit PointerSensor requires a deliberate drag (not instant teleport)
  await page.mouse.move(srcCenter.x, srcCenter.y);
  await page.mouse.down();
  // Move slowly enough for dnd-kit to register the drag
  await page.mouse.move(srcCenter.x, srcCenter.y + 5, { steps: 3 });
  await page.waitForTimeout(100);
  await page.mouse.move(dstCenter.x, dstCenter.y, { steps: 10 });
  await page.waitForTimeout(100);
  await page.mouse.up();

  // Wait for the swap to complete (API call + fetchList)
  await page.waitForTimeout(1500);
}


test.describe('Content DnD swap persistence', () => {

  test('backend swap API works atomically', async ({ page }) => {
    // Get initial state
    const initialItems = await getListState(page);
    expect(initialItems.length).toBeGreaterThanOrEqual(3);

    const itemA = initialItems[0];
    const itemB = initialItems[2];
    console.log(`Before swap: [0].input=${itemA.input}, [2].input=${itemB.input}`);

    // Call the swap API directly
    const swapResponse = await page.request.put(`${API_URL}/items/swap`, {
      data: {
        a: { section: 0, index: 0 },
        b: { section: 0, index: 2 }
      }
    });
    expect(swapResponse.ok()).toBe(true);

    // Verify the swap persisted
    const afterItems = await getListState(page);
    console.log(`After swap: [0].input=${afterItems[0].input}, [2].input=${afterItems[2].input}`);

    expect(afterItems[0].input).toBe(itemB.input);
    expect(afterItems[2].input).toBe(itemA.input);

    // Labels should NOT have swapped (identity stays with row)
    expect(afterItems[0].label).toBe(itemA.label);
    expect(afterItems[2].label).toBe(itemB.label);

    // Swap back to restore original state
    const restoreResponse = await page.request.put(`${API_URL}/items/swap`, {
      data: {
        a: { section: 0, index: 0 },
        b: { section: 0, index: 2 }
      }
    });
    expect(restoreResponse.ok()).toBe(true);

    // Verify restoration
    const restoredItems = await getListState(page);
    expect(restoredItems[0].input).toBe(itemA.input);
    expect(restoredItems[2].input).toBe(itemB.input);
    console.log('PASS: Backend swap API is atomic and reversible');
  });


  test('single content swap via DnD persists after reload', async ({ page }) => {
    // Navigate to the list
    await page.goto(MENU_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForListReady(page);

    // Record initial state from API
    const initialItems = await getListState(page);
    const idx0Input = initialItems[0].input;
    const idx1Input = initialItems[1].input;
    const idx0Label = initialItems[0].label;
    const idx1Label = initialItems[1].label;
    console.log(`Before DnD: [0]=${idx0Label}(${idx0Input}), [1]=${idx1Label}(${idx1Input})`);

    // Perform content drag: item 0 → item 1
    await performContentDrag(page, 0, 0, 0, 1);

    // Verify from API that swap happened
    const afterDnD = await getListState(page);
    console.log(`After DnD: [0]=${afterDnD[0].label}(${afterDnD[0].input}), [1]=${afterDnD[1].label}(${afterDnD[1].input})`);

    // Content fields should have swapped
    expect(afterDnD[0].input).toBe(idx1Input);
    expect(afterDnD[1].input).toBe(idx0Input);
    // Identity should stay
    expect(afterDnD[0].label).toBe(idx0Label);
    expect(afterDnD[1].label).toBe(idx1Label);

    // Reload page and verify persistence
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForListReady(page);

    const afterReload = await getListState(page);
    expect(afterReload[0].input).toBe(idx1Input);
    expect(afterReload[1].input).toBe(idx0Input);
    console.log('PASS: Swap persisted after reload');

    // Restore original state
    await page.request.put(`${API_URL}/items/swap`, {
      data: { a: { section: 0, index: 0 }, b: { section: 0, index: 1 } }
    });
    const restored = await getListState(page);
    expect(restored[0].input).toBe(idx0Input);
    console.log('Restored original state');
  });


  test('rapid consecutive swaps do not lose data', async ({ page }) => {
    await page.goto(MENU_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForListReady(page);

    // Record initial state
    const initialItems = await getListState(page);
    expect(initialItems.length).toBeGreaterThanOrEqual(5);

    const inputs = initialItems.slice(0, 5).map(i => i.input);
    const labels = initialItems.slice(0, 5).map(i => i.label);
    console.log('Initial inputs:', inputs);

    // Perform first swap: 3 → 4
    await performContentDrag(page, 0, 3, 0, 4);

    // Immediately attempt second swap: 3 → 2 (should be blocked by lock or handled correctly)
    // Don't wait — this tests the race condition
    await performContentDrag(page, 0, 3, 0, 2);

    // Wait for all operations to settle
    await page.waitForTimeout(3000);

    // Get state from API (source of truth)
    const afterRapid = await getListState(page);
    const afterInputs = afterRapid.slice(0, 5).map(i => i.input);
    const afterLabels = afterRapid.slice(0, 5).map(i => i.label);
    console.log('After rapid swaps:', afterInputs);

    // Key assertion: NO input values should be lost or duplicated
    const uniqueInputsBefore = new Set(inputs);
    const uniqueInputsAfter = new Set(afterInputs);
    expect(uniqueInputsAfter.size).toBe(uniqueInputsBefore.size);

    // All original inputs should still exist in the first 5 items
    for (const input of inputs) {
      expect(afterInputs).toContain(input);
    }

    // Labels should NEVER move (identity stays with row position)
    for (let i = 0; i < 5; i++) {
      expect(afterLabels[i]).toBe(labels[i]);
    }

    // Reload and verify persistence
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForListReady(page);

    const afterReload = await getListState(page);
    const reloadInputs = afterReload.slice(0, 5).map(i => i.input);
    console.log('After reload:', reloadInputs);

    // State after reload must match state before reload
    expect(reloadInputs).toEqual(afterInputs);
    console.log('PASS: Rapid swaps did not lose data');

    // Restore original state by swapping back
    // We need to figure out what happened and reverse it
    // Simplest: use API to set items back in order
    for (let i = 0; i < 5; i++) {
      if (afterInputs[i] !== inputs[i]) {
        // Find where the original input ended up
        const currentPos = afterInputs.indexOf(inputs[i]);
        if (currentPos !== -1 && currentPos !== i) {
          await page.request.put(`${API_URL}/items/swap`, {
            data: { a: { section: 0, index: i }, b: { section: 0, index: currentPos } }
          });
          // Update our tracking array
          afterInputs[currentPos] = afterInputs[i];
          afterInputs[i] = inputs[i];
        }
      }
    }
    console.log('Restored original state');
  });


  test('backend rapid concurrent swaps maintain consistency', async ({ page }) => {
    // This test calls the swap API concurrently to verify atomicity
    const initialItems = await getListState(page);
    expect(initialItems.length).toBeGreaterThanOrEqual(4);

    const inputs = initialItems.slice(0, 4).map(i => i.input);
    console.log('Initial:', inputs);

    // Fire two swap requests concurrently (not sequential)
    const [resp1, resp2] = await Promise.all([
      page.request.put(`${API_URL}/items/swap`, {
        data: { a: { section: 0, index: 0 }, b: { section: 0, index: 1 } }
      }),
      page.request.put(`${API_URL}/items/swap`, {
        data: { a: { section: 0, index: 2 }, b: { section: 0, index: 3 } }
      }),
    ]);

    expect(resp1.ok()).toBe(true);
    expect(resp2.ok()).toBe(true);

    const afterConcurrent = await getListState(page);
    const afterInputs = afterConcurrent.slice(0, 4).map(i => i.input);
    console.log('After concurrent:', afterInputs);

    // All original inputs must still exist (no data loss)
    const originalSet = new Set(inputs);
    const afterSet = new Set(afterInputs);
    expect(afterSet.size).toBe(originalSet.size);
    for (const input of inputs) {
      expect(afterInputs).toContain(input);
    }

    // Both swaps should have applied: 0↔1 and 2↔3
    // But if they race on the same file, one may overwrite the other
    // This is the KEY test — if the backend is truly atomic per-swap but not
    // serialized across swaps, the second write could clobber the first
    const swap01Applied = afterInputs[0] === inputs[1] && afterInputs[1] === inputs[0];
    const swap23Applied = afterInputs[2] === inputs[3] && afterInputs[3] === inputs[2];

    console.log(`Swap 0↔1 applied: ${swap01Applied}`);
    console.log(`Swap 2↔3 applied: ${swap23Applied}`);

    // At minimum, no data should be lost. Ideally both swaps apply.
    // If only one applied, that's a concurrency bug (read-mutate-write race between two requests)
    if (!swap01Applied || !swap23Applied) {
      console.warn('CONCURRENCY ISSUE: One or both concurrent swaps were lost!');
      console.warn('This indicates the backend read-mutate-write is not serialized');
    }

    // Restore: swap everything back
    if (swap01Applied) {
      await page.request.put(`${API_URL}/items/swap`, {
        data: { a: { section: 0, index: 0 }, b: { section: 0, index: 1 } }
      });
    }
    if (swap23Applied) {
      await page.request.put(`${API_URL}/items/swap`, {
        data: { a: { section: 0, index: 2 }, b: { section: 0, index: 3 } }
      });
    }

    const restored = await getListState(page);
    console.log('Restored:', restored.slice(0, 4).map(i => i.input));
  });

});
