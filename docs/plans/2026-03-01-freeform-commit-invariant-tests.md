# Freeform Commit Invariant Tests — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add regression tests that enforce the invariant: "ContentSearchCombobox must always save user freeform input, regardless of search result availability."

**Architecture:** A new Playwright test file in the existing content-search-combobox test suite that exercises freeform commits via blur and Enter with zero results. Uses the existing `ComboboxTestPage` test harness (`/admin/test/combobox`) and `ComboboxTestHarness` three-layer validation. Also adds a code comment in both ContentSearchCombobox implementations marking the invariant.

**Tech Stack:** Playwright, ComboboxTestHarness, ComboboxTestPage.jsx

**Bug Reference:** `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md`

---

### Task 1: Create the Freeform Commit Test File

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs`
- Reference: `tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs` (pattern source)
- Reference: `tests/_lib/comboboxTestHarness.mjs` (ComboboxTestHarness, ComboboxLocators, ComboboxActions)

**Step 1: Write the test file**

```javascript
/**
 * 12-freeform-commit.runtime.test.mjs
 *
 * Invariant: ContentSearchCombobox must always save freeform user input,
 * regardless of search result count. Zero results ≠ invalid input.
 *
 * See: docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md
 */
import { test, expect } from '@playwright/test';
import { getAppPort } from '../../../../_lib/configHelper.mjs';
import {
  ComboboxTestHarness,
  ComboboxLocators,
  ComboboxActions,
} from '../../../../_lib/comboboxTestHarness.mjs';

const BASE = `http://localhost:${getAppPort()}`;
const TEST_URL = `${BASE}/admin/test/combobox`;

let harness;

test.describe('Freeform Commit Invariant', () => {

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
    await expect(page.locator('[data-testid="current-value"]')).toBeVisible();
  });

  test.afterEach(async () => {
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
    await harness.teardown();
  });

  test('freeform text commits on Enter with zero results', async ({ page }) => {
    const input = ComboboxLocators.input(page);
    const freeformValue = 'xyzzy:nonexistent/test-value-' + Date.now();

    // Type a value that will match nothing
    await input.click();
    await input.fill(freeformValue);

    // Wait for search to settle with no results
    await page.waitForTimeout(500); // debounce
    await ComboboxActions.waitForStreamComplete(page, 10000);

    // Press Enter to commit freeform
    await input.press('Enter');
    await page.waitForTimeout(300);

    // Value must be saved — this is the invariant
    const currentValue = await page.locator('[data-testid="current-value"]').textContent();
    expect(currentValue).toBe(freeformValue);

    // Change log must record the commit
    const changeLog = await page.locator('[data-testid="change-log"]').textContent();
    expect(changeLog).not.toContain('No changes yet');
    expect(changeLog).toContain(freeformValue);
  });

  test('freeform text commits on blur with zero results', async ({ page }) => {
    const input = ComboboxLocators.input(page);
    const freeformValue = 'canvas:imaginary/path-' + Date.now();

    // Type a value that will match nothing
    await input.click();
    await input.fill(freeformValue);

    // Wait for search to settle with no results
    await page.waitForTimeout(500);
    await ComboboxActions.waitForStreamComplete(page, 10000);

    // Blur the input (click elsewhere) to trigger freeform commit
    await page.locator('[data-testid="current-value"]').click();
    await page.waitForTimeout(300);

    // Value must be saved
    const currentValue = await page.locator('[data-testid="current-value"]').textContent();
    expect(currentValue).toBe(freeformValue);

    // Change log must record the commit
    const changeLog = await page.locator('[data-testid="change-log"]').textContent();
    expect(changeLog).not.toContain('No changes yet');
    expect(changeLog).toContain(freeformValue);
  });

  test('freeform text commits on Enter before results arrive', async ({ page }) => {
    const input = ComboboxLocators.input(page);
    // Use a plausible query that might eventually resolve, but commit before it does
    const freeformValue = 'canvas:religious/stars.jpg';

    await input.click();
    await input.fill(freeformValue);

    // Immediately press Enter — don't wait for search results
    await input.press('Enter');
    await page.waitForTimeout(300);

    // Value must be saved even if search hadn't returned yet
    const currentValue = await page.locator('[data-testid="current-value"]').textContent();
    expect(currentValue).toBe(freeformValue);
  });

  test('freeform text commits on blur before results arrive', async ({ page }) => {
    const input = ComboboxLocators.input(page);
    const freeformValue = 'canvas:religious/stars.jpg';

    await input.click();
    await input.fill(freeformValue);

    // Immediately blur — don't wait for search results
    await page.locator('[data-testid="current-value"]').click();
    await page.waitForTimeout(300);

    // Value must be saved
    const currentValue = await page.locator('[data-testid="current-value"]').textContent();
    expect(currentValue).toBe(freeformValue);
  });

  test('freeform text with special characters commits correctly', async ({ page }) => {
    const input = ComboboxLocators.input(page);
    // Test with colons, slashes, dots — common in content IDs
    const freeformValue = 'hymn:misc/special-test.mp3';

    await input.click();
    await input.fill(freeformValue);
    await page.waitForTimeout(500);
    await input.press('Enter');
    await page.waitForTimeout(300);

    const currentValue = await page.locator('[data-testid="current-value"]').textContent();
    expect(currentValue).toBe(freeformValue);
  });

});
```

**Step 2: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs --reporter=line`
Expected: All 5 tests PASS (the invariant already holds — these are regression tests)

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs
git commit -m "test(admin): add freeform commit invariant regression tests

Enforce the rule: ContentSearchCombobox must always save user freeform
input regardless of search result availability. Zero results ≠ invalid.

Covers: Enter/blur with zero results, Enter/blur before results arrive,
and special characters in freeform values.

Ref: docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md"
```

---

### Task 2: Add Invariant Comment to Standalone ContentSearchCombobox

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx:559-582` (blur and Enter handlers)

**Step 1: Add comment above the blur handler**

In `ContentSearchCombobox.jsx`, find the `onBlur` handler (around line 559). Add a comment immediately before the `if` block inside it:

```javascript
onBlur={() => {
  log.debug('input.blur', { search, value, willCommitFreeform: !!(search && search !== value) });
  // INVARIANT: Always save freeform text on blur. Never gate on result count.
  // See: docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md
  if (search && search !== value) {
```

**Step 2: Add comment above the Enter handler freeform path**

Find the Enter key handler (around line 571). Add a comment above the freeform commit block:

```javascript
if (e.key === 'Enter' && search && search !== value) {
  const idx = combobox.getSelectedOptionIndex();
  // INVARIANT: Commit freeform when no option is highlighted or no results.
  // Never prevent save based on result availability. User decides what's valid.
  if (idx === -1 || results.length === 0) {
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx
git commit -m "docs(admin): add freeform commit invariant comments to standalone combobox"
```

---

### Task 3: Add Invariant Comment to Inline ContentSearchCombobox

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1473-1511` (commitFreeformText function)

**Step 1: Add comment above commitFreeformText**

Find `commitFreeformText` (around line 1473). Add a comment block above the function:

```javascript
// INVARIANT: Always save freeform text. Never gate on availableResults.
// Zero search results ≠ invalid input. The user decides what's valid.
// See: docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md
const commitFreeformText = (trigger) => {
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "docs(admin): add freeform commit invariant comment to inline combobox"
```

---

### Task 4: Archive the Bug Document

**Files:**
- Move: `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md` → append "resolved" note

**Step 1: Add resolution note to bug doc**

Append to the end of the file:

```markdown

## Resolution

- Invariant confirmed already holding in both implementations (standalone + inline)
- Regression tests added: `tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs`
- Defensive comments added to both `ContentSearchCombobox.jsx` and `ListsItemRow.jsx`
- Status: **Resolved — invariant preserved and tested**
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md
git commit -m "docs: mark freeform commit invariant bug as resolved"
```
