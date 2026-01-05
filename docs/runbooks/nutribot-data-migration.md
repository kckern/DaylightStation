# NutriBot Data Store Migration Plan

## Status: Phase 1 Complete ✅

**Completed on:** December 16, 2025

### What was done:
1. ✅ Updated `config.app.yml` - Added `telegram_bot_id` to users, new path templates
2. ✅ Updated `nutribot/config.yaml` - New `{username}` based storage paths
3. ✅ Created `_lib/users/UserResolver.mjs` - Resolves conversation IDs to usernames
4. ✅ Updated `NutriBotConfig.mjs` - Username resolution in path getters
5. ✅ Updated `api.mjs` - Wired UserResolver, new path configuration
6. ✅ Updated `FileConversationStateStore.mjs` - Supports username-based paths
7. ✅ Ran migration script - Data copied to new location
8. ✅ Verified data: `/data/lifelog/nutrition/{username}/`

### Next: Phase 2 - Testing & Deployment
- [ ] Restart dev server
- [ ] Test food logging flow
- [ ] Test report generation
- [ ] Deploy to production

---

## Overview

Migrate NutriBot data storage from bot/user ID-based paths to username-based paths under `/data/lifelog/nutrition/{username}/`.

### Current Structure
```
/data/journalist/nutribot/
├── nutrilogs/
│   └── b{botId}_u{chatId}.yaml        # e.g., b6898194425_u575596036.yaml
├── nutrilists/
│   └── b{botId}_u{chatId}.yaml
├── nutricursors/
│   └── b{botId}_u{chatId}.yaml        # Conversation state (pending logs, flow state)
├── nutridays/
│   └── b{botId}_u{chatId}.yaml        # Daily aggregates cache
├── nutricoach/
│   └── b{botId}_u{chatId}.yaml        # Coaching/tips state
├── images/
│   └── ...                            # Uploaded food photos
└── report_state_{chatId}.yaml         # Last report message ID
```

### Target Structure
```
/data/lifelog/nutrition/{username}/
├── nutrilog.yaml          # Individual meal logs (pending + accepted)
├── nutrilist.yaml         # Denormalized item list for reporting
├── nutricursor.yaml       # Conversation state (flow, pending UUIDs)
├── nutriday.yaml          # Daily aggregates cache
├── nutricoach.yaml        # Coaching/tips state
├── report_state.yaml      # Last report message ID
└── images/                # Uploaded food photos
    └── {date}/
        └── {uuid}.jpg
```

---

## Impact Analysis

### 1. Files Requiring Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `config.app.yml` | Config | Update path templates, add user lookup |
| `backend/chatbots/nutribot/config.yaml` | Config | Update storage.paths section |
| `backend/chatbots/nutribot/config/NutriBotConfig.mjs` | Code | Add username resolution, update path getters |
| `backend/chatbots/nutribot/repositories/NutriLogRepository.mjs` | Code | Use new path getter |
| `backend/chatbots/nutribot/repositories/NutriListRepository.mjs` | Code | Use new path getter |
| `backend/chatbots/infrastructure/persistence/FileConversationStateStore.mjs` | Code | Support username-based paths |
| `backend/chatbots/nutribot/container.mjs` | Code | Pass user resolver to repositories |
| `backend/chatbots/nutribot/application/usecases/*.mjs` | Code | Ensure userId flows through correctly |

### 2. User Resolution Flow

**Current:** `telegram:{botId}_{chatId}` → file path directly  
**New:** `telegram:{botId}_{chatId}` → lookup username → `/lifelog/nutrition/{username}/`

```
┌─────────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Telegram Message   │────▶│  User Resolver   │────▶│  Username: {username}  │
│  chatId: 575596036  │     │  (config lookup) │     │                    │
└─────────────────────┘     └──────────────────┘     └────────────────────┘
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │  /lifelog/nutrition/{username}/   │
                                              │  ├── nutrilog.yaml            │
                                              │  ├── nutrilist.yaml           │
                                              │  └── ...                      │
                                              └───────────────────────────────┘
```

### 3. Config Changes Required

#### config.app.yml (new section)
```yaml
chatbots:
  users:
    {username}:
      telegram_user_id: 575596036
      telegram_bot_id: 6898194425    # Add this for reverse lookup
      default_bot: nutribot
      goals:
        calories: 2000
        protein: 150
        carbs: 200
        fat: 65

  data:
    nutribot:
      # New path template using {username}
      basePath: lifelog/nutrition
      paths:
        nutrilog: "{username}/nutrilog"
        nutrilist: "{username}/nutrilist"
        nutricursor: "{username}/nutricursor"
        nutriday: "{username}/nutriday"
        nutricoach: "{username}/nutricoach"
        report_state: "{username}/report_state"
        images: "{username}/images"
```

### 4. Breaking Changes

| Component | Impact | Mitigation |
|-----------|--------|------------|
| Existing data files | Won't be found at new paths | Migration script |
| Report state file | Different location | Migration script |
| Conversation state | Different location | Will auto-recreate (ephemeral) |
| Image paths | Different structure | Migration script |
| CLI tool | Uses 'cli-user' fallback | Add CLI user mapping or default |

---

## Data Model Design

### UserResolver Service

New service to resolve platform IDs to usernames:

```javascript
// backend/chatbots/_lib/users/UserResolver.mjs

export class UserResolver {
  #usersByTelegram = new Map();  // telegram:{botId}_{chatId} -> username
  #usersByUsername = new Map();  // username -> config object

  constructor(config) {
    // Build lookup maps from config.chatbots.users
    for (const [username, userData] of Object.entries(config.chatbots.users)) {
      this.#usersByUsername.set(username, userData);
      
      const telegramKey = `telegram:${userData.telegram_bot_id}_${userData.telegram_user_id}`;
      this.#usersByTelegram.set(telegramKey, username);
    }
  }

  /**
   * Resolve a conversation ID to a username
   * @param {string} conversationId - e.g., "telegram:6898194425_575596036"
   * @returns {string|null} - e.g., "{username}"
   */
  resolveUsername(conversationId) {
    // Direct lookup
    if (this.#usersByTelegram.has(conversationId)) {
      return this.#usersByTelegram.get(conversationId);
    }
    
    // Try parsing and matching
    const match = conversationId.match(/telegram:(\d+)_(\d+)/);
    if (match) {
      const [, botId, chatId] = match;
      // Try with just chatId (for backwards compat)
      for (const [username, userData] of this.#usersByUsername) {
        if (String(userData.telegram_user_id) === chatId) {
          return username;
        }
      }
    }
    
    return null;
  }

  /**
   * Get user config by username
   */
  getUser(username) {
    return this.#usersByUsername.get(username);
  }
}
```

### Updated NutriBotConfig

```javascript
// backend/chatbots/nutribot/config/NutriBotConfig.mjs

class NutriBotConfig {
  #userResolver;
  
  constructor(config, userResolver) {
    this.#config = config;
    this.#userResolver = userResolver;
  }

  /**
   * Get storage path for a user
   * @param {string} pathType - 'nutrilog', 'nutrilist', etc.
   * @param {string} userId - Conversation ID or username
   */
  getStoragePath(pathType, userId) {
    // Resolve to username if needed
    const username = this.#resolveUsername(userId);
    if (!username) {
      throw new Error(`Cannot resolve username for: ${userId}`);
    }

    const basePath = this.#config.storage.basePath;
    const template = this.#config.storage.paths[pathType];
    
    return `${basePath}/${template.replace('{username}', username)}`;
  }

  #resolveUsername(userId) {
    // If already a username (no colons), return as-is
    if (!userId.includes(':') && !userId.includes('_')) {
      return userId;
    }
    
    // Try resolver
    return this.#userResolver?.resolveUsername(userId) || null;
  }

  // Convenience methods
  getNutrilogPath(userId) { return this.getStoragePath('nutrilog', userId); }
  getNutrilistPath(userId) { return this.getStoragePath('nutrilist', userId); }
  getNutricursorPath(userId) { return this.getStoragePath('nutricursor', userId); }
  getNutridayPath(userId) { return this.getStoragePath('nutriday', userId); }
}
```

### Repository Updates

Repositories need minimal changes - they already use `config.getNutrilogPath(userId)`:

```javascript
// Only change: ensure userId passed is the conversationId, 
// and config handles the resolution

async save(nutriLog) {
  // nutriLog.userId should be the conversationId (e.g., "telegram:6898194425_575596036")
  // Config will resolve this to username internally
  const path = this.#config.getNutrilogPath(nutriLog.userId);
  // ... rest unchanged
}
```

---

## Migration Guide

### Phase 1: Preparation

#### 1.1 Update Configuration

**config.app.yml:**
```yaml
chatbots:
  users:
    {username}:
      telegram_user_id: 575596036
      telegram_bot_id: 6898194425    # ADD THIS
      default_bot: nutribot
      goals:
        calories: 2000
        protein: 150
        carbs: 200
        fat: 65

  data:
    nutribot:
      basePath: lifelog/nutrition
      paths:
        nutrilog: "{username}/nutrilog"
        nutrilist: "{username}/nutrilist"
        nutricursor: "{username}/nutricursor"
        nutriday: "{username}/nutriday"
        nutricoach: "{username}/nutricoach"
        report_state: "{username}/report_state"
        images: "{username}/images"
```

**backend/chatbots/nutribot/config.yaml:**
```yaml
storage:
  basePath: "lifelog/nutrition"
  
  paths:
    nutrilog: "{username}/nutrilog"
    nutrilist: "{username}/nutrilist"
    nutricursor: "{username}/nutricursor"
    nutriday: "{username}/nutriday"
    nutricoach: "{username}/nutricoach"
    report_state: "{username}/report_state"
    images: "{username}/images"

  # Legacy support (for migration period)
  legacy:
    enabled: false  # Set to true during migration
    pattern: "journalist/nutribot/nutrilogs/b{botId}_u{chatId}.yaml"
```

#### 1.2 Create UserResolver

Create new file: `backend/chatbots/_lib/users/UserResolver.mjs`

#### 1.3 Update NutriBotConfig

Modify `backend/chatbots/nutribot/config/NutriBotConfig.mjs` to:
- Accept UserResolver in constructor
- Update all path getters to resolve username first

### Phase 2: Code Changes

#### 2.1 Files to Modify

1. **NutriBotConfig.mjs** - Username resolution
2. **NutriLogRepository.mjs** - No changes needed (uses config)
3. **NutriListRepository.mjs** - No changes needed (uses config)
4. **FileConversationStateStore.mjs** - Support username-based paths
5. **container.mjs** - Wire up UserResolver
6. **GenerateDailyReport.mjs** - Update report state path

#### 2.2 Test Coverage

Run existing tests to ensure:
- [ ] LogFoodFromText works
- [ ] AcceptFoodLog works
- [ ] GenerateDailyReport works
- [ ] Revision flow works

### Phase 3: Data Migration

#### 3.1 Migration Script

Create: `scripts/migrate-nutribot-data.mjs`

```javascript
#!/usr/bin/env node
/**
 * Migrate NutriBot data from old paths to new username-based paths
 * 
 * Old: /data/journalist/nutribot/{type}/b{botId}_u{chatId}.yaml
 * New: /data/lifelog/nutrition/{username}/{type}.yaml
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

const DATA_PATH = process.env.DATA_PATH || '/Volumes/mounts/DockerDrive/Docker/DaylightStation/data';

// User mappings from config
const USER_MAPPINGS = {
  'b6898194425_u575596036': '{username}',
  // Add more users as needed
};

const FILE_TYPES = [
  { old: 'nutrilogs', new: 'nutrilog' },
  { old: 'nutrilists', new: 'nutrilist' },
  { old: 'nutricursors', new: 'nutricursor' },
  { old: 'nutridays', new: 'nutriday' },
  { old: 'nutricoach', new: 'nutricoach' },
];

async function migrate() {
  console.log('Starting NutriBot data migration...');
  console.log(`Data path: ${DATA_PATH}`);

  for (const [oldKey, username] of Object.entries(USER_MAPPINGS)) {
    console.log(`\nMigrating user: ${oldKey} -> ${username}`);

    // Create target directory
    const targetDir = path.join(DATA_PATH, 'lifelog', 'nutrition', username);
    await fs.mkdir(targetDir, { recursive: true });

    for (const fileType of FILE_TYPES) {
      const oldPath = path.join(DATA_PATH, 'journalist', 'nutribot', fileType.old, `${oldKey}.yaml`);
      const newPath = path.join(targetDir, `${fileType.new}.yaml`);

      try {
        await fs.access(oldPath);
        console.log(`  Copying ${fileType.old} -> ${fileType.new}`);
        await fs.copyFile(oldPath, newPath);
      } catch (e) {
        console.log(`  Skipping ${fileType.old} (not found)`);
      }
    }

    // Migrate report_state
    const oldReportState = path.join(DATA_PATH, 'journalist', 'nutribot', `report_state_575596036.yaml`);
    const newReportState = path.join(targetDir, 'report_state.yaml');
    try {
      await fs.access(oldReportState);
      console.log(`  Copying report_state`);
      await fs.copyFile(oldReportState, newReportState);
    } catch (e) {
      console.log(`  Skipping report_state (not found)`);
    }

    // Migrate images
    const oldImages = path.join(DATA_PATH, 'journalist', 'nutribot', 'images');
    const newImages = path.join(targetDir, 'images');
    try {
      await fs.access(oldImages);
      console.log(`  Copying images directory`);
      await fs.cp(oldImages, newImages, { recursive: true });
    } catch (e) {
      console.log(`  Skipping images (not found)`);
    }
  }

  console.log('\nMigration complete!');
  console.log('\nNext steps:');
  console.log('1. Verify data in /data/lifelog/nutrition/{username}/');
  console.log('2. Update config.app.yml with new paths');
  console.log('3. Deploy code changes');
  console.log('4. Test functionality');
  console.log('5. Remove old data (after verification)');
}

migrate().catch(console.error);
```

#### 3.2 Run Migration

```bash
# Dry run (add --dry-run flag if implemented)
node scripts/migrate-nutribot-data.mjs

# Verify
ls -la /Volumes/mounts/DockerDrive/Docker/DaylightStation/data/lifelog/nutrition/{username}/
```

### Phase 4: Deployment

#### 4.1 Deployment Checklist

- [ ] Backup existing data
- [ ] Run migration script
- [ ] Verify migrated data
- [ ] Deploy code changes
- [ ] Restart services
- [ ] Test all flows:
  - [ ] Log food from text
  - [ ] Log food from photo
  - [ ] Accept/Revise/Discard
  - [ ] Generate report
  - [ ] Voice transcription
- [ ] Monitor logs for errors

#### 4.2 Rollback Plan

If issues occur:
1. Revert code changes
2. Old data is still in place (migration copies, doesn't move)
3. Restart services

### Phase 5: Cleanup

After 1 week of stable operation:

```bash
# Archive old data
tar -czvf nutribot-legacy-backup.tar.gz /data/journalist/nutribot/

# Remove old directories (after confirming backup)
rm -rf /data/journalist/nutribot/nutrilogs/
rm -rf /data/journalist/nutribot/nutrilists/
rm -rf /data/journalist/nutribot/nutricursors/
rm -rf /data/journalist/nutribot/nutridays/
rm -rf /data/journalist/nutribot/nutricoach/
```

---

## Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1 | 1 hour | Config updates |
| Phase 2 | 2-3 hours | Code changes |
| Phase 3 | 30 min | Data migration |
| Phase 4 | 1 hour | Deployment + testing |
| Phase 5 | 1 week later | Cleanup |

---

## Appendix: Current Data Sizes

```
/data/journalist/nutribot/nutrilogs/
  b6898194425_u575596036.yaml    ~739 KB (all meal logs since July)

/data/journalist/nutribot/nutrilists/
  b6898194425_u575596036.yaml    ~834 KB (denormalized item list)

/data/journalist/nutribot/nutridays/
  b6898194425_u575596036.yaml    ~42 KB (daily aggregates)
```

## Appendix: CLI User Handling

The CLI tool currently uses `'cli-user'` as a fallback. Options:

1. **Add CLI mapping** in config:
   ```yaml
   users:
     cli-user:
       telegram_user_id: null
       default_bot: nutribot
   ```

2. **Use {username} for CLI** (simpler):
   - CLI defaults to `{username}` username
   - Pass `--user={username}` flag

3. **Keep separate CLI data** (current behavior):
   - Add `cli-user` to user mappings
   - CLI data stays isolated
