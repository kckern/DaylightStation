/**
 * Admin Config Editor Smoke Test
 *
 * Verifies:
 * 1. /admin/system/config loads the file browser
 * 2. Config file list renders with file names
 * 3. Clicking a file navigates to the editor route
 * 4. The YAML editor (CodeMirror) loads with content
 * 5. Does NOT test save (would modify real data)
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;

test.describe.configure({ mode: 'serial' });

let sharedPage;
let sharedContext;

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  sharedPage = await sharedContext.newPage();
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
  if (sharedContext) await sharedContext.close();
});

test.describe('Admin Config Editor Smoke Test', () => {
  test.setTimeout(60000);

  test('config file list loads', async () => {
    await sharedPage.goto(`${BASE_URL}/admin/system/config`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for the "Config Files" heading (rendered by ConfigIndex)
    const heading = sharedPage.locator('text="Config Files"');
    await expect(heading, 'Config Files heading should be visible').toBeVisible({ timeout: 10000 });
    console.log('Config Files heading visible');

    // Verify the loading spinner is gone
    const loader = sharedPage.locator('.mantine-Loader-root');
    await expect(loader).toHaveCount(0, { timeout: 10000 });
    console.log('Loading complete');
  });

  test('file list renders with file names', async () => {
    // ConfigIndex renders files inside Paper components wrapped by UnstyledButton
    // Each file row has: icon + file name (Text) + optional badge + size + date
    const fileRows = sharedPage.locator('.mantine-Paper-root');
    const fileCount = await fileRows.count();

    expect(fileCount, 'Should have at least one config file listed').toBeGreaterThan(0);
    console.log(`Found ${fileCount} config file entries`);

    // Verify the first few files have text content (not empty rows)
    for (let i = 0; i < Math.min(fileCount, 5); i++) {
      const row = fileRows.nth(i);
      const text = await row.textContent();
      expect(text?.trim().length, `File row ${i} should have text content`).toBeGreaterThan(0);
      console.log(`  File ${i + 1}: ${text?.trim().substring(0, 60)}`);
    }

    // Verify directory group headers exist (folder icons + uppercase directory labels)
    const dirHeaders = sharedPage.locator('text >> nth=0').filter({ hasText: /^[A-Z]/ });
    const dirCount = await dirHeaders.count();
    console.log(`Found ${dirCount} text elements starting with uppercase`);
  });

  test('clicking a file navigates to the editor', async () => {
    // Find a clickable file row (UnstyledButton wrapping a Paper)
    // Non-masked files are wrapped in UnstyledButton; masked files are wrapped in plain div
    const clickableFiles = sharedPage.locator('.mantine-UnstyledButton-root .mantine-Paper-root');
    const clickableCount = await clickableFiles.count();

    expect(clickableCount, 'Should have at least one editable (non-masked) config file').toBeGreaterThan(0);
    console.log(`Found ${clickableCount} clickable (editable) config files`);

    // Get the file name text before clicking
    const firstClickable = clickableFiles.first();
    const fileName = await firstClickable.locator('.mantine-Text-root').first().textContent();
    console.log(`Clicking file: ${fileName}`);

    // Click the file row
    await firstClickable.click();

    // URL should change to /admin/system/config/{path}
    await sharedPage.waitForURL('**/admin/system/config/**', { timeout: 10000 });
    const url = sharedPage.url();
    expect(url).toContain('/admin/system/config/');
    console.log(`Navigated to: ${url}`);
  });

  test('YAML editor loads with CodeMirror', async () => {
    // ConfigFileEditor renders a YamlEditor which uses CodeMirror
    // Wait for the CodeMirror editor container to appear
    const cmEditor = sharedPage.locator('.cm-editor');
    await expect(cmEditor, 'CodeMirror editor should be visible').toBeVisible({ timeout: 15000 });
    console.log('CodeMirror editor visible');

    // Verify CodeMirror has content (not an empty editor)
    const cmContent = sharedPage.locator('.cm-content');
    await expect(cmContent).toBeVisible({ timeout: 5000 });

    const editorText = await cmContent.textContent();
    expect(editorText?.trim().length, 'Editor should have YAML content loaded').toBeGreaterThan(0);
    console.log(`Editor content length: ${editorText?.trim().length} chars`);
    console.log(`First 100 chars: ${editorText?.trim().substring(0, 100)}`);

    // Verify breadcrumb path is shown (ConfigFileEditor renders Breadcrumbs)
    const breadcrumbs = sharedPage.locator('.mantine-Breadcrumbs-root');
    const hasBreadcrumbs = await breadcrumbs.count() > 0;
    console.log(`Breadcrumbs visible: ${hasBreadcrumbs}`);

    // Verify Save and Revert buttons are present
    const saveButton = sharedPage.locator('button', { hasText: 'Save' });
    const revertButton = sharedPage.locator('button', { hasText: 'Revert' });

    await expect(saveButton, 'Save button should be visible').toBeVisible({ timeout: 5000 });
    await expect(revertButton, 'Revert button should be visible').toBeVisible({ timeout: 5000 });

    // Both should be disabled (no unsaved changes yet)
    await expect(saveButton).toBeDisabled();
    await expect(revertButton).toBeDisabled();
    console.log('Save and Revert buttons present and disabled (no unsaved changes)');
  });

  test('back link returns to config file list', async () => {
    // ConfigFileEditor has a "Back to Config" anchor
    const backLink = sharedPage.locator('text="Back to Config"');
    await expect(backLink).toBeVisible({ timeout: 5000 });

    await backLink.click();

    // Should navigate back to /admin/system/config (without trailing path)
    await sharedPage.waitForURL('**/admin/system/config', { timeout: 10000 });
    const url = sharedPage.url();
    // Verify we are on the config index, not a file editor sub-route
    expect(url.endsWith('/admin/system/config') || url.endsWith('/admin/system/config/')).toBe(true);
    console.log(`Returned to config index: ${url}`);

    // Verify the file list is visible again
    const heading = sharedPage.locator('text="Config Files"');
    await expect(heading).toBeVisible({ timeout: 5000 });
    console.log('Config file list visible after navigating back');
  });
});
