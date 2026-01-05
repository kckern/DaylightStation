# Testing Context

## Test Infrastructure

### Test Types

| Type | Tool | Location | Command |
|------|------|----------|---------|
| Smoke | Playwright | `tests/smoke/` | `npm run test:smoke` |
| Assembly | Jest/Node | `tests/assembly/` | `npm run test:assembly` |
| E2E | Playwright | `tests/e2e/` | `npx playwright test` |

### Running Tests

```bash
# Smoke tests
npm run test:smoke

# Assembly tests
npm run test:assembly

# E2E tests (requires dev server running)
npx playwright test

# Specific test file
npx playwright test tests/e2e/specific.spec.js

# With headed browser (visible)
npx playwright test --headed
```

### Test Configuration

- `jest.config.js` - Jest configuration
- `playwright.config.js` - Playwright configuration (if exists)

### Test Context Utilities

Located in test setup files, provides:
- Test household data
- Mock services
- Fixture loading

## Test Household

**Location:** `data/households/test/` (if configured)

**Purpose:** Isolated data for testing without affecting production.

**Structure:**
```
data/households/test/
├── apps/
│   ├── fitness/config.yml
│   └── ...
└── users/
    ├── test-user-1.yml
    └── ...
```

## Writing Tests

### Playwright E2E Pattern

```javascript
import { test, expect } from '@playwright/test';

test('description', async ({ page }) => {
  await page.goto('/app');
  await page.click('[data-testid="button"]');
  await expect(page.locator('.result')).toBeVisible();
});
```

### Jest Unit Pattern

```javascript
import { functionToTest } from '../src/module';

describe('Module', () => {
  test('does something', () => {
    const result = functionToTest(input);
    expect(result).toBe(expected);
  });
});
```

## Related Docs

- `docs/plans/2026-01-04-testing-strategy-design.md`
- `docs/plans/2026-01-04-testing-infrastructure.md`
- `docs/HARVESTER_TESTS_QUICKSTART.md`
