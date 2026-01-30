# Journalist Path Consolidation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate all journalist data into `users/{username}/lifelog/journalist/` and fix code to reference this canonical location.

**Architecture:** The journalist adapter currently has scattered data paths and unused config. We consolidate to a single user-scoped location, move prompts.yml into the canonical folder, and trash legacy files.

**Tech Stack:** Node.js (ESM), YAML, DDD architecture

---

## Summary of Changes

| Current Location | Action | New Location |
|------------------|--------|--------------|
| `users/kckern/lifelog/journalist/` | Keep (canonical) | - |
| `users/kckern/ai/journalist/prompts.yml` | Move | `users/kckern/lifelog/journalist/prompts.yml` |
| `_trash/chatbots/journalist/` | Already trash | Delete contents |
| `system/apps/journalist.yml` | Update | Fix `data_paths` to match reality |

---

### Task 1: Update journalist.yml Config to Match Reality

**Files:**
- Modify: `data/system/apps/journalist.yml`

**Step 1: Update the config file**

The current config has `data_paths.entries: lifelog/journalist/entries` which is unused. Update it to document the actual paths used:

```yaml
# =============================================================================
# Journalist Application Configuration
# =============================================================================
# Daily journaling and life logging bot configuration.
# Bot platform config (telegram bot_id, tokens) is in system/bots.yml
# =============================================================================

version: "1.0"

# -----------------------------------------------------------------------------
# Data Path Templates (relative to users/{username}/)
# -----------------------------------------------------------------------------
data_paths:
  root: lifelog/journalist
  messages: lifelog/journalist/messages.yml
  debriefs: lifelog/journalist/debriefs.yml
  prompts: lifelog/journalist/prompts.yml
  last_gpt: lifelog/journalist/last_gpt.yml

# -----------------------------------------------------------------------------
# Database Configuration
# -----------------------------------------------------------------------------
mysql:
  database: journalist
```

**Step 2: Verify the file was updated**

Run: `cat data/system/apps/journalist.yml`
Expected: Shows updated `data_paths` section with all paths

**Step 3: Commit**

```bash
git add data/system/apps/journalist.yml
git commit -m "$(cat <<'EOF'
docs: update journalist.yml to document actual data paths

The data_paths section now accurately reflects where journalist
data is stored under users/{username}/lifelog/journalist/.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Move prompts.yml to Canonical Location

**Files:**
- Move: `data/users/kckern/ai/journalist/prompts.yml` → `data/users/kckern/lifelog/journalist/prompts.yml`
- Trash: `data/users/kckern/ai/journalist/` (empty after move)

**Step 1: Copy prompts.yml to canonical location**

```bash
cp "data/users/kckern/ai/journalist/prompts.yml" "data/users/kckern/lifelog/journalist/prompts.yml"
```

**Step 2: Verify the copy**

Run: `head -20 data/users/kckern/lifelog/journalist/prompts.yml`
Expected: Shows the prompts file header with version "1.0"

**Step 3: Move old location to trash**

```bash
mkdir -p "data/_trash/ai-journalist-2026-01-29"
mv "data/users/kckern/ai/journalist" "data/_trash/ai-journalist-2026-01-29/"
```

**Step 4: Verify move**

Run: `ls -la data/users/kckern/ai/`
Expected: `journalist` directory no longer exists

Run: `ls -la data/_trash/ai-journalist-2026-01-29/`
Expected: Contains `journalist/` with `prompts.yml`

---

### Task 3: Clean Up Legacy Trash Files

**Files:**
- Delete: `data/_trash/chatbots/journalist/conversations/telegram_b580626020_c575596036.yml`
- Delete: `data/_trash/chatbots/journalist/` (empty directory)

**Step 1: Verify contents before deletion**

```bash
ls -la "data/_trash/chatbots/journalist/conversations/"
```

Expected: Shows `telegram_b580626020_c575596036.yml`

**Step 2: Remove the legacy conversation file**

```bash
rm -f "data/_trash/chatbots/journalist/conversations/telegram_b580626020_c575596036.yml"
```

**Step 3: Remove empty directories**

```bash
rmdir "data/_trash/chatbots/journalist/conversations" 2>/dev/null || true
rmdir "data/_trash/chatbots/journalist" 2>/dev/null || true
rmdir "data/_trash/chatbots" 2>/dev/null || true
```

**Step 4: Verify cleanup**

Run: `ls -la data/_trash/chatbots/ 2>/dev/null || echo "Directory removed"`
Expected: "Directory removed" or empty

---

### Task 4: Wire Up LoggingAIGateway Factory in Bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:1583-1595`

**Step 1: Read current code section**

Verify the current JournalistContainer instantiation around line 1583.

**Step 2: Add loggingAIGatewayFactory to the container options**

Find this code block:

```javascript
  // Create journalist container with all dependencies
  const journalistContainer = new JournalistContainer(journalistConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    journalEntryRepository,
    messageQueueRepository,
    conversationStateStore,
    quizRepository,
    userResolver,
    userDataService,
    debriefRepository,
    logger
  });
```

Add the factory function:

```javascript
  // Create journalist container with all dependencies
  const journalistContainer = new JournalistContainer(journalistConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    journalEntryRepository,
    messageQueueRepository,
    conversationStateStore,
    quizRepository,
    userResolver,
    userDataService,
    debriefRepository,
    loggingAIGatewayFactory: (deps) => new LoggingAIGateway({
      ...deps,
      saveFile: (relativePath, data) => {
        // Save relative to user's lifelog/journalist directory
        const fullPath = `users/${deps.username}/lifelog/${relativePath}`;
        userDataService.writeData?.(fullPath, data);
      }
    }),
    logger
  });
```

**Step 3: Add import for LoggingAIGateway**

Verify import exists at top of file (around line 102):

```javascript
import { LoggingAIGateway } from '#adapters/journalist/LoggingAIGateway.mjs';
```

If not present, it's already imported via DebriefRepository import block - add it:

```javascript
import { DebriefRepository, LoggingAIGateway } from '#adapters/journalist/index.mjs';
```

**Step 4: Run tests to verify no breakage**

Run: `npm test -- --grep journalist`
Expected: Tests pass (or no journalist-specific tests exist yet)

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "$(cat <<'EOF'
feat: wire LoggingAIGateway factory for journalist AI logging

Enables last_gpt.yml logging to users/{username}/lifelog/journalist/
for debugging AI interactions in the journalist bot.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Fix LoggingAIGateway Path to Use Correct Location

**Files:**
- Modify: `backend/src/2_adapters/journalist/LoggingAIGateway.mjs:88`

**Step 1: Read current code**

Current line 88:
```javascript
this.#saveFile(`journalist/last_gpt.yml`, logEntry);
```

**Step 2: Update path to be relative to lifelog directory**

Change to:
```javascript
this.#saveFile(`journalist/last_gpt.yml`, logEntry);
```

Actually, the path is already correct - the factory in Task 4 prepends `users/{username}/lifelog/` to make the full path `users/{username}/lifelog/journalist/last_gpt.yml`.

**Step 3: Verify path logic is correct**

No code change needed - the factory handles path construction.

---

### Task 6: Verify Final State

**Step 1: List canonical journalist directory**

```bash
ls -la data/users/kckern/lifelog/journalist/
```

Expected output should show:
- `messages.yml`
- `debriefs.yml`
- `last_gpt.yml`
- `prompts.yml` (newly moved)

**Step 2: Verify no journalist data outside canonical location**

```bash
find data/users/kckern -name "*.yml" -path "*journalist*" | grep -v lifelog
```

Expected: No output (all journalist yml files are in lifelog path)

**Step 3: Verify trash contains only archived data**

```bash
ls -la data/_trash/ | grep journalist
```

Expected: Only `ai-journalist-2026-01-29/` directory (the archived prompts backup)

---

## Post-Implementation Notes

1. **Prompts.yml is not currently loaded by code** - The prompts file exists but the journalist adapter doesn't have code to load user-specific prompts yet. This is a future enhancement.

2. **last_gpt.yml logging** - After Task 4, new AI interactions will be logged. Existing stale file will be overwritten on next use.

3. **No database migration needed** - All changes are filesystem-based YAML files.
