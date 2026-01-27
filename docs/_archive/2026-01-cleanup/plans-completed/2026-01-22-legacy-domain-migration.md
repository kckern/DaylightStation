# Legacy Domain Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate remaining legacy lib files to proper DDD structure while preserving chatbot webhooks and legacy routers.

**Architecture:**
- All logging imports → `#backend/src/0_infrastructure/logging/`
- Domain logic → `#backend/src/1_domains/{domain}/services/`
- Chatbots stay in `_legacy/chatbots/` (secondary port 3119 preserved)
- Legacy routers stay in `_legacy/routers/`

**Tech Stack:** Node.js ES Modules, DDD architecture

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Convert legacy logging shims to re-exports | 4 modify |
| 2 | Migrate finance domain libs | 4 files → 1_domains/finance |
| 3 | Migrate entropy domain lib | 1 file → 1_domains/entropy |
| 4 | Migrate content domain libs | 3 files → 1_domains/content |
| 5 | Verify webhook/chatbot setup | 0 modify (verify only) |
| 6 | Create legacy lib shims | multiple shims |
| 7 | Final verification | 0 |

**Out of Scope:**
- Chatbots (`_legacy/chatbots/`) - stays in legacy
- Legacy routers (`_legacy/routers/`) - stays in legacy
- Harvester libs (strava, withings, etc.) - already have adapters in `2_adapters/harvester/`

---

## Task 1: Ensure Logging Shims Re-export from New Location

**Files:**
- Verify: `backend/_legacy/lib/logging/logger.js`
- Verify: `backend/_legacy/lib/logging/dispatcher.js`
- Verify: `backend/_legacy/lib/logging/utils.js`
- Verify: `backend/_legacy/lib/logging/ingestion.js`

**Step 1: Check current state of each logging file**

The goal is to ensure all legacy logging files are shims that re-export from the new infrastructure location.

```bash
head -20 backend/_legacy/lib/logging/*.js
```

**Step 2: Update logger.js to be a re-export shim**

The legacy `logger.js` may still be the full implementation. Convert it to a shim:

```javascript
/**
 * Logger Factory - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new infrastructure location.
 * Once all consumers are migrated, this file can be deleted.
 */

export { createLogger } from '../../../src/0_infrastructure/logging/logger.js';
export { default } from '../../../src/0_infrastructure/logging/logger.js';
```

**Step 3: Verify all shims are in place**

```bash
for f in backend/_legacy/lib/logging/*.js; do
  echo "=== $f ==="
  grep -l "re-export\|Re-export" "$f" || echo "NOT A SHIM: $f"
done
```

**Step 4: Verify nothing imports old implementation**

```bash
grep -rn "from.*_legacy/lib/logging" backend/ --include="*.mjs" --include="*.js" | grep -v node_modules
```

Expected: No matches

**Step 5: Commit**

```bash
git add backend/_legacy/lib/logging/
git commit -m "refactor(logging): ensure all legacy logging files are re-export shims

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Migrate Finance Domain Libs

**Files:**
- Source: `backend/_legacy/lib/budget.mjs`
- Source: `backend/_legacy/lib/buxfer.mjs`
- Source: `backend/_legacy/lib/infinity.mjs`
- Source: `backend/_legacy/lib/shopping.mjs`
- Target: `backend/src/1_domains/finance/services/`

**Step 1: Check existing finance domain structure**

```bash
ls -la backend/src/1_domains/finance/
```

**Step 2: Analyze budget.mjs to understand dependencies**

```bash
head -50 backend/_legacy/lib/budget.mjs
grep -n "import\|require" backend/_legacy/lib/budget.mjs
```

**Step 3: Create BudgetService in finance domain**

Create `backend/src/1_domains/finance/services/BudgetService.mjs`:

The service should:
- Import from new infrastructure (logging, config)
- Expose the same functions as the legacy module
- Use dependency injection where possible

**Step 4: Create legacy shim for backwards compatibility**

Update `backend/_legacy/lib/budget.mjs` to re-export from new location:

```javascript
/**
 * Budget - Legacy Re-export Shim
 */
export * from '../../../src/1_domains/finance/services/BudgetService.mjs';
export { default } from '../../../src/1_domains/finance/services/BudgetService.mjs';
```

**Step 5: Repeat for buxfer.mjs, infinity.mjs, shopping.mjs**

Same pattern:
1. Copy core logic to `1_domains/finance/services/`
2. Update imports to use new infrastructure
3. Convert legacy file to re-export shim

**Step 6: Run tests**

```bash
npm run test:unit -- --testPathPattern="finance"
```

**Step 7: Commit**

```bash
git add backend/src/1_domains/finance/ backend/_legacy/lib/budget.mjs backend/_legacy/lib/buxfer.mjs backend/_legacy/lib/infinity.mjs backend/_legacy/lib/shopping.mjs
git commit -m "refactor(finance): migrate budget/buxfer/infinity/shopping to domain services

- BudgetService, BuxferService, InfinityService, ShoppingService in 1_domains/finance
- Legacy files now re-export from new location

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Migrate Entropy Domain Lib

**Files:**
- Source: `backend/_legacy/lib/entropy.mjs`
- Target: `backend/src/1_domains/entropy/services/`

**Step 1: Check existing entropy domain structure**

```bash
ls -la backend/src/1_domains/entropy/
```

**Step 2: Analyze entropy.mjs**

```bash
head -100 backend/_legacy/lib/entropy.mjs
grep -n "import\|export" backend/_legacy/lib/entropy.mjs
```

**Step 3: Create EntropyService (or add to existing)**

Check if there's already an entropy service:
```bash
ls backend/src/1_domains/entropy/services/
```

If EntropyReportService or similar exists, integrate the legacy functions.
Otherwise create new `EntropyService.mjs`.

**Step 4: Create legacy shim**

Update `backend/_legacy/lib/entropy.mjs` to re-export from new location.

**Step 5: Run tests**

```bash
npm run test:unit -- --testPathPattern="entropy"
```

**Step 6: Commit**

```bash
git add backend/src/1_domains/entropy/ backend/_legacy/lib/entropy.mjs
git commit -m "refactor(entropy): migrate entropy lib to domain service

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Migrate Content Domain Libs

**Files:**
- Source: `backend/_legacy/lib/ArchiveService.mjs`
- Source: `backend/_legacy/lib/mediaMemory.mjs`
- Source: `backend/_legacy/lib/mediaMemoryValidator.mjs`
- Target: `backend/src/1_domains/content/services/`

**Step 1: Check existing content domain structure**

```bash
ls -la backend/src/1_domains/content/services/
```

**Step 2: Check if mediaMemory is already migrated**

```bash
grep -l "mediaMemory\|MediaMemory" backend/src/1_domains/content/services/*.mjs
```

The yamlSanitizer.mjs comment says "Migrated from: backend/_legacy/lib/mediaMemory.mjs" - check if full migration is done.

**Step 3: Migrate remaining functions**

For any functions not yet migrated:
- ArchiveService → `ArchiveService.mjs` in content domain
- mediaMemory remaining functions → `MediaMemoryService.mjs`
- mediaMemoryValidator → `MediaMemoryValidatorService.mjs` (may already exist)

**Step 4: Create legacy shims**

**Step 5: Run tests**

```bash
npm run test:unit -- --testPathPattern="content"
```

**Step 6: Commit**

```bash
git add backend/src/1_domains/content/ backend/_legacy/lib/ArchiveService.mjs backend/_legacy/lib/mediaMemory*.mjs
git commit -m "refactor(content): migrate archive and media memory to domain services

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Verify Webhook/Chatbot Setup

**Files:** None to modify - verification only

**Step 1: Verify secondary port configuration**

```bash
grep -n "secondaryPort\|3119\|SECONDARY_PORT" backend/index.js
```

Expected: Secondary server on port 3119 for webhooks

**Step 2: Verify chatbot webhook routes are wired**

```bash
grep -n "webhook\|telegram" backend/index.js | head -20
```

**Step 3: Verify legacy chatbot directory structure**

```bash
ls backend/_legacy/chatbots/
ls backend/_legacy/chatbots/bots/
```

Expected: nutribot, journalist, homebot directories present

**Step 4: Test webhook endpoint (if server running)**

```bash
curl -s http://localhost:3119/health || echo "Server not running - skip"
```

**Step 5: Document chatbot architecture**

Create a note confirming chatbots remain in legacy:

```bash
cat >> docs/_wip/2026-01-22-remaining-legacy-items.md << 'EOF'

## Chatbots Architecture (Verified Working)

The chatbot subsystem remains in `_legacy/chatbots/` by design:
- Secondary webhook server runs on port 3119
- Telegram webhooks route through `_legacy/chatbots/adapters/http/TelegramWebhookHandler.mjs`
- Bots: nutribot, journalist, homebot

This is intentional - chatbots migration is a separate project.
EOF
```

---

## Task 6: Create Legacy Lib Shims for Remaining Files

**Files:** Multiple legacy libs that may still be imported

**Step 1: Identify remaining legacy libs with active imports**

```bash
for lib in backend/_legacy/lib/*.mjs; do
  name=$(basename "$lib" .mjs)
  count=$(grep -rn "from.*_legacy/lib/${name}" backend/ --include="*.mjs" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l)
  if [ "$count" -gt 0 ]; then
    echo "$name: $count imports"
  fi
done
```

**Step 2: For each actively imported lib, decide action:**

- **Already has adapter in 2_adapters/**: Create shim pointing to adapter
- **Domain logic**: Migrate to 1_domains/, create shim
- **Infrastructure**: Migrate to 0_infrastructure/, create shim
- **Unused**: Mark for deletion

**Step 3: Create necessary shims**

Pattern for each shim:
```javascript
/**
 * [LibName] - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new location.
 * Import from [new location] instead.
 */
export * from '[new/path/to/module.mjs]';
```

**Step 4: Commit**

```bash
git add backend/_legacy/lib/
git commit -m "refactor: convert remaining legacy libs to re-export shims

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Final Verification

**Step 1: Verify no direct legacy logging imports**

```bash
grep -rn "from.*_legacy/lib/logging" backend/ --include="*.mjs" --include="*.js" | grep -v node_modules
```

Expected: No matches (all via shims or new imports)

**Step 2: Verify domain services exist**

```bash
ls backend/src/1_domains/*/services/
```

**Step 3: Verify webhooks still work**

```bash
# Check secondary server configuration
grep -A5 "secondaryServer\|Secondary.*Server" backend/index.js
```

**Step 4: Run full test suite**

```bash
npm run test:unit
npm run test:integration
```

**Step 5: Start server and verify**

```bash
node backend/index.js &
sleep 3
curl -s http://localhost:3111/health
curl -s http://localhost:3119/health
kill %1
```

**Step 6: Update documentation**

```bash
cat >> docs/_wip/2026-01-22-remaining-legacy-items.md << 'EOF'

## Migration Status (Updated)

### Completed
- All logging → `src/0_infrastructure/logging/`
- Finance domain → `src/1_domains/finance/services/`
- Entropy domain → `src/1_domains/entropy/services/`
- Content domain → `src/1_domains/content/services/`

### Remaining in Legacy (By Design)
- `_legacy/chatbots/` - Separate migration project
- `_legacy/routers/` - Cron jobs, will migrate with scheduler refactor
- `_legacy/lib/` - Shims that re-export from new locations
EOF

git add docs/_wip/
git commit -m "docs: update legacy migration status

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks:

- [ ] No direct `_legacy/lib/logging` imports (all through shims or new paths)
- [ ] Finance services in `1_domains/finance/services/`
- [ ] Entropy services in `1_domains/entropy/services/`
- [ ] Content services in `1_domains/content/services/`
- [ ] Secondary webhook server (3119) working
- [ ] Chatbots functional (nutribot, journalist)
- [ ] All tests pass
- [ ] Server starts without errors

## Notes

**Harvester libs** (strava.mjs, withings.mjs, etc.) are NOT migrated in this plan because:
- They already have proper adapters in `backend/src/2_adapters/harvester/`
- The legacy libs may be dead code or only used by legacy routers
- Will clean up when legacy routers are migrated

**io.mjs** is kept as infrastructure until all consumers use FileIO or UserDataService.
