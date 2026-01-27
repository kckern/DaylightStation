# Parity Implementation Code Audit Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Manually audit all parity implementations against legacy code to verify correctness, test quality, and absence of hardcoded values.

**Architecture:** Compare each new DDD implementation line-by-line against its legacy counterpart. Verify tests actually exercise code paths (not just "function exists" checks). Flag any hardcoded values or missing edge cases.

**Tech Stack:** Node.js, Jest, manual code review

---

## Audit Methodology

For each component:
1. **Read legacy code** - understand what it actually does
2. **Read new code** - verify it does the same thing
3. **Read tests** - verify they test actual behavior, not just existence
4. **Run tests with coverage** - verify code paths are exercised
5. **Document findings** - log any discrepancies or issues

---

## Phase 1: High-Risk Components (AI/External APIs)

### Task 1: Audit BuxferAdapter.processTransactions

**Files:**
- Legacy: `backend/_legacy/lib/buxfer.mjs:157-208`
- New: `backend/src/2_adapters/finance/BuxferAdapter.mjs` (processTransactions method)
- Tests: `tests/unit/adapters/finance/BuxferAdapter.test.mjs`

**Step 1: Compare legacy behavior**

Read legacy code and document:
```
Legacy processTransactions:
1. Fetches transactions in date range
2. Filters: noTag OR hasRawDescription (hardcoded regex!)
3. For each: calls askGPT with chat template from YAML
4. If valid category: updateTransaction
5. Deletes FDIC/Redemption from account 732539 (hardcoded!)
6. Returns filtered transactions
```

Run: Read `backend/_legacy/lib/buxfer.mjs:157-208`
Document: What hardcoded values exist?

**Step 2: Verify new implementation parity**

Read new code and verify:
- [ ] Filters transactions same way (configurable patterns)
- [ ] AI categorization flow matches
- [ ] Update logic matches
- [ ] Delete logic matches (but configurable)
- [ ] Return value matches

Run: Read `backend/src/2_adapters/finance/BuxferAdapter.mjs` processTransactions
Document: Any behavioral differences?

**Step 3: Audit test quality**

For each test, verify it:
- [ ] Actually calls the code path it claims to test
- [ ] Has meaningful assertions (not just "didn't throw")
- [ ] Tests edge cases (empty input, errors, invalid data)

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation-backend-refactor && NODE_OPTIONS=--experimental-vm-modules npx jest --coverage --collectCoverageFrom='backend/src/2_adapters/finance/BuxferAdapter.mjs' tests/unit/adapters/finance/BuxferAdapter.test.mjs 2>&1 | tail -50`

Expected: >80% line coverage on processTransactions

**Step 4: Document findings**

Create findings entry in audit log.

---

### Task 2: Audit FitnessSyncerAdapter

**Files:**
- Legacy: `backend/_legacy/lib/fitsync.mjs`
- New: `backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs`
- Tests: `tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`

**Step 1: List all legacy functions**

Run: `grep -n "^export const\|^export async function\|^const.*=.*async" backend/_legacy/lib/fitsync.mjs | head -30`

Document: Which functions were migrated?

**Step 2: Verify each migrated function**

For each function in new adapter:
- [ ] getAccessToken - matches legacy token refresh logic?
- [ ] refreshToken - handles expiry correctly?
- [ ] getSourceId - caches correctly?
- [ ] getActivities - pagination matches?
- [ ] syncActivity - sync logic matches?

Run: Side-by-side comparison of key functions

**Step 3: Audit test quality**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest --coverage --collectCoverageFrom='backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs' tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`

Expected: >70% coverage

**Step 4: Document findings**

---

### Task 3: Audit GarminHarvester

**Files:**
- Legacy: `backend/_legacy/lib/garmin.mjs`
- New: `backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs`
- Tests: `tests/unit/adapters/harvester/fitness/GarminHarvester.test.mjs`

**Step 1: Compare method signatures**

Run: `grep -n "async\|getActivity\|getSteps\|getHeartRate\|download" backend/_legacy/lib/garmin.mjs`

Document: Which methods were added?

**Step 2: Verify implementation**

- [ ] getActivityDetails - returns same data shape?
- [ ] getSteps - date handling matches?
- [ ] getHeartRate - date handling matches?
- [ ] downloadActivityData - file path handling matches?

**Step 3: Audit tests**

Run coverage report.

**Step 4: Document findings**

---

### Task 4: Audit StravaHarvester

**Files:**
- Legacy: `backend/_legacy/lib/strava.mjs`
- New: `backend/src/2_adapters/harvester/fitness/StravaHarvester.mjs`
- Tests: `tests/unit/adapters/harvester/fitness/StravaHarvester.test.mjs`

**Step 1: Verify reauthSequence**

Run: `grep -A 20 "reauth\|oauth\|authorize" backend/_legacy/lib/strava.mjs`

Compare URL construction, scope, parameters.

**Step 2: Audit tests**

Verify tests cover:
- [ ] URL construction with all parameters
- [ ] Missing client ID handling
- [ ] Custom redirect URI

**Step 3: Document findings**

---

## Phase 2: Content/Media Components

### Task 5: Audit PlexClient.hubSearch

**Files:**
- Legacy: `backend/_legacy/lib/plex.mjs` (search functionality)
- New: `backend/src/2_adapters/content/media/plex/PlexClient.mjs`
- Tests: `tests/unit/adapters/content/media/plex/PlexClient.test.mjs`

**Step 1: Find legacy search**

Run: `grep -n "search\|hub" backend/_legacy/lib/plex.mjs`

**Step 2: Compare implementation**

- [ ] Same API endpoint?
- [ ] Same query parameters?
- [ ] Same response mapping?

**Step 3: Audit tests**

**Step 4: Document findings**

---

### Task 6: Audit PlexAdapter.loadImgFromKey

**Files:**
- Legacy: `backend/_legacy/lib/plexThumb.mjs`
- New: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`

**Step 1: Find legacy implementation**

Run: `grep -n "loadImgFromKey\|thumb\|image" backend/_legacy/lib/plexThumb.mjs | head -20`

**Step 2: Compare**

- [ ] Returns same array format [thumb, parentThumb, grandparentThumb]?
- [ ] Handles missing values same way?

**Step 3: Document findings**

---

### Task 7: Audit MediaMemoryValidatorService

**Files:**
- Legacy: `backend/_legacy/lib/mediaMemory.mjs`
- New: `backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs`
- Tests: `tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs`

**Step 1: Verify validation logic**

- [ ] Confidence calculation matches?
- [ ] Sampling logic matches?
- [ ] Update logic matches?

**Step 2: Audit tests**

**Step 3: Document findings**

---

## Phase 3: Utilities & Schema

### Task 8: Audit yamlSanitizer

**Files:**
- Legacy: `backend/_legacy/lib/mediaMemory.mjs:23-64`
- New: `backend/src/0_infrastructure/utils/yamlSanitizer.mjs`

**Step 1: Compare sanitization logic**

- [ ] Same control characters removed?
- [ ] Same unicode handling?
- [ ] Same recursive object handling?

**Step 2: Document findings**

---

### Task 9: Audit JournalEntry schema changes

**Files:**
- New: `backend/src/1_domains/journaling/entities/JournalEntry.mjs`

**Step 1: Verify prompts/attachments**

- [ ] Added to constructor?
- [ ] Added to toJSON()?
- [ ] Defaults to empty array?

**Step 2: Document findings**

---

### Task 10: Audit Message entity schema changes

**Files:**
- Legacy: `backend/_legacy/chatbots/domain/entities/Message.mjs`
- New: `backend/src/1_domains/messaging/entities/Message.mjs`

**Step 1: Compare schemas**

- [ ] direction property added?
- [ ] attachments property added?
- [ ] MESSAGE_DIRECTIONS exported?
- [ ] Helper methods added (isIncoming, isOutgoing, hasAttachments)?
- [ ] toJSON includes new fields?
- [ ] Static factories updated?

**Step 2: Document findings**

---

### Task 11: Audit keyboard endpoint

**Files:**
- Legacy: `backend/_legacy/routers/fetch.mjs:812-827`
- New: `backend/src/4_api/routers/homeAutomation.mjs`

**Step 1: Compare endpoint behavior**

- [ ] Same route pattern?
- [ ] Same filtering logic?
- [ ] Same response shape?
- [ ] Error handling matches?

**Step 2: Document findings**

---

### Task 12: Audit ThermalPrinterAdapter.testFeedButton

**Files:**
- Legacy: `backend/_legacy/lib/thermalPrinter.mjs`
- New: `backend/src/2_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs`

**Step 1: Find legacy implementation**

Run: `grep -n "testFeed\|feedButton\|setFeedButton" backend/_legacy/lib/thermalPrinter.mjs`

**Step 2: Compare**

- [ ] Same sequence (disable, wait, enable)?
- [ ] Same timing?
- [ ] Same return value?

**Step 3: Document findings**

---

## Phase 4: Final Verification

### Task 13: Run full test suite

**Step 1: Run all unit tests**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation-backend-refactor && npm test 2>&1 | tail -100`

Document: Any failures?

**Step 2: Check for skipped tests**

Run: `grep -r "skip\|xit\|xdescribe" tests/`

Document: Any tests being skipped?

---

### Task 14: Create audit summary

**Step 1: Compile findings**

Create `docs/_wip/audits/2026-01-13-parity-implementation-audit.md` with:
- Issues found per component
- Test quality assessment
- Recommendations

**Step 2: Prioritize fixes**

List any issues that need immediate fixing vs technical debt.

---

## Audit Checklist Summary

| Component | Legacy Parity | Test Quality | No Hardcoding | Status |
|-----------|--------------|--------------|---------------|--------|
| BuxferAdapter.processTransactions | ⬜ | ⬜ | ⬜ | Pending |
| FitnessSyncerAdapter | ⬜ | ⬜ | ⬜ | Pending |
| GarminHarvester | ⬜ | ⬜ | ⬜ | Pending |
| StravaHarvester | ⬜ | ⬜ | ⬜ | Pending |
| PlexClient.hubSearch | ⬜ | ⬜ | ⬜ | Pending |
| PlexAdapter.loadImgFromKey | ⬜ | ⬜ | ⬜ | Pending |
| MediaMemoryValidatorService | ⬜ | ⬜ | ⬜ | Pending |
| yamlSanitizer | ⬜ | ⬜ | ⬜ | Pending |
| JournalEntry | ⬜ | ⬜ | ⬜ | Pending |
| Message | ⬜ | ⬜ | ⬜ | Pending |
| keyboard endpoint | ⬜ | ⬜ | ⬜ | Pending |
| ThermalPrinterAdapter | ⬜ | ⬜ | ⬜ | Pending |
