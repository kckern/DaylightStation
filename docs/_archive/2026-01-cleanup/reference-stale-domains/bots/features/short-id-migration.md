# Short ID Migration Design

## Overview

Replace 36-character UUIDs with 10-character YouTube-style short IDs to enable JSON-encoded Telegram callback data within the 64-byte limit.

## Problem Statement

Current callback format with UUIDs:
```
adj_factor_0.25_18835f8e-2fa6-4d1a-ba74-e09720cebfaa  (52 chars)
```

Desired JSON format with UUIDs:
```json
{"a":"f","f":0.25,"id":"18835f8e-2fa6-4d1a-ba74-e09720cebfaa"}  (65 chars) ❌ EXCEEDS LIMIT
```

With 10-char short IDs:
```json
{"a":"f","f":0.25,"id":"Xk9mZ2pLqN"}  (38 chars) ✅ FITS
```

## Short ID Specification

- **Length**: 10 characters
- **Charset**: Base62 (a-z, A-Z, 0-9)
- **Entropy**: 62^10 = ~839 quadrillion unique IDs
- **Collision probability**: Negligible for food logging scale
- **Format**: URL-safe, no special characters

### Generator Function

```javascript
// backend/chatbots/_lib/shortId.mjs
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function shortId(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map(b => CHARSET[b % CHARSET.length])
    .join('');
}

// Deterministic from UUID (for migration)
export function shortIdFromUuid(uuid) {
  const hash = crypto.createHash('sha256').update(uuid).digest();
  return Array.from(hash.slice(0, 10))
    .map(b => CHARSET[b % CHARSET.length])
    .join('');
}
```

## Callback JSON Schema

### Actions Reference

| Action | Short Key | Parameters |
|--------|-----------|------------|
| `adj_factor` | `f` | `f` (factor), `id` (itemId) |
| `adj_delete` | `d` | `id` (itemId) |
| `adj_move` | `m` | `id` (itemId) |
| `adj_item` | `i` | `id` (itemId) |
| `adj_date` | `dt` | `d` (daysAgo) |
| `adj_page` | `pg` | `d` (daysAgo), `o` (offset) |
| `adj_back_date` | `bd` | - |
| `adj_back_items` | `bi` | - |
| `adj_done` | `dn` | - |
| `portion` | `p` | `id` (logId), `f` (factor) |
| `accept` | `a` | `id` (logId) |
| `discard` | `x` | `id` (logId) |
| `revise` | `r` | `id` (logId) |
| `report_adjust` | `ra` | - |
| `report_accept` | `rx` | - |

### Encoder/Decoder

```javascript
// backend/chatbots/_lib/callback.mjs

export function encodeCallback(action, params = {}) {
  const obj = { a: action, ...params };
  return JSON.stringify(obj);
}

export function decodeCallback(data) {
  try {
    if (data.startsWith('{')) {
      return JSON.parse(data);
    }
    // Legacy string format fallback
    return { legacy: true, raw: data };
  } catch {
    return { legacy: true, raw: data };
  }
}
```

## Data Schema Changes

### FoodItem (domain entity)

```diff
  constructor(props) {
-   this.#id = data.id;                    // UUID (36 chars)
+   this.#id = data.id;                    // Short ID (10 chars)
+   this.#uuid = data.uuid;                // Full UUID (kept for data integrity)
  }
```

### NutriLog (domain entity)

```diff
  constructor(props) {
-   this.#id = data.id;                    // UUID
+   this.#id = data.id;                    // Short ID
+   this.#uuid = data.uuid;                // Full UUID (migration compat)
  }
```

### nutrilist.yml

```diff
- - uuid: 18835f8e-2fa6-4d1a-ba74-e09720cebfaa
+ - id: Xk9mZ2pLqN
+   uuid: 18835f8e-2fa6-4d1a-ba74-e09720cebfaa
    icon: bread
    item: Toast
    ...
-   log_uuid: 4fddd243-4396-4d3e-b488-a4e56a84bb52
+   logId: Yk3nW5qMrP
+   log_uuid: 4fddd243-4396-4d3e-b488-a4e56a84bb52
```

### nutrilog.yml

```diff
- 337c9ec4-3afd-48f2-9960-1c4662b0f1f5:
+ Xk9mZ2pLqN:
+   id: Xk9mZ2pLqN
    uuid: 337c9ec4-3afd-48f2-9960-1c4662b0f1f5
    ...
    food:
-     - icon: oatmeal
+     - id: Yk3nW5qMrP
+       icon: oatmeal
        item: Oatmeal
        ...
```

## Files to Modify

### 1. New Utility Files

| File | Purpose |
|------|---------|
| `backend/chatbots/_lib/shortId.mjs` | Short ID generator |
| `backend/chatbots/_lib/callback.mjs` | JSON callback encoder/decoder |
| `scripts/migrate-to-short-ids.mjs` | Migration script |

### 2. Domain Layer

| File | Changes |
|------|---------|
| `bots/nutribot/domain/FoodItem.mjs` | Add `uuid` field, use `shortId()` for `id` |
| `bots/nutribot/domain/NutriLog.mjs` | Add `uuid` field, use `shortId()` for `id` |
| `bots/nutribot/domain/schemas.mjs` | Update validation for both ID types |

### 3. Use Cases (Callback Builders)

| File | Changes |
|------|---------|
| `usecases/SelectItemForAdjustment.mjs` | Use `encodeCallback()` for keyboard |
| `usecases/SelectDateForAdjustment.mjs` | Use `encodeCallback()` for keyboard |
| `usecases/StartAdjustmentFlow.mjs` | Use `encodeCallback()` for keyboard |
| `usecases/LogFoodFromUPC.mjs` | Use `encodeCallback()` for portion buttons |
| `usecases/DeleteListItem.mjs` | Use `encodeCallback()` for follow-up buttons |
| `usecases/ApplyPortionAdjustment.mjs` | Use `encodeCallback()` for follow-up buttons |
| `usecases/GenerateDailyReport.mjs` | Use `encodeCallback()` for report buttons |

### 4. Router

| File | Changes |
|------|---------|
| `application/routing/UnifiedEventRouter.mjs` | Use `decodeCallback()`, handle both formats |

### 5. Repositories

| File | Changes |
|------|---------|
| `repositories/NutriLogRepository.mjs` | Support lookup by `id` or `uuid` |
| `repositories/NutriListRepository.mjs` | Support lookup by `id` or `uuid` |

## Migration Script Design

### Script: `scripts/migrate-to-short-ids.mjs`

```javascript
#!/usr/bin/env node
/**
 * Migrate nutrilog and nutrilist from UUIDs to short IDs
 * 
 * Usage: node scripts/migrate-to-short-ids.mjs --user {username} [--dry-run]
 */

import { shortIdFromUuid } from '../backend/chatbots/_lib/shortId.mjs';
import yaml from 'js-yaml';
import fs from 'fs';

async function migrate(username, dryRun = false) {
  const basePath = `/path/to/data/users/${username}/lifelog/nutrition`;
  
  // 1. Build UUID -> shortId mapping
  const idMap = new Map();
  
  // 2. Process nutrilog.yml
  const nutrilogPath = `${basePath}/nutrilog.yml`;
  const nutrilog = yaml.load(fs.readFileSync(nutrilogPath, 'utf8')) || {};
  
  const newNutrilog = {};
  for (const [uuid, entry] of Object.entries(nutrilog)) {
    const shortId = shortIdFromUuid(uuid);
    idMap.set(uuid, shortId);
    
    // Process food items within each log
    if (entry.food_data?.food) {
      entry.food_data.food = entry.food_data.food.map(item => {
        const itemUuid = item.uuid || item.id;
        const itemShortId = itemUuid ? shortIdFromUuid(itemUuid) : shortIdFromUuid(crypto.randomUUID());
        idMap.set(itemUuid, itemShortId);
        return {
          id: itemShortId,
          uuid: itemUuid,
          ...item,
        };
      });
    }
    
    newNutrilog[shortId] = {
      id: shortId,
      uuid,
      ...entry,
    };
  }
  
  // 3. Process nutrilist.yml
  const nutrilistPath = `${basePath}/nutrilist.yml`;
  const nutrilist = yaml.load(fs.readFileSync(nutrilistPath, 'utf8')) || [];
  
  const newNutrilist = nutrilist.map(item => {
    const itemUuid = item.uuid || item.id;
    const logUuid = item.log_uuid || item.logId;
    
    return {
      id: idMap.get(itemUuid) || shortIdFromUuid(itemUuid || crypto.randomUUID()),
      uuid: itemUuid,
      logId: idMap.get(logUuid) || (logUuid ? shortIdFromUuid(logUuid) : null),
      log_uuid: logUuid,
      ...item,
    };
  });
  
  // 4. Write or preview
  if (dryRun) {
    console.log('=== DRY RUN ===');
    console.log('ID Mappings:', Object.fromEntries([...idMap.entries()].slice(0, 10)));
    console.log('Sample nutrilog entry:', Object.values(newNutrilog)[0]);
    console.log('Sample nutrilist entry:', newNutrilist[0]);
  } else {
    // Backup originals
    fs.copyFileSync(nutrilogPath, `${nutrilogPath}.bak`);
    fs.copyFileSync(nutrilistPath, `${nutrilistPath}.bak`);
    
    // Write new files
    fs.writeFileSync(nutrilogPath, yaml.dump(newNutrilog));
    fs.writeFileSync(nutrilistPath, yaml.dump(newNutrilist));
    
    console.log(`Migrated ${Object.keys(newNutrilog).length} logs`);
    console.log(`Migrated ${newNutrilist.length} list items`);
  }
}
```

## Backward Compatibility

### Transition Period

1. **Dual lookup**: Repositories accept both `id` (short) and `uuid` (full)
2. **Dual callback parsing**: Router handles both JSON and legacy string formats
3. **Gradual migration**: New entries use short IDs, old entries work with UUIDs

### Repository Pattern

```javascript
async findById(userId, idOrUuid) {
  // Try short ID first (new format)
  if (idOrUuid.length === 10) {
    const result = this.#data[idOrUuid];
    if (result) return result;
  }
  
  // Fall back to UUID lookup (legacy)
  for (const [key, entry] of Object.entries(this.#data)) {
    if (entry.uuid === idOrUuid) return entry;
  }
  
  return null;
}
```

## Implementation Order

1. **Phase 1: Utilities** (no breaking changes)
   - Create `shortId.mjs`
   - Create `callback.mjs`
   - Add tests

2. **Phase 2: Domain Layer** (additive)
   - Add `uuid` field to FoodItem
   - Add `uuid` field to NutriLog
   - Update schemas to accept both

3. **Phase 3: Repositories** (additive)
   - Add dual-lookup support
   - Add short ID generation on create

4. **Phase 4: Callbacks** (breaking - deploy together)
   - Update all keyboard builders to use `encodeCallback()`
   - Update router to use `decodeCallback()`
   - Support legacy fallback

5. **Phase 5: Migration**
   - Run migration script for `{username}`
   - Verify data integrity
   - Monitor for errors

6. **Phase 6: Cleanup** (optional, later)
   - Remove legacy callback parsing
   - Remove UUID-based lookups
   - Archive migration script

## Testing Plan

1. **Unit tests**: shortId generator, callback encoder/decoder
2. **Integration tests**: Create/read items with new ID format
3. **Migration test**: Run on copy of production data, verify counts match
4. **E2E test**: Full adjustment flow with new JSON callbacks

## Rollback Plan

1. Restore from `.bak` files if migration fails
2. Revert code changes (repositories still support UUID lookup)
3. Legacy callback format still works as fallback
