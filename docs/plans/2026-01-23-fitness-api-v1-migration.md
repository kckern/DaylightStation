# Fitness API v1 Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate 6 remaining non-v1 API calls in Fitness frontend to use `/api/v1/` prefix, and fix one incorrect endpoint path.

**Architecture:** Simple string replacement in frontend files. All backend v1 endpoints already exist - this is purely frontend path updates. One endpoint (`session/snapshot`) needs to be corrected to `save_screenshot`.

**Tech Stack:** React/JSX, JavaScript fetch API, DaylightAPI helper

---

## Summary of Changes

| File | Current Endpoint | Correct v1 Endpoint |
|------|------------------|---------------------|
| `FitnessApp.jsx` | `/api/fitness/simulate` | `/api/v1/fitness/simulate` |
| `SessionBrowserApp.jsx` | `/api/fitness/sessions/*` | `/api/v1/fitness/sessions/*` |
| `CameraViewApp.jsx` | `/api/fitness/session/snapshot` | `/api/v1/fitness/save_screenshot` (path fix + v1) |

---

### Task 1: Migrate FitnessApp simulate endpoints

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:797,802`

**Step 1: Update DELETE endpoint**

Change line 797 from:
```javascript
fetch('/api/fitness/simulate', { method: 'DELETE' })
```
to:
```javascript
fetch('/api/v1/fitness/simulate', { method: 'DELETE' })
```

**Step 2: Update POST endpoint**

Change line 802 from:
```javascript
fetch('/api/fitness/simulate', {
```
to:
```javascript
fetch('/api/v1/fitness/simulate', {
```

**Step 3: Verify syntax**

Run: `cd frontend && npm run lint -- --quiet src/Apps/FitnessApp.jsx`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): migrate simulate endpoint to v1 API"
```

---

### Task 2: Migrate SessionBrowserApp endpoints

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/SessionBrowserApp/SessionBrowserApp.jsx:94,109,124`

**Step 1: Update sessions/dates endpoint**

Change line 94 from:
```javascript
const res = await fetch('/api/fitness/sessions/dates');
```
to:
```javascript
const res = await fetch('/api/v1/fitness/sessions/dates');
```

**Step 2: Update sessions by date endpoint**

Change line 109 from:
```javascript
const res = await fetch(`/api/fitness/sessions?date=${date}`);
```
to:
```javascript
const res = await fetch(`/api/v1/fitness/sessions?date=${date}`);
```

**Step 3: Update session by ID endpoint**

Change line 124 from:
```javascript
const res = await fetch(`/api/fitness/sessions/${sessionId}`);
```
to:
```javascript
const res = await fetch(`/api/v1/fitness/sessions/${sessionId}`);
```

**Step 4: Verify syntax**

Run: `cd frontend && npm run lint -- --quiet src/modules/Fitness/FitnessPlugins/plugins/SessionBrowserApp/SessionBrowserApp.jsx`
Expected: No errors

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/SessionBrowserApp/SessionBrowserApp.jsx
git commit -m "fix(fitness): migrate SessionBrowserApp endpoints to v1 API"
```

---

### Task 3: Fix and migrate CameraViewApp endpoint

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/CameraViewApp/CameraViewApp.jsx:122`

**Note:** This endpoint has TWO issues:
1. Missing `/v1/` prefix
2. Wrong endpoint path (`session/snapshot` doesn't exist - should be `save_screenshot`)

**Step 1: Fix endpoint path AND add v1 prefix**

Change line 122 from:
```javascript
const resp = await DaylightAPI.post('/api/fitness/session/snapshot', payload);
```
to:
```javascript
const resp = await DaylightAPI.post('/api/v1/fitness/save_screenshot', payload);
```

**Step 2: Verify syntax**

Run: `cd frontend && npm run lint -- --quiet src/modules/Fitness/FitnessPlugins/plugins/CameraViewApp/CameraViewApp.jsx`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/CameraViewApp/CameraViewApp.jsx
git commit -m "fix(fitness): correct CameraViewApp endpoint path and migrate to v1 API

The endpoint was incorrectly calling /session/snapshot which doesn't exist.
Corrected to /save_screenshot which is the actual backend endpoint."
```

---

### Task 4: Update documentation

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/design.md:1194`

**Step 1: Update example in documentation**

Change line 1194 from:
```javascript
const config = await DaylightAPI('/api/fitness');
```
to:
```javascript
const config = await DaylightAPI('/api/v1/fitness');
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/design.md
git commit -m "docs(fitness): update API example to use v1 endpoint"
```

---

### Task 5: Verify all migrations complete

**Step 1: Search for remaining non-v1 calls**

Run: `grep -rn "/api/fitness[^/v]" frontend/src/modules/Fitness/ frontend/src/Apps/FitnessApp.jsx`
Expected: No output (no matches found)

**Step 2: Verify no legacy endpoint paths remain**

Run: `grep -rn "session/snapshot" frontend/src/`
Expected: No matches (deprecated endpoint removed)

**Step 3: Search for correct v1 pattern**

Run: `grep -rn "/api/v1/fitness" frontend/src/modules/Fitness/ frontend/src/Apps/FitnessApp.jsx | wc -l`
Expected: Count should include all migrated endpoints

---

## Verification Checklist

- [ ] All `/api/fitness/simulate` calls use `/api/v1/fitness/simulate`
- [ ] All `/api/fitness/sessions` calls use `/api/v1/fitness/sessions`
- [ ] CameraViewApp uses `/api/v1/fitness/save_screenshot` (not `session/snapshot`)
- [ ] Documentation updated
- [ ] No remaining non-v1 fitness API calls in frontend
