# Nutribot Bug Report Corrections Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct inaccuracies in the nutribot file extension bug report documentation.

**Architecture:** Update the existing WIP bug report to accurately reflect the actual code fix (switching from `saveYamlToPath` to `saveYaml`), reconcile documentation comments, and add traceability.

**Tech Stack:** Markdown documentation, git history

---

### Task 1: Verify the Actual Fix via Git History

**Files:**
- Read: `backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`

**Step 1: Check git log for the fix commit**

Run: `git log --oneline -10 -- backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`
Expected: Recent commit showing the fix

**Step 2: View the diff of the fix**

Run: `git show <commit-hash> -- backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`
Expected: Diff showing change from `saveYamlToPath` to `saveYaml`

**Step 3: Document the commit hash**

Record the commit hash for inclusion in the bug report.

---

### Task 2: Update the Code Fix Section

**Files:**
- Modify: `docs/_wip/2026-01-25-nutribot-file-extension-bug-report.md:69-89`

**Step 1: Replace the incorrect code diff**

Replace lines 69-89 with accurate before/after showing:
- BEFORE: Used `saveYamlToPath(filePath, data)` which writes path as-is
- AFTER: Uses `saveYaml(basePath, data)` which normalizes extension via FileIO

```markdown
### Code Fix

**File:** `backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`

**Commit:** `<commit-hash>`

```javascript
// BEFORE (buggy) - used saveYamlToPath which writes path as-is
#writeFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  saveYamlToPath(filePath, data);  // Writes to exact path without extension normalization
}

// AFTER (fixed) - uses saveYaml which normalizes extension
#writeFile(basePath, data) {
  ensureDir(path.dirname(basePath));
  saveYaml(basePath, data);  // FileIO.saveYaml adds .yml extension if missing
}
```

**Why this works:** The `saveYaml` function in `FileIO.mjs:104-116` automatically appends `.yml` if the path doesn't already have a YAML extension, ensuring read/write symmetry with `loadYamlSafe` which uses `resolveYamlPath`.
```

**Step 2: Verify the edit is correct**

Read the file to confirm the change was applied correctly.

**Step 3: Commit**

```bash
git add docs/_wip/2026-01-25-nutribot-file-extension-bug-report.md
git commit -m "docs: correct code diff in nutribot bug report

The original report showed manual extension normalization in #writeFile,
but the actual fix was switching from saveYamlToPath to saveYaml.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Update the Attribution

**Files:**
- Modify: `docs/_wip/2026-01-25-nutribot-file-extension-bug-report.md:184-186`

**Step 1: Correct the "Report Prepared By" section**

Replace:
```markdown
**Report Prepared By:** GitHub Copilot
**Reviewed By:** _________________
**Date:** 2026-01-25
```

With:
```markdown
**Report Prepared By:** Claude
**Reviewed By:** Claude Opus 4.5
**Date:** 2026-01-25
```

**Step 2: Commit**

```bash
git add docs/_wip/2026-01-25-nutribot-file-extension-bug-report.md
git commit -m "docs: correct attribution in nutribot bug report

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Add FileIO Context to Root Cause Section

**Files:**
- Modify: `docs/_wip/2026-01-25-nutribot-file-extension-bug-report.md:25-41`

**Step 1: Enhance root cause explanation**

After the existing table, add context about the FileIO abstraction:

```markdown
**FileIO Design:**

The `FileIO.mjs` module provides paired read/write functions for YAML:
- `loadYamlSafe(basePath)` → calls `resolveYamlPath()` which tries `.yml` then `.yaml`
- `saveYaml(basePath, data)` → automatically appends `.yml` if no extension

The bug occurred because `#writeFile` was calling `saveYamlToPath` (which writes to exact path) instead of `saveYaml` (which normalizes extension). This broke the symmetry with `#readFile` which uses `loadYamlSafe`.
```

**Step 2: Commit**

```bash
git add docs/_wip/2026-01-25-nutribot-file-extension-bug-report.md
git commit -m "docs: add FileIO context to nutribot bug root cause

Explains the paired read/write design and why saveYaml vs saveYamlToPath matters.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Note the Storage Path Discrepancy (Optional)

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs:7-10`

**Step 1: Review whether comments need updating**

The file header comments mention:
```
 * - Hot storage: households/{hid}/apps/nutrition/nutrilist.yml
```

But `#getPath()` builds:
```
lifelog/nutrition/nutrilist
```

**Decision point:** Either update comments to match code, or note this discrepancy in the bug report as a separate follow-up item.

**Step 2: If updating comments, commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs
git commit -m "docs: correct storage path comments in YamlNutriListStore

Comments referenced households/{hid}/apps/ but code uses lifelog/nutrition/.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Verify fix via git history | Simple |
| 2 | Update code fix section | Medium |
| 3 | Update attribution | Simple |
| 4 | Add FileIO context | Simple |
| 5 | Address storage path discrepancy | Optional |
