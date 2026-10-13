# Admin Lists Comprehensive Test - Design

**Date:** 2026-02-02
**Status:** Ready for Implementation

## Overview

Runtime test that validates all admin content lists (menus, programs, watchlists) render items with proper 2-line cards and thumbnails. Uses API discovery + UI navigation with baselines from the data mount.

## Test Flow

```
1. Load baseline from data mount (YAML files)
2. For each list type (menus, programs, watchlists):
   a. GET /api/v1/admin/content/lists/{type} → verify matches baseline
   b. Navigate to /admin/content/lists/{type} in browser
   c. For each list in type:
      - Click list card to open ListsFolder view
      - Wait for items to load
      - Sample 20 random items (or all if <20)
      - For each sampled item:
        - Verify .content-display exists
        - Verify 2-line card: title + (type • parent)
        - Verify thumbnail (avatar) present
        - If unresolved → test fails
      - Navigate back to index
3. Report summary: lists checked, items validated, any failures
```

**Test timeout:** 5 minutes (many lists, network calls for content resolution)

---

## Card Validation Criteria

**Expected card structure in `.col-input .content-display`:**

```html
<div class="content-display">
  <Avatar src="/api/v1/..." />           <!-- Thumbnail -->
  <div class="content-info">
    <Text line={1}>Title Here</Text>           <!-- Line 1: Title -->
    <Text line={2}>Track • Album Name</Text>   <!-- Line 2: Type • Parent -->
  </div>
  <Badge>PLEX</Badge>                    <!-- Source badge -->
</div>
```

**Validation checks per item:**

| Check | Selector | Pass Criteria |
|-------|----------|---------------|
| Card exists | `.content-display` | visible |
| Has thumbnail | `.mantine-Avatar-root` | count > 0 |
| Has title | `.content-display` text | not empty, not raw ID pattern |
| Has type+parent | second line text | matches `{Type} • {Parent}` or contains `•` |
| Has source badge | `.mantine-Badge-root` | visible |

---

## Fallback Card (Unresolved Items)

When content cannot be resolved, display a warning card:

```html
<div class="content-display content-display--unresolved">
  <Avatar color="yellow">
    <IconAlertTriangle />
  </Avatar>
  <div class="content-info">
    <Text>plex:999999</Text>
    <Text>Unknown • Unresolved</Text>
  </div>
  <Badge color="yellow">PLEX</Badge>
</div>
```

Test detects unresolved via `.content-display--unresolved` class or "Unresolved" text → **test fails** with clear message indicating implementation gap.

---

## Baseline Fixture Loading

**Helper module:** `tests/_lib/listFixtureLoader.mjs`

```javascript
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';

dotenv.config();

const BASE_PATH = process.env.DAYLIGHT_BASE_PATH;
const LISTS_PATH = path.join(BASE_PATH, 'data/household/config/lists');

export function getExpectedLists() {
  return {
    menus: listYamlFiles(`${LISTS_PATH}/menus`),
    programs: listYamlFiles(`${LISTS_PATH}/programs`),
    watchlists: listYamlFiles(`${LISTS_PATH}/watchlists`)
  };
}

function listYamlFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yml'))
    .map(f => f.replace('.yml', ''));
}

export function getListItems(type, name) {
  const filePath = path.join(LISTS_PATH, type, `${name}.yml`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = yaml.load(content);
  return data.items || [];
}

export function sampleItems(items, count = 20) {
  if (items.length <= count) return items;
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
```

---

## Data Mount Structure

```
{DAYLIGHT_BASE_PATH}/data/household/config/lists/
├── menus/        (16 lists)
│   ├── adhoc.yml
│   ├── ambient.yml
│   ├── bible.yml
│   └── ...
├── programs/     (5 lists)
│   ├── cartoons.yml
│   ├── evening-program.yml
│   └── ...
└── watchlists/   (7 lists)
    ├── cfmscripture.yml
    ├── parenting.yml
    └── ...
```

Environment variable `DAYLIGHT_BASE_PATH` loaded from `.env`.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `tests/_lib/listFixtureLoader.mjs` | Create | Load baselines from data mount |
| `tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs` | Create | Main test file |
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | Modify | Add fallback handler for unresolved content |

---

## Test Structure

```javascript
test.describe('Admin Lists Comprehensive', () => {
  test('All list types discoverable via API', async ({ request }) => {
    // Verify API returns expected lists matching data mount
  });

  test('Menus: all items render with proper cards', async ({ page }) => {
    // Iterate menus, sample 20 items each, validate cards
  });

  test('Programs: all items render with proper cards', async ({ page }) => {
    // Same for programs
  });

  test('Watchlists: all items render with proper cards', async ({ page }) => {
    // Same for watchlists
  });
});
```

---

## Run Command

```bash
npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
```

---

## Success Criteria

1. All lists from data mount appear in API responses
2. All lists accessible via UI navigation
3. Every sampled item (20 per list) renders with:
   - Thumbnail (avatar)
   - Title (not raw ID)
   - Type + Parent line
   - Source badge
4. Zero unresolved items (or test fails with clear gap identification)
