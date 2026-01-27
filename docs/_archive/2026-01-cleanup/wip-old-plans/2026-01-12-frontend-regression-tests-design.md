# Frontend Regression Tests Design

**Date:** 2026-01-12
**Status:** Approved
**Type:** Playwright Browser Automation Tests

---

## Overview

Functional regression tests for the four main frontend apps to catch regressions after frontend updates. Tests run against a live dev server using Playwright browser automation.

### Scope

| App | Route | Key Behaviors |
|-----|-------|---------------|
| TVApp | `/tv` | Menu load, navigation, autoplay via query params, keyboard nav |
| FitnessApp | `/fitness` | Config load, navbar, view switching, player queue |
| FinanceApp | `/finances` | Budget load, year switching, reload, drawer interactions |
| OfficeApp | `/office` | WebSocket handling, keyboard shortcuts, menu selection |

---

## Architecture

### File Structure

```
tests/runtime/regression/
├── regression-test-utils.mjs      # Shared helpers
├── tvapp.regression.test.mjs      # TVApp functional tests
├── fitnessapp.regression.test.mjs # FitnessApp functional tests
├── financeapp.regression.test.mjs # FinanceApp functional tests
└── officeapp.regression.test.mjs  # OfficeApp handlers tests
```

### Shared Utilities

**regression-test-utils.mjs** provides:

| Function | Purpose |
|----------|---------|
| `FRONTEND_URL` | Dev server URL (localhost:3111) |
| `checkDevServer()` | Health check before tests run |
| `waitForAppReady(page, selectors)` | Wait for app to fully initialize |
| `captureConsoleErrors(page)` | Collect JS errors during test |
| `assertNoConsoleErrors(errors)` | Fail if console errors occurred |
| `injectWebSocketMessage(page, payload)` | Simulate WebSocket messages |
| `pressKey(page, key)` | Dispatch keyboard events |

### Test Pattern

Tests follow the existing "HURDLE" pattern from migration tests:

```javascript
test.describe('AppName Functional Regression', () => {
  test('HURDLE 1: App loads without errors', async ({ page }) => {
    // Setup, action, assertion
  });

  test('HURDLE 2: Core feature works', async ({ page }) => {
    // Setup, action, assertion
  });
});
```

---

## Test Coverage

### TVApp Tests (8 tests)

| # | Test | Validates |
|---|------|-----------|
| 1 | Menu loads | `/api/list/folder/TVApp` returns data, menu renders |
| 2 | Menu items display | Items have title, thumbnail |
| 3 | ?hymn= autoplay | Player loads hymn content |
| 4 | ?scripture= autoplay | Player loads scripture content |
| 5 | ?queue= playback | Queue loads multiple items |
| 6 | Menu item click | Navigation to sub-menu or player |
| 7 | Keyboard navigation | Arrow keys move focus, Enter selects |
| 8 | No console errors | Clean load without JS errors |

### FitnessApp Tests (8 tests)

| # | Test | Validates |
|---|------|-----------|
| 1 | Config loads | `/api/fitness` returns data, no loading state |
| 2 | Navbar renders | Nav items from config visible |
| 3 | Nav click changes view | Collection/plugin view switches |
| 4 | Content grid displays | Menu shows video thumbnails |
| 5 | Show detail view | FitnessShow component renders |
| 6 | Player queue | FitnessPlayer overlay appears |
| 7 | Back navigation | Returns to previous view |
| 8 | Error handling | Error state displays retry button |

### FinanceApp Tests (8 tests)

| # | Test | Validates |
|---|------|-----------|
| 1 | Budget loads | `/data/budget` returns data, grid renders |
| 2 | Budget blocks render | 6 blocks visible with content |
| 3 | Year selector | Dropdown shows budget years |
| 4 | Year switching | Data updates on selection |
| 5 | Reload button | Calls `/harvest/budget`, refreshes data |
| 6 | Payroll drawer | Opens sync UI with form |
| 7 | Block interaction | Clicking block opens detail drawer |
| 8 | Drawer close | Closes on outside click or X |

### OfficeApp Tests (12 tests)

| # | Test | Validates |
|---|------|-----------|
| 1 | Initial load | App loads, WebSocket connects |
| 2 | WS menu display | `{menu: "..."}` opens menu |
| 3 | WS reset action | `{action: "reset"}` clears state |
| 4 | WS playback control | `{playback: "pause"}` toggles media |
| 5 | WS content trigger | `{hymn: 113}` starts playback |
| 6 | WS blocks sensors | Rejects fitness/sensor topics |
| 7 | Keyboard escape | Clears content or closes menu |
| 8 | Keyboard menu | Mapped key opens menu |
| 9 | Shader cycle | Opacity changes on trigger |
| 10 | Menu selection | Click triggers content |
| 11 | URL ?hymn= | Loads hymn content |
| 12 | URL ?scripture= | Loads scripture content |

---

## Running Tests

```bash
# Run all regression tests
npx playwright test tests/runtime/regression/ --headed

# Run specific app
npx playwright test tests/runtime/regression/tvapp.regression.test.mjs --headed

# Run in CI mode (headless)
npx playwright test tests/runtime/regression/

# Debug mode
npx playwright test tests/runtime/regression/ --debug
```

### Prerequisites

1. Dev server running: `npm run dev` (both frontend and backend)
2. Playwright installed: `npx playwright install`

---

## Implementation Notes

### WebSocket Testing

OfficeApp tests need to inject WebSocket messages. The approach:

1. App listens for `test-ws-message` custom events in test mode
2. Test utility dispatches events with payload
3. WebSocket handler processes as if from real WebSocket

```javascript
// In test
await injectWebSocketMessage(page, { hymn: 113 });

// App handles it
window.addEventListener('test-ws-message', (e) => {
  wsHandler(e.detail);
});
```

### Console Error Capture

Tests capture console errors to fail on unexpected exceptions:

```javascript
const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
});
// ... run test ...
expect(errors).toHaveLength(0);
```

### Network Monitoring

Reuse `createNetworkMonitor` from migration tests when needed to verify API calls.

---

## Future Enhancements

1. **Visual regression** - Screenshot comparison for UI changes
2. **Performance metrics** - Track load times, FPS
3. **Accessibility** - A11y checks with axe-core
4. **Mobile viewport** - Test responsive layouts

---

## Related Files

- `tests/runtime/content-migration/` - Existing migration tests
- `tests/runtime/content-migration/migration-test-utils.mjs` - Shared network monitor
- `frontend/src/Apps/*.jsx` - App components under test
- `frontend/src/lib/OfficeApp/*.js` - OfficeApp handlers
