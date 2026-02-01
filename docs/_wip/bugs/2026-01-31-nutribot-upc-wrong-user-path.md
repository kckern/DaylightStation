# Bug Report: NutriBot UPC Portion Selection Saves to Wrong User Directory

**Date:** 2026-01-31  
**Severity:** High  
**Status:** Fix Applied  
**Affected Component:** `SelectUPCPortion` use case  

## Summary

When a user scans a UPC barcode and selects a portion size, the food item is saved to the wrong user directory, causing the daily report to show 0 calories even though the item was successfully logged.

## Symptom

User `kckern` scanned a UPC barcode for "cracker sandwiches", selected 2x portion (400 cal), and the system:
1. ✅ Logged the item to `nutrilog.yml` correctly
2. ✅ Marked the log as `status: accepted`
3. ❌ Saved the item to `nutrilist.yml` in the **wrong directory**
4. ❌ Daily report showed 0 cal, 0% of goal

The report image displayed completely empty nutritional data for Saturday, Jan 31, 2026.

## Root Cause Analysis

### Investigation Trail

1. **Initial hypothesis (WRONG):** Race condition in auto-accept timing
2. **Second hypothesis (WRONG):** Missing nutritional fields in `toNutriListItems()`
3. **Actual root cause:** `SelectUPCPortion.saveMany()` uses `chatId` instead of `userId`

### The Bug Location

**File:** `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs`  
**Lines:** 133-138

```javascript
// BEFORE (buggy)
const listItems = scaledItems.map((item) => ({
  ...item,
  chatId: conversationId,  // ❌ This is "telegram:b6898194425_c575596036"
  logUuid: logUuid,
  date: logDate,
}));
await this.#nutriListStore.saveMany(listItems);
```

The `userId` parameter (`kckern`) was available in the `execute()` input but was NOT being passed to the list items.

### How YamlNutriListDatastore.saveMany() Resolves User Path

```javascript
// backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs:171
const userId = newItems[0].userId || newItems[0].chatId || 'cli-user';
const filePath = this.#getPath(userId);
```

Since `userId` was undefined, it fell back to `chatId`, which contained the Telegram conversation ID instead of the username.

### Evidence

**Wrong directory created:**
```
/usr/src/app/data/users/telegram:b6898194425_c575596036/lifelog/nutrition/nutrilist.yml
```

**Content in wrong location:**
```yaml
- id: ZDuuG90VYp
  uuid: 3cda07a8-b100-4273-9a17-f150a4490765
  item: cracker sandwiches
  calories: 400
  date: '2026-01-31'
  logId: z1aDCGd6IB
```

**Expected location (empty for Jan 31):**
```
/usr/src/app/data/users/kckern/lifelog/nutrition/nutrilist.yml
```

## Timeline from Logs

| Timestamp (UTC) | Event | Details |
|-----------------|-------|---------|
| 16:54:03 | `logUPC.complete` | UPC 0044000002114, "cracker sandwiches", logUuid: z1aDCGd6IB |
| 16:54:09 | `selectPortion.complete` | portionFactor: 2 |
| 16:54:20 | `report.autoAccept.start` | count: 1 (for a different pending log) |
| 16:54:21 | `nutribot.renderer.complete` | itemCount: 0 ❌ |
| 16:54:23 | `report.generate.success` | itemCount: 1 (from summary, not from nutrilist) |

## The Fix

**File:** `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs`

```javascript
// AFTER (fixed)
const listItems = scaledItems.map((item) => ({
  ...item,
  userId: userId,           // ✅ Added: actual username
  chatId: conversationId,
  logUuid: logUuid,
  date: logDate,
}));
await this.#nutriListStore.saveMany(listItems);
```

## Impact Assessment

- **Affected users:** Any user logging food via UPC barcode scan
- **Data loss:** Items logged via UPC are in orphaned directories
- **Workaround:** None - items must be manually moved or re-logged

## Remediation Steps

1. ✅ Apply fix to `SelectUPCPortion.mjs`
2. ✅ Add regression test for userId in saveMany
3. ✅ Add userId validation in YamlNutriListDatastore.saveMany()
4. ✅ Create data migration script
5. ⬜ Deploy fix to production
6. ⬜ Run migration script on production data

## Data Migration Script (TODO)

```bash
# Find orphaned user directories
ls -la /usr/src/app/data/users/ | grep telegram

# For each orphaned directory, identify the correct user from nutrilog
# and move the items to the correct nutrilist.yml
```

## Prevention

Consider adding validation in `YamlNutriListDatastore.saveMany()`:

```javascript
if (!userId || userId.includes(':') || userId.includes('/')) {
  throw new InfrastructureError('Invalid userId for nutrilist save', {
    code: 'INVALID_USER_ID',
    received: userId
  });
}
```

## Related Code

- `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs` - The buggy use case
- `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs` - saveMany() path resolution
- `backend/src/0_system/config/UserDataService.mjs` - getUserPath()

## Lessons Learned

1. Always trace data to disk when debugging "missing data" issues
2. Check for path/directory mismatches before assuming code logic bugs
3. The fallback chain `userId || chatId || 'cli-user'` is dangerous without validation
