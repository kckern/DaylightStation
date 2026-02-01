# System Layer Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename `0_infrastructure/` to `0_system/` and update all imports/references across the codebase.

**Architecture:** Git move preserves history. Update all relative imports in src/, then update package.json alias, then update docs references. Legacy code (`_legacy/`) is out of scope.

**Tech Stack:** Git, sed/grep for bulk updates, Node.js import aliases

---

## Pre-Flight Checks

Before starting, verify:
- [ ] Working tree is clean (`git status`)
- [ ] All tests pass (`npm test`)
- [ ] Dev server is not running

---

## Task 1: Rename Directory

**Files:**
- Move: `backend/src/0_infrastructure/` → `backend/src/0_system/`

**Step 1: Git move the directory**

```bash
git mv backend/src/0_infrastructure backend/src/0_system
```

**Step 2: Verify move succeeded**

```bash
ls backend/src/0_system/
# Expected: bootstrap.mjs config eventbus http logging proxy registry.ts rendering routing scheduling testing users utils
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename 0_infrastructure to 0_system

Part of system layer standardization per system-layer-guidelines.md"
```

---

## Task 2: Update Relative Imports in 0_system (Internal)

**Files:**
- Modify: `backend/src/0_system/config/index.mjs`
- Modify: `backend/src/0_system/proxy/index.mjs`
- Modify: `backend/src/0_system/eventbus/index.mjs`

These files reference `0_infrastructure` in their own relative paths.

**Step 1: Find and review internal references**

```bash
grep -r "0_infrastructure" backend/src/0_system/
```

**Step 2: Update paths (if any remain after git mv)**

The `git mv` should handle paths within the directory. If any hardcoded strings remain, update them:

```bash
# Check for any hardcoded path strings
grep -r "0_infrastructure" backend/src/0_system/
# If found, manually update each occurrence
```

**Step 3: Verify no references remain**

```bash
grep -r "0_infrastructure" backend/src/0_system/
# Expected: No output
```

**Step 4: Commit if changes were made**

```bash
git add backend/src/0_system/
git commit -m "refactor: update internal paths in 0_system"
```

---

## Task 3: Update Imports in 1_domains Layer

**Files:**
- Check: `backend/src/1_domains/**/*.mjs`

**Step 1: Find domain files importing from infrastructure**

```bash
grep -rn "0_infrastructure" backend/src/1_domains/
```

**Step 2: Update each import path**

For each file found, change:
```javascript
// FROM
from '../../0_infrastructure/...'
// TO
from '../../0_system/...'
```

**Step 3: Verify no references remain**

```bash
grep -r "0_infrastructure" backend/src/1_domains/
# Expected: No output
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/
git commit -m "refactor: update domain layer imports to 0_system"
```

---

## Task 4: Update Imports in 2_adapters Layer

**Files to modify (32 files identified):**
- `backend/src/2_adapters/scheduling/YamlStateStore.mjs`
- `backend/src/2_adapters/scheduling/YamlJobStore.mjs`
- `backend/src/2_adapters/messaging/YamlConversationStateStore.mjs`
- `backend/src/2_adapters/messaging/GmailAdapter.mjs`
- `backend/src/2_adapters/messaging/TelegramAdapter.mjs`
- `backend/src/2_adapters/telegram/TelegramChatRef.mjs`
- `backend/src/2_adapters/journalist/DebriefRepository.mjs`
- `backend/src/2_adapters/journalist/LoggingAIGateway.mjs`
- `backend/src/2_adapters/finance/BuxferAdapter.mjs`
- `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs`
- `backend/src/2_adapters/proxy/AudiobookshelfProxyAdapter.mjs`
- `backend/src/2_adapters/proxy/FreshRSSProxyAdapter.mjs`
- `backend/src/2_adapters/proxy/ImmichProxyAdapter.mjs`
- `backend/src/2_adapters/proxy/PlexProxyAdapter.mjs`

**Step 1: Bulk update imports**

```bash
find backend/src/2_adapters -name "*.mjs" -exec grep -l "0_infrastructure" {} \; | while read f; do
  sed -i 's|0_infrastructure|0_system|g' "$f"
done
```

**Step 2: Verify no references remain**

```bash
grep -r "0_infrastructure" backend/src/2_adapters/
# Expected: No output
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/
git commit -m "refactor: update adapter layer imports to 0_system"
```

---

## Task 5: Update Imports in 3_applications Layer

**Files to modify:**
- `backend/src/3_applications/finance/FinanceHarvestService.mjs`
- Any others found

**Step 1: Bulk update imports**

```bash
find backend/src/3_applications -name "*.mjs" -exec grep -l "0_infrastructure" {} \; | while read f; do
  sed -i 's|0_infrastructure|0_system|g' "$f"
done
```

**Step 2: Verify no references remain**

```bash
grep -r "0_infrastructure" backend/src/3_applications/
# Expected: No output
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/
git commit -m "refactor: update application layer imports to 0_system"
```

---

## Task 6: Update Imports in 4_api Layer

**Files to modify (14 router files + middleware):**
- `backend/src/4_api/routers/gratitude.mjs`
- `backend/src/4_api/routers/journaling.mjs`
- `backend/src/4_api/routers/messaging.mjs`
- `backend/src/4_api/routers/scheduling.mjs`
- `backend/src/4_api/routers/fitness.mjs`
- `backend/src/4_api/routers/apiV1.mjs`
- `backend/src/4_api/routers/localContent.mjs`
- `backend/src/4_api/routers/nutribot.mjs`
- `backend/src/4_api/routers/play.mjs`
- `backend/src/4_api/routers/content.mjs`
- `backend/src/4_api/routers/finance.mjs`
- `backend/src/4_api/routers/homebot.mjs`
- `backend/src/4_api/routers/item.mjs`
- `backend/src/4_api/routers/journalist.mjs`
- `backend/src/4_api/webhook-server.mjs`
- `backend/src/4_api/middleware/legacyTracker.mjs`
- `backend/src/4_api/middleware/cutoverFlags.mjs`

**Step 1: Bulk update imports**

```bash
find backend/src/4_api -name "*.mjs" -exec grep -l "0_infrastructure" {} \; | while read f; do
  sed -i 's|0_infrastructure|0_system|g' "$f"
done
```

**Step 2: Verify no references remain**

```bash
grep -r "0_infrastructure" backend/src/4_api/
# Expected: No output
```

**Step 3: Commit**

```bash
git add backend/src/4_api/
git commit -m "refactor: update API layer imports to 0_system"
```

---

## Task 7: Update Entry Points

**Files:**
- `backend/src/app.mjs`
- `backend/src/server.mjs`
- `backend/index.js`

**Step 1: Update app.mjs**

```bash
sed -i 's|0_infrastructure|0_system|g' backend/src/app.mjs
```

**Step 2: Update server.mjs**

```bash
sed -i 's|0_infrastructure|0_system|g' backend/src/server.mjs
```

**Step 3: Update index.js**

```bash
sed -i 's|0_infrastructure|0_system|g' backend/index.js
```

**Step 4: Verify**

```bash
grep "0_infrastructure" backend/src/app.mjs backend/src/server.mjs backend/index.js
# Expected: No output
```

**Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/server.mjs backend/index.js
git commit -m "refactor: update entry points to 0_system"
```

---

## Task 8: Add Import Alias to package.json

**Files:**
- Modify: `package.json`

**Step 1: Read current imports section**

Current:
```json
"imports": {
  "#backend/*": "./backend/*",
  "#frontend/*": "./frontend/src/*",
  "#fixtures/*": "./tests/_fixtures/*",
  "#testlib/*": "./tests/lib/*",
  "#extensions/*": "./_extensions/*"
}
```

**Step 2: Add system alias**

Add to imports section:
```json
"#system/*": "./backend/src/0_system/*"
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add #system import alias for 0_system layer"
```

---

## Task 9: Update Documentation References

**Files (71 docs reference 0_infrastructure):**

Focus on active docs (not `_archive/`):
- `docs/reference/core/domain-layer-guidelines.md`
- `docs/reference/core/application-layer-guidelines.md`
- `docs/reference/core/backend-architecture.md`
- `docs/reference/core/configuration.md`
- `docs/reference/core/ddd-file-map.md`
- `docs/reference/core/migration-summary.md`
- `docs/ai-context/agents.md`

**Step 1: Update reference docs**

```bash
find docs/reference -name "*.md" -exec grep -l "0_infrastructure" {} \; | while read f; do
  sed -i 's|0_infrastructure|0_system|g' "$f"
done
```

**Step 2: Update ai-context docs**

```bash
find docs/ai-context -name "*.md" -exec grep -l "0_infrastructure" {} \; | while read f; do
  sed -i 's|0_infrastructure|0_system|g' "$f"
done
```

**Step 3: Update runbooks**

```bash
find docs/runbooks -name "*.md" -exec grep -l "0_infrastructure" {} \; | while read f; do
  sed -i 's|0_infrastructure|0_system|g' "$f"
done
```

**Step 4: Commit**

```bash
git add docs/
git commit -m "docs: update references from 0_infrastructure to 0_system"
```

---

## Task 10: Verify and Test

**Step 1: Check for any remaining references**

```bash
grep -r "0_infrastructure" backend/src/
# Expected: No output (only _legacy/ should have references)
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Start dev server and verify**

```bash
node backend/index.js
# Verify no import errors in logs
```

**Step 4: Final commit (if any fixes needed)**

```bash
git status
# If clean, no action needed
```

---

## Out of Scope

The following are intentionally NOT updated:
- `backend/_legacy/` - Legacy code will be removed separately
- `docs/_archive/` - Historical documents preserved as-is
- `docs/plans/` (except active ones) - Plans are point-in-time snapshots

---

## Rollback

If issues arise:
```bash
git revert HEAD~N  # Where N is number of commits to revert
```

Or reset to before migration:
```bash
git log --oneline  # Find commit before Task 1
git reset --hard <commit-hash>
```
