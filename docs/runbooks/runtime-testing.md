# Runtime Testing

Runtime tests use Playwright to test the frontend in a real browser against a running dev server. They verify end-to-end behavior that unit tests can't catch.

## Running Tests

```bash
# All player runtime tests
npx playwright test tests/runtime/player/

# Specific test file
npx playwright test tests/runtime/player/video-playback.runtime.test.mjs

# With Playwright UI (for debugging)
npx playwright test --ui

# Show browser (not headless)
npx playwright test --headed
```

## Configuration

Key settings in `playwright.config.js`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `testDir` | `./tests/runtime` | Test file location |
| `testMatch` | `**/*.runtime.test.mjs` | Test file pattern |
| `timeout` | `90000` | 90 second test timeout |
| `headless` | `true` | Run without visible browser |
| `launchOptions.args` | `['--autoplay-policy=no-user-gesture-required']` | Allow video autoplay |

### Autoplay Policy

Chrome blocks video autoplay without user interaction. The `--autoplay-policy=no-user-gesture-required` flag bypasses this for testing.

### Wait States

Use `waitForLoadState('domcontentloaded')` instead of `'networkidle'` for pages with streaming media. Streaming pages never reach network idle due to ongoing audio/video connections.

## Debugging Failures

### 1. Check Screenshots

Failed tests save screenshots to `test-results/`:

```bash
ls test-results/
# Open specific screenshot
open test-results/<test-name>/test-failed-1.png
```

### 2. Check dev.log

Look for frontend errors during the test:

```bash
# Errors only
grep '"level":"error"' dev.log | tail -20

# Frontend errors
grep '"source":"frontend"' dev.log | grep '"level":"error"'
```

### 3. Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Video stuck on loading spinner | Autoplay blocked | Verify `launchOptions` has autoplay flag |
| Test times out on `networkidle` | Streaming keeps network active | Use `domcontentloaded` instead |
| Video never starts | Plex server unavailable | Check Plex is running, media exists |
| Element not found | Page not fully loaded | Add appropriate wait before assertion |

## Writing New Tests

### File Naming

Tests must match the pattern `*.runtime.test.mjs` and live in `tests/runtime/`.

### Test Structure

```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('specific behavior', async ({ page }, testInfo) => {
    // Navigate
    await page.goto('http://localhost:3111/tv?plex=123');
    await page.waitForLoadState('domcontentloaded');

    // Wait for specific condition
    await page.waitForTimeout(1000);

    // Assert
    const element = await page.locator('.my-element');
    expect(await element.isVisible()).toBe(true);
  });
});
```

### Attaching Artifacts

Use `testInfo.attach()` for debugging data (not `console.log`):

```javascript
test('example', async ({ page }, testInfo) => {
  const data = await page.evaluate(() => someData);

  await testInfo.attach('debug-data', {
    body: JSON.stringify(data, null, 2),
    contentType: 'application/json'
  });
});
```

### Conditional Skips

Use `test.skip()` when a test can't run but isn't a failure:

```javascript
test('requires specific condition', async ({ page }, testInfo) => {
  const hasFeature = await page.evaluate(() => !!window.someFeature);

  if (!hasFeature) {
    test.skip(true, 'Feature not available in this environment');
    return;
  }

  // Test continues...
});
```

## Test Categories

| Directory | Purpose |
|-----------|---------|
| `tests/runtime/player/` | Video/audio player behavior |
| `tests/runtime/` | Other runtime tests |

## Related

- `playwright.config.js` - Test configuration
- `dev.log` - Frontend log output during tests
- `test-results/` - Screenshots and artifacts from failed tests
