import { test, expect } from '@playwright/test';

// Budget data can take a while to load from backend
const DATA_LOAD_TIMEOUT = 30000;
const BACKEND_URL = 'http://localhost:3112';

// Get token from environment variable for real sync tests
const PAYROLL_TOKEN = process.env.PAYROLL_TOKEN || '';

test.describe('Finance App - Payroll Sync', () => {
  test.beforeEach(async ({ page }) => {
    // Check if backend is available before each test
    let backendAvailable = false;
    try {
      const response = await page.request.get(`${BACKEND_URL}/harvest`);
      backendAvailable = response.ok();
    } catch {
      backendAvailable = false;
    }

    if (!backendAvailable) {
      test.skip();
      return;
    }

    // Navigate to finance app (route is /budget or /finances)
    await page.goto('/budget');
    // Wait for initial page load
    await page.waitForLoadState('domcontentloaded');
  });

  test('finance page loads successfully', async ({ page }) => {
    // Check that the budget viewer is present (may take time to fetch data)
    const budgetViewer = page.locator('.budget-viewer');
    await expect(budgetViewer).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('payroll sync button is visible in header', async ({ page }) => {
    // Wait for the budget viewer to load
    await page.waitForSelector('.budget-viewer', { timeout: DATA_LOAD_TIMEOUT });

    // Find the payroll button (money bag emoji)
    const payrollButton = page.locator('button.payroll-btn');
    await expect(payrollButton).toBeVisible();
  });

  test('clicking payroll button opens drawer', async ({ page }) => {
    await page.waitForSelector('.budget-viewer', { timeout: DATA_LOAD_TIMEOUT });

    // Click the payroll button
    const payrollButton = page.locator('button.payroll-btn');
    await payrollButton.click();

    // Wait for drawer to open - check for drawer title to be visible
    const drawerTitle = page.locator('.mantine-Drawer-title');
    await expect(drawerTitle).toBeVisible({ timeout: 5000 });
    await expect(drawerTitle).toContainText('Sync Payroll');
  });

  test('drawer contains token input and sync button', async ({ page }) => {
    await page.waitForSelector('.budget-viewer', { timeout: DATA_LOAD_TIMEOUT });

    // Open the drawer
    const payrollButton = page.locator('button.payroll-btn');
    await payrollButton.click();

    // Wait for drawer title
    await expect(page.locator('.mantine-Drawer-title')).toBeVisible({ timeout: 5000 });

    // Check for token input
    const tokenInput = page.locator('input[placeholder*="token"]');
    await expect(tokenInput).toBeVisible();

    // Check for sync button
    const syncButton = page.locator('button', { hasText: 'Sync Payroll' });
    await expect(syncButton).toBeVisible();
  });

  test('can enter token and trigger sync', async ({ page }) => {
    // Use real token from env if provided, otherwise use test token
    const tokenToUse = PAYROLL_TOKEN || 'test-token-12345';
    const isRealToken = !!PAYROLL_TOKEN;

    // Intercept API calls to log the response
    let apiResponse = null;
    page.on('response', async (response) => {
      if (response.url().includes('/harvest/payroll')) {
        apiResponse = {
          status: response.status(),
          url: response.url(),
          body: await response.text().catch(() => 'unable to read body')
        };
        console.log('\n=== PAYROLL API RESPONSE ===');
        console.log('Status:', apiResponse.status);
        console.log('URL:', apiResponse.url);
        console.log('Body:', apiResponse.body.substring(0, 500));
        console.log('============================\n');
      }
    });

    await page.waitForSelector('.budget-viewer', { timeout: DATA_LOAD_TIMEOUT });

    // Open the drawer
    const payrollButton = page.locator('button.payroll-btn');
    await payrollButton.click();

    // Wait for drawer title
    await expect(page.locator('.mantine-Drawer-title')).toBeVisible({ timeout: 5000 });

    // Enter the token
    const tokenInput = page.locator('input[placeholder*="token"]');
    await tokenInput.fill(tokenToUse);
    console.log(`Using ${isRealToken ? 'REAL' : 'TEST'} token: ${tokenToUse.substring(0, 10)}...`);

    // Verify token was entered
    await expect(tokenInput).toHaveValue(tokenToUse);

    // Click sync button
    const syncButton = page.locator('button', { hasText: 'Sync Payroll' });
    await syncButton.click();

    // Wait for result feedback (success or error message appears)
    const resultMessage = page.locator('.mantine-Drawer-body div[style*="background"]');
    await expect(resultMessage).toBeVisible({ timeout: 30000 }); // Longer timeout for real API

    // Get the result text
    const resultText = await resultMessage.textContent();
    console.log('UI Result:', resultText);

    // Check if API was called and log result
    if (apiResponse) {
      console.log('API Response Status:', apiResponse.status);
      if (isRealToken) {
        // For real tokens, we expect success (200)
        expect(apiResponse.status).toBe(200);
        expect(resultText).toContain('success');
      }
    }

    // The drawer body should contain some result text
    const drawerBody = page.locator('.mantine-Drawer-body');
    const bodyText = await drawerBody.textContent();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('drawer can be closed', async ({ page }) => {
    await page.waitForSelector('.budget-viewer', { timeout: DATA_LOAD_TIMEOUT });

    // Open the drawer
    const payrollButton = page.locator('button.payroll-btn');
    await payrollButton.click();

    // Wait for drawer title to be visible
    const drawerTitle = page.locator('.mantine-Drawer-title');
    await expect(drawerTitle).toBeVisible({ timeout: 5000 });

    // Close the drawer using the close button
    const closeButton = page.locator('.mantine-Drawer-close');
    await closeButton.click();

    // Drawer title should be hidden after close
    await expect(drawerTitle).not.toBeVisible({ timeout: 3000 });
  });

  test('page loads without critical JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/budget');
    await page.waitForLoadState('networkidle');

    // Filter for critical errors only
    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error') &&
      !e.includes('Failed to fetch')  // Backend may not be running
    );

    if (criticalErrors.length > 0) {
      console.warn('Page errors:', criticalErrors);
    }

    // Test passes if no critical errors
    expect(criticalErrors.length).toBe(0);
  });
});
