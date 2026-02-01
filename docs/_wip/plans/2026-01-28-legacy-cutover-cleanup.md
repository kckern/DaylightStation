# Legacy Cutover Infrastructure Cleanup

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove dead legacy cutover infrastructure now that the backend migration is complete.

**Architecture:** Delete unused middleware files and admin router, update documentation references.

**Tech Stack:** Node.js/Express backend, Markdown docs

---

## Analysis Summary

The legacy cutover infrastructure was built to support gradual migration from the old backend. Now that migration is complete, these files are dead code:

| File | Status | Reason |
|------|--------|--------|
| `cutoverFlags.mjs` | Dead code | Not imported anywhere |
| `legacyTracker.mjs` | Dead code | Only used by dead admin router |
| `admin/legacy.mjs` | Dead code | Exported but never mounted |

### Documentation References (need updating)

These docs reference the deleted files and should be updated:
- `docs/plans/2026-01-27-backend-coding-standards-remediation.md`
- `docs/_wip/audits/2026-01-27-4_api-layer-audit.md`
- `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md`
- `docs/_wip/audits/2026-01-26-api-layer-ddd-audit.md`
- `docs/plans/2026-01-26-import-alias-migration.md`
- `docs/plans/2026-01-26-system-layer-rename.md`

---

### Task 1: Delete cutoverFlags.mjs

**Files:**
- Delete: `backend/src/4_api/middleware/cutoverFlags.mjs`

**Step 1: Verify no imports exist**

Run: `grep -rn "cutoverFlags" backend/src --include="*.mjs" | grep -v cutoverFlags.mjs`
Expected: No output (no imports found)

**Step 2: Delete the file**

```bash
rm backend/src/4_api/middleware/cutoverFlags.mjs
```

**Step 3: Verify deletion**

Run: `ls backend/src/4_api/middleware/cutoverFlags.mjs 2>&1`
Expected: "No such file or directory"

---

### Task 2: Delete legacyTracker.mjs

**Files:**
- Delete: `backend/src/4_api/middleware/legacyTracker.mjs`

**Step 1: Verify only dead code uses it**

Run: `grep -rn "legacyTracker" backend/src --include="*.mjs" | grep -v legacyTracker.mjs`
Expected: Only `admin/legacy.mjs` (which we'll delete next)

**Step 2: Delete the file**

```bash
rm backend/src/4_api/middleware/legacyTracker.mjs
```

---

### Task 3: Delete admin/legacy.mjs router

**Files:**
- Delete: `backend/src/4_api/v1/routers/admin/legacy.mjs`
- Modify: `backend/src/4_api/v1/routers/index.mjs:53` (remove export)

**Step 1: Verify router is never mounted**

Run: `grep -rn "createLegacyAdminRouter" backend/src --include="*.mjs" | grep -v "export\|import"`
Expected: No output (never actually used)

**Step 2: Delete the router file**

```bash
rm backend/src/4_api/v1/routers/admin/legacy.mjs
```

**Step 3: Remove export from index.mjs**

In `backend/src/4_api/v1/routers/index.mjs`, delete line 53:
```javascript
export { createLegacyAdminRouter } from './admin/legacy.mjs';
```

**Step 4: Check if admin directory is empty**

Run: `ls backend/src/4_api/v1/routers/admin/`
Expected: If empty except .gitkeep, leave it. If completely empty, consider removing.

---

### Task 4: Verify backend still starts

**Step 1: Run syntax check**

Run: `cd backend && node --check src/app.mjs`
Expected: No errors

**Step 2: Start backend briefly**

Run: `cd backend && timeout 5 node index.js 2>&1 | head -20`
Expected: Server starts without import errors

---

### Task 5: Update documentation references

**Files to update:**
- `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md`

**Step 1: Remove cutoverFlags from middleware list**

Find the middleware directory tree and remove `cutoverFlags.mjs` entry.
Find any code examples referencing cutoverFlags and remove them.

**Step 2: Archive completed audit/plan docs**

Move to `docs/_archive/2026-01-cleanup/`:
- Any docs that are primarily about the legacy cutover that's now complete

---

### Task 6: Commit changes

**Step 1: Stage deletions and modifications**

```bash
git add -u backend/src/4_api/middleware/cutoverFlags.mjs
git add -u backend/src/4_api/middleware/legacyTracker.mjs
git add -u backend/src/4_api/v1/routers/admin/legacy.mjs
git add backend/src/4_api/v1/routers/index.mjs
git add frontend/src/hooks/fitness/PersistenceManager.js
```

**Step 2: Commit**

```bash
git commit -m "chore: remove dead legacy cutover infrastructure

- Delete cutoverFlags.mjs (unused feature flags)
- Delete legacyTracker.mjs (unused tracking)
- Delete admin/legacy.mjs router (never mounted)
- Fix PersistenceManager.js api/v1 path

Legacy backend migration is complete; this infrastructure
is no longer needed.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```
