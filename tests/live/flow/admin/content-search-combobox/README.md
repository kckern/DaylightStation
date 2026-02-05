# ContentSearchCombobox Test Suite

Bulletproof E2E test suite for the `ContentSearchCombobox` component used in Admin UI for content selection.

## Prerequisites

**The dev server must be running before executing tests.**

```bash
npm run dev
```

Wait for the "Server running on port..." message before running tests.

## Running Tests

```bash
# Run all tests
npx playwright test tests/live/flow/admin/content-search-combobox/

# Run with visible browser
npx playwright test tests/live/flow/admin/content-search-combobox/ --headed

# Run specific test file
npx playwright test tests/live/flow/admin/content-search-combobox/02-search-mode.runtime.test.mjs

# Run with line reporter (cleaner output)
npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line
```

Or use the runner script:

```bash
chmod +x tests/live/flow/admin/content-search-combobox/run-all.sh
./tests/live/flow/admin/content-search-combobox/run-all.sh
```

## Test Architecture

### Three-Layer Validation

Every test validates at three levels:

| Layer | What It Checks | How |
|-------|----------------|-----|
| **UI** | Visual elements, interactions | Playwright assertions |
| **API** | Response structure, data validity | Zod schema validation |
| **Backend** | No server errors during test | `dev.log` tailing |

### Test Files

Tests run in alphabetical order. Preflight runs first to fail fast on infrastructure issues.

| File | Tests | Description |
|------|-------|-------------|
| `00-preflight` | 6 | **Runs first.** Checks API connectivity, frontend availability, module imports. Fails fast if infrastructure is down. |
| `01-basic-interactions` | 10 | Open/close, focus/blur, initial states, placeholder text |
| `02-search-mode` | 7 | Keyword search, debounce, results display, API validation |
| `03-browse-mode` | 6 | Drill-down navigation, back button, breadcrumbs, sibling loading |
| `04-keyboard-navigation` | 8 | Arrow keys, Enter, Escape, Tab accessibility |
| `05-display-validation` | 8 | Avatars, titles, badges, icons, truncation, schema validation |
| `06-edge-cases` | 11 | Special chars, unicode, emoji, long input, timeouts, XSS prevention |
| `07-source-coverage` | 6 | Real content from Plex, media files, folder hierarchies |

**Total: ~62 test cases**

## What Each Test File Validates

### 00-preflight (Fail Fast)

Checks infrastructure before other tests run:
- Backend API responds (`/api/v1/health`)
- Search API endpoint works (`/api/v1/content/query/search`)
- List API endpoint works (`/api/v1/list/media/`)
- Frontend test page loads (`/admin/test/combobox`)
- Test harness module imports correctly
- Dynamic fixture loader can fetch real data

**If preflight fails, fix the infrastructure issue before debugging other tests.**

### 01-basic-interactions

Core UI mechanics:
- Renders with placeholder when empty
- Loads initial value from URL param
- Opens dropdown on click/focus
- Closes dropdown on blur/Escape
- Shows "Type to search" empty state
- Triggers search API on typing

### 02-search-mode

Keyword search functionality:
- Search triggers after debounce (not immediately)
- Single character doesn't trigger (minimum length)
- Results display with correct structure
- Rapid typing doesn't cause duplicate calls
- "No results" message for unmatched searches
- Clearing search returns to initial state
- Dynamic search terms work

### 03-browse-mode

Hierarchical navigation:
- Opening with value loads siblings
- Clicking container drills into it
- Back button returns to previous level
- Breadcrumbs show navigation path
- Deep navigation maintains trail
- Parent title click navigates up

### 04-keyboard-navigation

Accessibility:
- ArrowDown/ArrowUp navigate options
- Enter selects leaf (closes) or drills into container (stays open)
- Escape closes dropdown
- Tab moves focus away
- Typing resets to search mode

### 05-display-validation

Visual correctness:
- Each option has avatar
- Each option has title (not raw ID)
- Each option has source badge
- Containers show chevron icon
- Leaves don't show chevron
- Long titles truncated
- Nested items show parent
- API responses pass schema validation

### 06-edge-cases

Robustness:
- Special HTML chars don't cause XSS
- Unicode characters work
- Emoji characters work
- Long search terms don't crash
- Rapid typing handled gracefully
- Empty results show message
- Whitespace-only search handled
- Special chars in URL values work
- API timeout shows loader
- Deep navigation (5 levels) doesn't crash
- Selection clears state properly

### 07-source-coverage

Real content validation:
- Search works for each discovered source
- Can drill into real containers
- Can select real leaf items
- Mixed source results display correctly
- Plex hierarchy browsing works
- Folder hierarchy browsing works

## Supporting Files

### Test Harness (`tests/_lib/comboboxTestHarness.mjs`)

Provides:
- `ComboboxTestHarness` - API interception, log tailing, assertions
- `ComboboxLocators` - Standard selectors for component elements
- `ComboboxActions` - Common actions (open, search, click, keyboard)

### Schemas (`tests/_lib/schemas/contentSearchSchemas.mjs`)

Zod schemas for validating:
- `ListResponseSchema` - `/api/v1/list` responses
- `SearchResponseSchema` - `/api/v1/content/query/search` responses
- `validateDisplayFields()` - Item has required display properties

### Dynamic Fixtures (`tests/_fixtures/combobox/dynamicFixtureLoader.mjs`)

Queries real API to generate varied test data:
- `loadDynamicFixtures()` - Fetch containers, leaves, search terms
- `EDGE_CASES` - Static edge case scenarios
- `getAllContainerTypes()` / `getAllLeafTypes()` - Type helpers

### Isolated Test Page (`frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx`)

Mounts ContentSearchCombobox in isolation at `/admin/test/combobox`:
- Accepts URL params: `?value=...`, `?placeholder=...`
- Shows current value and change log for assertions
- No Admin layout overhead

## Troubleshooting

### "Backend API not responding"

```
Error: Backend API not responding at http://localhost:3111
```

**Fix:** Start the dev server with `npm run dev` and wait for startup.

### "Search API not responding"

The `/api/v1/content/query/search` endpoint isn't working.

**Check:**
1. Backend is running
2. ContentQueryService is configured
3. Check `dev.log` for errors

### "Frontend test page not accessible"

```
Error: Frontend not responding at http://localhost:3111
```

**Fix:**
1. Verify Vite is running (part of `npm run dev`)
2. Check the correct port in `system.yml`

### "dynamic fixture loader works" fails

The fixture loader couldn't fetch test data from the API.

**Check:**
1. Search and list APIs are responding
2. There's actual content in Plex/media sources
3. Network connectivity

### Tests pass locally but fail in CI

- Check port configuration matches CI environment
- Ensure API sources are available in CI
- CI may need different `system.yml` config

### Tests timing out on search operations

If tests consistently time out waiting for search results:

**Check:** The search API may be slow. Test response time with:
```bash
time curl -s "http://localhost:3111/api/v1/content/query/search?text=test&take=1"
```

If this takes more than a few seconds, the backend is under load or has performance issues. Tests use 30-60 second timeouts but will naturally be slow when the API is slow. Consider:
1. Restarting the backend
2. Checking backend resource usage
3. Verifying external integrations (Plex, Immich) are responsive

## Test Discipline

These tests follow strict discipline per project guidelines:

1. **No vacuously true results** - If preconditions fail, tests fail explicitly
2. **No conditional assertion skipping** - Every code path has assertions
3. **Fail fast on infrastructure** - Preflight catches issues early
4. **Three-layer validation** - UI + API + Backend checked together
5. **Dynamic fixtures** - Real data, varied each run

## Adding New Tests

1. Create file with pattern `NN-description.runtime.test.mjs`
2. Import from `#testlib/comboboxTestHarness.mjs`
3. Use `beforeEach` to set up harness and navigate
4. Use `afterEach` to validate API responses and teardown
5. Follow existing patterns for assertions
6. Avoid conditional skipping - fail explicitly if preconditions unmet
