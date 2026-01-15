# Group Label Wiring Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `group_label` propagation so UI components consistently display short labels ("Dad", "Mom") instead of full names when configured.

**Architecture:** Two targeted fixes - (1) index userGroupLabelMap by both ID and display name for complete lookup coverage, (2) remove dead `display_name` fallback from FamilySelector that references a field not in the API response.

**Tech Stack:** React (frontend), Jest (testing)

---

## Task 1: Write Unit Test for userGroupLabelMap Multi-Key Indexing

**Files:**
- Create: `tests/unit/fitness/userGroupLabelMap.unit.test.mjs`

**Step 1: Create test file with failing test**

```javascript
import { describe, it, expect } from '@jest/globals';

/**
 * Tests the userGroupLabelMap indexing logic from FitnessContext.jsx
 * The map should be indexed by BOTH id/profileId AND display name
 * so lookups work regardless of which key is used.
 */
describe('userGroupLabelMap indexing logic', () => {
  // Extracted logic for testing - mirrors FitnessContext.jsx implementation
  function buildUserGroupLabelMap(usersConfig) {
    const map = new Map();
    const registerGroupLabels = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name) return;
        const id = entry.id || entry.profileId || entry.name;
        const label = entry.group_label ?? entry.groupLabel ?? null;

        // Index by ID/profileId
        if (id && label && !map.has(id)) {
          map.set(id, label);
        }

        // Also index by display name for lookups that use name instead of ID
        if (entry.name && label && entry.name !== id && !map.has(entry.name)) {
          map.set(entry.name, label);
        }
      });
    };
    registerGroupLabels(usersConfig?.primary);
    registerGroupLabels(usersConfig?.secondary);
    registerGroupLabels(usersConfig?.family);
    registerGroupLabels(usersConfig?.friends);
    registerGroupLabels(usersConfig?.guests);
    return map;
  }

  it('indexes by id when id differs from name', () => {
    const config = {
      primary: [
        { id: 'kckern', name: 'KC Kern', group_label: 'Dad' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('kckern')).toBe('Dad');
  });

  it('indexes by display name when it differs from id', () => {
    const config = {
      primary: [
        { id: 'kckern', name: 'KC Kern', group_label: 'Dad' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    // This is the key fix - name-based lookup should also work
    expect(map.get('KC Kern')).toBe('Dad');
  });

  it('handles entries where id and name are the same', () => {
    const config = {
      primary: [
        { id: 'guest1', name: 'guest1', group_label: 'Guest' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('guest1')).toBe('Guest');
    // Should not duplicate entry
    expect(map.size).toBe(1);
  });

  it('handles multiple user categories', () => {
    const config = {
      primary: [
        { id: 'kckern', name: 'KC Kern', group_label: 'Dad' }
      ],
      family: [
        { id: 'spouse', name: 'Jane Kern', group_label: 'Mom' }
      ],
      guests: [
        { id: 'visitor', name: 'Bob', group_label: null }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('kckern')).toBe('Dad');
    expect(map.get('KC Kern')).toBe('Dad');
    expect(map.get('spouse')).toBe('Mom');
    expect(map.get('Jane Kern')).toBe('Mom');
    // No label for visitor
    expect(map.has('visitor')).toBe(false);
  });

  it('prefers groupLabel camelCase when snake_case is missing', () => {
    const config = {
      primary: [
        { id: 'user1', name: 'User One', groupLabel: 'U1' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('user1')).toBe('U1');
    expect(map.get('User One')).toBe('U1');
  });

  it('returns empty map for null/undefined config', () => {
    expect(buildUserGroupLabelMap(null).size).toBe(0);
    expect(buildUserGroupLabelMap(undefined).size).toBe(0);
    expect(buildUserGroupLabelMap({}).size).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/userGroupLabelMap.unit.test.mjs --verbose`

Expected: FAIL - test "indexes by display name when it differs from id" should fail since current implementation doesn't index by name.

---

## Task 2: Fix userGroupLabelMap in FitnessContext.jsx

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:358-368`

**Step 1: Update registerGroupLabels to index by both id and name**

Find (lines 358-368):
```javascript
    const registerGroupLabels = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name) return;
        // Use explicit ID or profileId
        const id = entry.id || entry.profileId || entry.name;
        const label = entry.group_label ?? entry.groupLabel ?? null;
        if (id && label && !map.has(id)) {
          map.set(id, label);
        }
      });
    };
```

Replace with:
```javascript
    const registerGroupLabels = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name) return;
        const id = entry.id || entry.profileId || entry.name;
        const label = entry.group_label ?? entry.groupLabel ?? null;

        // Index by ID/profileId
        if (id && label && !map.has(id)) {
          map.set(id, label);
        }

        // Also index by display name for lookups that use name instead of ID
        if (entry.name && label && entry.name !== id && !map.has(entry.name)) {
          map.set(entry.name, label);
        }
      });
    };
```

**Step 2: Run unit test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/userGroupLabelMap.unit.test.mjs --verbose`

Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/fitness/userGroupLabelMap.unit.test.mjs frontend/src/context/FitnessContext.jsx
git commit -m "fix: index userGroupLabelMap by both id and display name

Lookups using display name (e.g., 'KC Kern') now resolve to group_label
just like id-based lookups ('kckern'). This fixes components that pass
name instead of id to getDisplayLabel().

Adds unit tests for the indexing logic."
```

---

## Task 3: Fix FamilySelector.jsx Fallback Chain

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:396`

**Step 1: Remove dead display_name fallback**

Find (line 396):
```javascript
        name: user.group_label || user.display_name || user.name || user.id,
```

Replace with:
```javascript
        name: user.group_label || user.name || user.id,
```

**Step 2: Verify no breaking changes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="FamilySelector|gratitude" --passWithNoTests`

Expected: PASS (or no tests found)

**Step 3: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git commit -m "fix: remove dead display_name fallback in FamilySelector

The gratitude bootstrap API returns 'name' (already populated with
display_name from backend), not 'display_name' directly. The fallback
was misleading and never matched anything."
```

---

## Task 4: Manual Integration Test

**Files:** None (manual verification)

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Verify Fitness module**

1. Navigate to fitness app
2. Verify primary user shows "Dad" (or configured group_label) in sidebar
3. Verify guest assignment dropdown shows correct labels

**Step 3: Verify FamilySelector (roulette wheel)**

1. Navigate to FamilySelector app
2. Verify wheel segments show "Dad", "Mom", etc. instead of full names
3. Spin wheel and verify winner modal shows correct label

**Step 4: Document test results**

Note any issues found for follow-up.

---

## Task 5: Archive WIP Document

**Files:**
- Delete: `docs/_wip/2026-01-14-group-label-wiring-remediation.md`

**Step 1: Remove WIP file (implementation complete)**

```bash
git rm docs/_wip/2026-01-14-group-label-wiring-remediation.md
git commit -m "docs: archive group_label wiring remediation WIP (implemented)"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|-----------------|
| 1 | Write unit test for map indexing | Low |
| 2 | Fix FitnessContext.jsx indexing | Low |
| 3 | Fix FamilySelector.jsx fallback | Trivial |
| 4 | Manual integration test | Low |
| 5 | Archive WIP document | Trivial |

**Total changes:** 2 files modified, 1 test file created, 1 WIP file removed
