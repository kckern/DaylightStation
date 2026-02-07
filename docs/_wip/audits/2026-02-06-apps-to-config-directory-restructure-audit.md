# Apps Directory Restructure: Proposal Audit

**Date:** 2026-02-06  
**Status:** Audit / Go-NoGo Analysis  
**Proposal:** Remove `data/household/apps/` and move contents to `data/household/config/<appname>.yml`

---

## 1. Current State

### 1.1 Existing `apps/` Directory Structure

```
household/apps/
├── chatbots.yml                          # top-level YAML (loaded as apps.chatbots)
├── devices/config.yml                    # device registry (ALREADY duplicated in config/devices.yml)
├── finances/                             # 12+ data files + subdirs (transactions, budgets, etc.)
│   ├── finances.yml
│   ├── budget.config.yml
│   ├── account.balances.yml
│   ├── payroll.yml / payrollDict.yml
│   ├── transaction.memos.yml
│   ├── mortgage.transactions.yml
│   ├── gpt.yml / tmp.yml
│   ├── 2024-04-01/transactions.yml
│   ├── 2025-04-01/transactions.yml
│   └── _archive/
├── fitness/
│   ├── config.yml                        # ~400-line runtime config (the file in question)
│   └── (sessions/ removed — now in household/history/fitness/)
├── harvesters/shopping.yml               # harvester config
└── piano/config.yml                      # piano MIDI config (ALREADY duplicated in config/devices.yml)
```

**Additionally on production (not in dev data):**
- `journalist/conversations/*.yml` — Telegram conversation state
- `nutribot/conversations/*.yml` — Telegram conversation state
- `homebot/conversations/*.yml` — referenced in code but may not exist on disk

### 1.2 Already-Migrated Data

The project has already begun a partial restructure:

| Old Location | New Location | Status |
|---|---|---|
| `household/household.yml` | `household/config/household.yml` | ✅ Migrated |
| `household/integrations.yml` | `household/config/integrations.yml` | ✅ Migrated |
| `household/apps/devices/config.yml` | `household/config/devices.yml` | ✅ Duplicated (old still exists) |
| `household/apps/piano/config.yml` | Merged into `config/devices.yml` | ✅ Duplicated (old still exists) |
| `household/apps/fitness/sessions/` | `household/history/fitness/` | ✅ Migrated |

An implementation plan already exists: `docs/_wip/plans/2026-01-31-household-config-directory.md` — partially executed (Tasks 1-3 done, rest pending).

### 1.3 Code Loading Mechanisms

| Method | Where Used | Resolves To |
|---|---|---|
| `loadHouseholdApps()` (configLoader) | Bootstrap — reads `apps/` dir | `{dataDir}/{folder}/apps/` → scans YAMLs + subdirs |
| `getHouseholdAppConfig()` (ConfigService) | Read from in-memory config tree | `config.households[hid].apps[appName]` |
| `getHouseholdPath('apps/...')` (ConfigService, **deprecated**) | app.mjs (cost, bots), YamlFinanceDatastore, YamlNutriCoachDatastore, YamlJournalDatastore | `{dataDir}/{folder}/apps/...` — filesystem path |
| `readHouseholdAppData()` (UserDataService) | FitnessConfigService, fitness.mjs router, app.mjs fitness loader | `{householdDir}/apps/{appName}/{dataPath}.yml` |

---

## 2. Analysis of the Proposal

### 2.1 What the Proposal Actually Means

Moving `apps/<appname>/config.yml` → `config/<appname>.yml` **only works cleanly for apps that have a single config file**. Several apps under `apps/` contain **much more than config**:

| App | Config-Only? | Non-Config Data |
|---|---|---|
| `fitness` | ✅ Yes (after sessions moved to `history/`) | Just `config.yml` |
| `devices` | ✅ Yes | Just `config.yml` |
| `piano` | ✅ Yes | Just `config.yml` |
| `chatbots` | ✅ Yes | Just `chatbots.yml` (top-level) |
| `harvesters` | ✅ Yes | Just `shopping.yml` |
| `finances` | ❌ **No** | 12+ files: transactions, budgets, balances, archives |
| `journalist` | ❌ **No** | `conversations/*.yml` — runtime state data |
| `nutribot` | ❌ **No** | `conversations/*.yml` — runtime state data |
| `homebot` | ❌ **No** | `conversations/*.yml` — runtime state data (referenced in code) |

**Critical finding:** The proposal as stated (`config/<appname>.yml`) only works for 5 out of 8 apps. The remaining 3 require directory structures for their runtime data.

### 2.2 The Semantic Problem

The `apps/` directory currently conflates two different concerns:
1. **Configuration** — static settings that define app behavior (fitness zones, device mappings, Plex collections)
2. **Runtime data** — mutable state generated during operation (financial transactions, conversation histories)

The proposal correctly addresses concern #1 but does not account for concern #2.

---

## 3. Pros

### 3.1 Simplicity for Config-Only Apps
For fitness, devices, piano, chatbots, and harvesters, a flat `config/<appname>.yml` is cleaner and eliminates a needless directory layer.

### 3.2 Alignment with Existing Migration
`household.yml`, `integrations.yml`, and `devices.yml` have already moved to `config/`. Adding `fitness.yml`, `chatbots.yml`, etc. completes the pattern.

### 3.3 Reduced Confusion
Currently `apps/devices/config.yml` coexists with `config/devices.yml` (duplicates). Removing the `apps/` version eliminates ambiguity.

### 3.4 Better Separation of Concerns
Distinguishing between "config" (settings) and "data" (runtime state) at the directory level is a DDD best practice. Having all household configs in one place improves discoverability.

### 3.5 Simpler ConfigLoader
`loadHouseholdApps()` currently has a dual-mode scan (top-level YAMLs + subdirs with config.yml). A flat `config/` directory could simplify this to a single readdir.

---

## 4. Cons

### 4.1 Doesn't Solve the Full Problem
`finances/`, `journalist/`, `nutribot/`, and `homebot/` cannot be flattened to single YAML files. They need directory structures for runtime data. This means `apps/` can't be fully eliminated — or those apps need a different home (e.g., `household/data/<appname>/`).

### 4.2 Large Blast Radius in Code
The following code paths all reference `apps/` and would need updates:

| Component | Files Affected | Complexity |
|---|---|---|
| configLoader.mjs | 1 file, ~30 lines | Low — change `loadHouseholdApps` scan target |
| ConfigService.mjs | 1 file, 2-3 methods | Low — update `getHouseholdAppConfig`, deprecate `getHouseholdPath('apps/...')` |
| UserDataService.mjs | 1 file, `getHouseholdAppPath()` | Medium — must still support runtime data apps |
| app.mjs | 6+ callsites | Medium — cost, fitness, nutribot, journalist, homebot |
| YamlFinanceDatastore | 1 file | Medium — hardcoded `'apps/finances'` |
| YamlNutriCoachDatastore | 1 file | Low |
| YamlJournalDatastore | 1 file | Low |
| YamlSessionDatastore | 1 file (media paths) | Low — screenshots path is `apps/fitness/sessions/...` |
| fitness.mjs router | 1 file | Low |
| FitnessConfigService | 1 file | Low |
| calendar.mjs router | 1 file | Low |
| Test infrastructure | 3+ files (generators, harnesses, utils) | Medium |
| .gitignore | 1 file | Low |
| CLAUDE.md + configuration.md | 2 files | Low |
| 15+ docs references | Many files | Low (search-replace) |

**Total: ~20 source files, ~40 docs references**

### 4.3 Production Data Migration Required
This is not just a code change — it requires moving files on the production Dropbox mount:
- SSH into homeserver, `docker exec` into container
- Move files while the app is running (or stop it)
- Dropbox sync timing risk — partial states during sync
- No rollback mechanism if something goes wrong mid-migration

### 4.4 Two Deprecated Path Systems Still In Use
`ConfigService.getHouseholdPath()` is already deprecated but still has **7 production callers**. Adding another migration on top of the existing deprecation creates compounding technical debt transitions.

### 4.5 Media Path Hardcoding
`YamlSessionDatastore` hardcodes media paths as `apps/fitness/sessions/{date}/{id}/screenshots`. These media files are on a separate mount and would need their own migration (or the paths would become orphaned).

---

## 5. Blind Spots

### 5.1 Conversation State Data Destination Undefined
Where do `journalist/conversations/`, `nutribot/conversations/`, and `homebot/conversations/` go? Options:
- `household/data/journalist/conversations/` (new pattern)
- `household/history/journalist/` (follows fitness sessions pattern)
- `household/state/journalist/` (runtime state)
- Stay in `apps/` (defeats the purpose)

**No plan currently addresses this.**

### 5.2 Finance Data Destination Undefined
`finances/` has 12+ files including time-partitioned transaction data (`2024-04-01/`, `2025-04-01/`), archives, and mutable state. This is the most complex app data and has no clear target location.

### 5.3 Chatbots.yml Is Already a Top-Level YAML
`apps/chatbots.yml` is loaded as a top-level YAML file by `loadAppsFromDir`. It's not in a subdirectory — it would map cleanly to `config/chatbots.yml`, but the semantics differ from per-app configs like `fitness.yml`.

### 5.4 `getServiceConfig()` vs `getHouseholdAppConfig()` Confusion
System-level app configs exist in `data/system/apps/` and are loaded via `getServiceConfig()`. There's already a naming collision between "system app config" and "household app config." Merging household app config into `config/` may further blur this distinction.

### 5.5 Existing Plan Scope Mismatch
The `2026-01-31-household-config-directory.md` plan only covers devices/piano → `config/devices.yml`. It does not address fitness, finances, chatbots, harvesters, or bot conversation data. The current proposal goes significantly beyond that plan's scope.

### 5.6 Test Fixture Paths
Test infrastructure (`setup-household-demo.mjs`, `fitness-test-utils.mjs`) constructs paths like `household/apps/fitness/config.yml`. The test generator creates demo data in the `apps/` tree. All test infrastructure must be updated atomically with the production change.

### 5.7 Docker Volume Mount Implications
The Docker compose mounts the data directory. If the directory structure changes while the container is running, in-flight file operations could hit missing paths. The container would need a restart, and the entrypoint script may have assumptions about directory structure.

---

## 6. Impact Assessment (Blast Radius)

### 6.1 Severity by Component

| Component | Severity | Risk | Notes |
|---|---|---|---|
| Config loading (bootstrap) | 🟡 Medium | Low | Well-isolated, easy to test |
| ConfigService path resolution | 🟡 Medium | Medium | Deprecated methods still in use |
| UserDataService | 🟡 Medium | Medium | Must handle split (config vs data) |
| app.mjs wiring | 🔴 High | Medium | 6+ callsites, central nervous system |
| Datastore adapters | 🟡 Medium | Low | Clear path string changes |
| API routers | 🟢 Low | Low | Small, isolated changes |
| Frontend | 🟢 Low | Low | No direct path references (uses API) |
| Tests | 🟡 Medium | Medium | Generator, harness, fixture updates |
| Production data | 🔴 High | High | Live file move on Dropbox-synced mount |
| Media paths | 🟡 Medium | Medium | Screenshot paths in YamlSessionDatastore |
| Documentation | 🟢 Low | Low | Search-replace, many files |

### 6.2 Risk Summary

- **Code changes:** ~20 files, manageable with careful planning
- **Data migration:** High risk — live filesystem changes on production Dropbox mount
- **Rollback difficulty:** Medium-High — would need to move files back AND revert code
- **Partial failure modes:** Dropbox sync could leave the mount in an inconsistent state

---

## 7. Recommended Approach (If Go)

If you proceed, split this into a **phased migration** rather than a single big-bang:

### Phase 1: Config-Only Apps (Low Risk)
Move apps that have only `config.yml`:
- `apps/fitness/config.yml` → `config/fitness.yml`
- `apps/harvesters/shopping.yml` → `config/harvesters.yml` (or merge into another config)
- Delete `apps/devices/` and `apps/piano/` (already in `config/devices.yml`)

**Update:** configLoader to scan both `apps/` and `config/` with `config/` taking priority (backward compat).

### Phase 2: Bot Conversations (Medium Risk)
Move runtime state to a new `household/state/` or `household/data/` directory:
- `apps/journalist/conversations/` → `household/state/journalist/conversations/`
- `apps/nutribot/conversations/` → `household/state/nutribot/conversations/`
- `apps/homebot/conversations/` → `household/state/homebot/conversations/`

### Phase 3: Finances (High Risk)
Design a proper home for the complex finances data:
- `apps/finances/` → `household/data/finances/` (separate from config)
- Extract `budget.config.yml` → `config/finances.yml` (config only)

### Phase 4: Cleanup
- Remove empty `apps/` directory
- Remove deprecated `getHouseholdPath('apps/...')` callers
- Update all docs and CLAUDE.md config references

---

## 8. Go/No-Go Recommendation

### Verdict: **CONDITIONAL GO — Phase 1 Only**

**Rationale:**
- Phase 1 (config-only apps: fitness, devices, piano, chatbots, harvesters) is low risk, high value, and **already partially done** via the `2026-01-31` plan.
- The full proposal to eliminate `apps/` entirely is premature because the runtime-data apps (finances, bots) have no defined target location.
- Completing Phase 1 first establishes the pattern, then Phases 2-3 can be planned with domain-specific designs.

**Preconditions for Phase 1 Go:**
1. ✅ `config/` directory already exists with household.yml, integrations.yml, devices.yml
2. ⬜ Add backward-compatible dual-scan to configLoader (check `config/<app>.yml` first, fall back to `apps/<app>/config.yml`)
3. ⬜ Move fitness config.yml to `config/fitness.yml` on production mount
4. ⬜ Delete `apps/devices/` and `apps/piano/` (already duplicated)
5. ⬜ Update test infrastructure
6. ⬜ Verify with `npm test` before deploy

**Do NOT attempt full `apps/` elimination until Phases 2-3 are designed.**

---

## Appendix: File Inventory

### A. Apps with Config Only (Phase 1 candidates)

| Current Path | Proposed Path | Lines |
|---|---|---|
| `apps/fitness/config.yml` | `config/fitness.yml` | ~400 |
| `apps/devices/config.yml` | `config/devices.yml` (exists) | ~80 |
| `apps/piano/config.yml` | merged into `config/devices.yml` (exists) | ~10 |
| `apps/chatbots.yml` | `config/chatbots.yml` | ~10 |
| `apps/harvesters/shopping.yml` | `config/harvesters.yml` | ~10 |

### B. Apps with Runtime Data (Phases 2-3)

| Current Path | Contents | File Count |
|---|---|---|
| `apps/finances/` | Transactions, budgets, balances, archives | 12+ files |
| `apps/journalist/conversations/` | Telegram state | 1+ files |
| `apps/nutribot/conversations/` | Telegram state | 1+ files |

### C. Code References to Update (Phase 1)

| File | Method/Line | Change Needed |
|---|---|---|
| `configLoader.mjs:190` | `loadHouseholdApps()` | Dual-scan: config/ first, apps/ fallback |
| `ConfigService.mjs` | `getHouseholdAppConfig()` | No change (reads from in-memory tree) |
| `UserDataService.mjs:280` | `getHouseholdAppPath()` | Route config reads to `config/`, data reads to `apps/` |
| `app.mjs:473,697` | Fitness config loading | No change if configLoader handles it |
| `FitnessConfigService.mjs:21` | `readHouseholdAppData()` | May need update depending on UserDataService changes |
| `fitness.mjs:79` | Router config check | Update error message path string |
| `.gitignore:21-25` | apps/ rules | Add config/ rules |
| `setup-household-demo.mjs` | Test generator | Update output paths |

---

**Related code:**
- `backend/src/0_system/config/configLoader.mjs` — app loading
- `backend/src/0_system/config/ConfigService.mjs` — path resolution
- `backend/src/0_system/config/UserDataService.mjs` — data read/write
- `backend/src/app.mjs` — service wiring
- `docs/reference/core/configuration.md` — config system docs
