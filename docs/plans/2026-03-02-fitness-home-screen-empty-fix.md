# Fitness Home Screen Empty Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the `/fitness/home` screen rendering empty by adding `home_screen` to the config normalization array, and fix the `since=30d` relative date parsing so the sessions widget populates.

**Architecture:** Two targeted fixes — one frontend (add key to existing array), one backend (parse relative date strings before querying). No new files, no new patterns.

**Tech Stack:** React (frontend), Express/Node (backend), YAML session datastore

**Bug doc:** `docs/_wip/bugs/2026-03-02-fitness-home-screen-empty.md`

---

## Task 1: Add `home_screen` to `unifyKeys` Array

The API returns `home_screen` as a top-level key, but the frontend normalization loop only copies explicitly listed keys into `response.fitness`. Since `home_screen` is missing, `fitnessConfiguration.fitness.home_screen` is always `undefined`, which makes `homeScreenConfig` null, which guards the entire `<PanelRenderer>` tree from mounting.

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:863`

**Step 1: Add `home_screen` to the `unifyKeys` array**

At line 863, find the `unifyKeys` array:

```javascript
const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex','governance','ambient_led','device_colors','devices'];
```

Change to:

```javascript
const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex','governance','ambient_led','device_colors','devices','home_screen'];
```

**Step 2: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

**Step 3: Manual verification**

1. Start the dev server (`npm run dev`)
2. Navigate to `/fitness/home`
3. Confirm the panel layout renders (widget placeholders visible, not blank)
4. Check browser Network tab for data source fetches (`/api/v1/health/weight`, `/api/v1/health/daily`, `/api/v1/fitness/sessions`)

**Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): add home_screen to unifyKeys so home view config reaches components"
```

---

## Task 2: Parse Relative Date Strings in Sessions Endpoint

The fitness config specifies `since=30d` in the sessions data source URL. The backend sessions endpoint passes this string directly to `listSessionsInRange(since, endDate)`, but the YAML datastore's `findInRange` does lexicographic string comparison (`d >= startDate`). `"30d"` is not a valid `YYYY-MM-DD` date and compares higher than any `2026-*` date string, so zero sessions match.

The fix: parse relative date notation (`Nd` where N is number of days) into an absolute `YYYY-MM-DD` date in the router, before calling the service.

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:280-284`

**Step 1: Write the failing test**

Create or extend the existing sessions test to cover relative date input. Check for an existing test file first:

File: `tests/isolated/api/routers/fitness-sessions-relative-date.test.mjs` (or add to existing fitness router tests if they exist)

```javascript
import { describe, it, expect } from 'vitest';

describe('fitness sessions endpoint - relative date parsing', () => {
  it('should parse "30d" as 30 days before today', () => {
    // The parsing logic we'll extract:
    const parseRelativeDate = (value) => {
      const match = value.match(/^(\d+)d$/);
      if (match) {
        const days = parseInt(match[1], 10);
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d.toISOString().split('T')[0];
      }
      return value; // already an absolute date
    };

    const result = parseRelativeDate('30d');
    // Should be a YYYY-MM-DD string, 30 days ago
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const parsed = new Date(result);
    const now = new Date();
    const diffMs = now - parsed;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it('should pass through absolute dates unchanged', () => {
    const parseRelativeDate = (value) => {
      const match = value.match(/^(\d+)d$/);
      if (match) {
        const days = parseInt(match[1], 10);
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d.toISOString().split('T')[0];
      }
      return value;
    };

    expect(parseRelativeDate('2026-01-15')).toBe('2026-01-15');
  });
});
```

**Step 2: Run test to verify it passes (this validates the parsing logic)**

```bash
npx vitest run tests/isolated/api/routers/fitness-sessions-relative-date.test.mjs
```

Expected: PASS (this tests the parsing function in isolation).

**Step 3: Add the parsing to the router**

In `backend/src/4_api/v1/routers/fitness.mjs`, find the Mode 2 block (around line 280):

```javascript
// Mode 2: Date range query (since -> today)
if (since) {
  try {
    const endDate = new Date().toISOString().split('T')[0]; // Today
    const sessions = await sessionService.listSessionsInRange(since, endDate, household);
```

Change to:

```javascript
// Mode 2: Date range query (since -> today)
if (since) {
  try {
    const endDate = new Date().toISOString().split('T')[0]; // Today
    // Parse relative date notation (e.g. "30d" = 30 days ago)
    let startDate = since;
    const relMatch = since.match(/^(\d+)d$/);
    if (relMatch) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(relMatch[1], 10));
      startDate = d.toISOString().split('T')[0];
    }
    const sessions = await sessionService.listSessionsInRange(startDate, endDate, household);
```

**Step 4: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && node -e "import('./backend/src/4_api/v1/routers/fitness.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

If there's a module resolution issue, just verify syntax: `node --check backend/src/4_api/v1/routers/fitness.mjs` (may not work with ESM imports, so a build/start test is acceptable).

**Step 5: Manual verification**

```bash
curl "http://localhost:3112/api/v1/fitness/sessions?since=30d&limit=5" | python3 -m json.tool | head -20
```

Expected: JSON response with `sessions` array (may be empty if no sessions in the last 30 days, but should NOT error). The `since` field in the response will still show `"30d"` (the original param) — verify `startDate` was properly parsed by checking the sessions returned match dates within the last 30 days.

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs tests/isolated/api/routers/fitness-sessions-relative-date.test.mjs
git commit -m "fix(fitness): parse relative date notation (e.g. 30d) in sessions endpoint"
```

---

## Task 3: Move Bug Doc to Archive

After both fixes are verified, archive the bug document.

**Step 1: Move the file**

```bash
mv docs/_wip/bugs/2026-03-02-fitness-home-screen-empty.md docs/_archive/2026-03-02-fitness-home-screen-empty.md
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-03-02-fitness-home-screen-empty.md docs/_archive/2026-03-02-fitness-home-screen-empty.md
git commit -m "docs: archive resolved fitness home screen bug"
```

---

## Summary

| Task | Issue | Priority | Files |
|------|-------|----------|-------|
| 1 | `home_screen` missing from `unifyKeys` — entire home view empty | Critical | `FitnessApp.jsx` |
| 2 | `since=30d` not parsed — sessions widget always empty | High | `fitness.mjs` (router) |
| 3 | Archive resolved bug doc | Cleanup | docs |
