# Fitness App Identifier Decision Tree

**Date:** 2026-01-03  
**Status:** Living Document  
**Purpose:** Guide developers on which identifier to use in different contexts

---

## Quick Reference

| Context | Use | Format | Example |
|---------|-----|--------|---------|
| Dictionary keys (Map/Object/Set) | **userId** | `string` | `"kckern"` |
| Timeline series keys | **userId** | `user:${userId}:${metric}` | `"user:kckern:coins"` |
| activeParticipants arrays | **userId** | `string[]` | `["kckern", "felix"]` |
| Display in UI | **name** | `string` | `"KC Kern"` |
| Legacy slug keys (deprecated) | ~~slug~~ | ~~`slugifyId(name)`~~ | ~~`"alan"`~~ |
| Session tracking (Phase 2) | ~~entityId~~ | ~~`entity-${timestamp}-${hash}`~~ | ~~(incomplete)~~ |

---

## Decision Tree

```
┌─────────────────────────────────────────┐
│ Need to identify a participant?        │
└───────────────┬─────────────────────────┘
                │
                ↓
┌─────────────────────────────────────────┐
│ Is this for UI display?                 │
└───────────────┬─────────────────────────┘
                │
       ┌────────┴────────┐
       │ Yes             │ No
       ↓                 ↓
┌──────────────┐   ┌──────────────────────┐
│ Use name     │   │ Is this a dictionary │
│ (display)    │   │ key or lookup?       │
└──────────────┘   └──────┬───────────────┘
                          │
                 ┌────────┴────────┐
                 │ Yes             │ No
                 ↓                 ↓
          ┌──────────────┐   ┌─────────────┐
          │ Use userId   │   │ Is this a   │
          │ (stable)     │   │ timeline    │
          └──────────────┘   │ series key? │
                             └──────┬──────┘
                                    │
                           ┌────────┴────────┐
                           │ Yes             │ No
                           ↓                 ↓
                    ┌──────────────┐   ┌─────────────┐
                    │ Use format:  │   │ Default to  │
                    │ user:${user  │   │ userId for  │
                    │ Id}:${metric}│   │ consistency │
                    └──────────────┘   └─────────────┘
```

---

## Use Case Examples

### ✅ Use userId

#### 1. Dictionary Keys

```javascript
// Map
const userZoneMap = {};
roster.forEach(entry => {
  const userId = entry.id || entry.profileId;
  userZoneMap[userId] = entry.zoneId;  // ← userId as key
});

// Set
const activeParticipants = new Set();
roster.forEach(entry => {
  if (entry.isActive) {
    activeParticipants.add(entry.id);  // ← userId in Set
  }
});

// Map (ES6)
const perUserData = new Map();
perUserData.set(entry.id, data);  // ← userId as Map key
```

#### 2. Timeline Series Keys

```javascript
// Writing metrics
assignMetric(`user:${userId}:coins_total`, 42);
assignMetric(`user:${userId}:heart_rate`, 150);

// Reading metrics
const series = timeline.series[`user:${userId}:coins_total`];
```

#### 3. activeParticipants Arrays

```javascript
// Building activeParticipants list
const activeParticipants = roster
  .filter(entry => entry.isActive !== false)
  .map(entry => entry.id || entry.profileId);  // ← userId
```

#### 4. Governance Inputs

```javascript
governanceEngine.evaluate({
  activeParticipants: ["kckern", "felix"],  // ← userIds
  userZoneMap: {
    "kckern": "hot",    // ← userId as key
    "felix": "warm"
  }
});
```

---

### ✅ Use name (Display Only)

#### 1. UI Rendering

```javascript
// Roster display
roster.map(entry => (
  <div key={entry.id}>
    <span>{entry.name}</span>  {/* ← name for display */}
    <span>{entry.zoneId}</span>
  </div>
));
```

#### 2. Logging (Supplemental)

```javascript
logger.info('participant_joined', {
  userId: entry.id,           // ← Primary identifier
  name: entry.name,           // ← For human readability
  zoneId: entry.zoneId
});
```

#### 3. User-Facing Messages

```javascript
showNotification(`${user.name} joined the session`);
```

**⚠️ NEVER use name as a dictionary key or lookup identifier**

---

### ❌ Do NOT Use

#### 1. ❌ Name as Dictionary Key

```javascript
// WRONG
userZoneMap[entry.name] = entry.zoneId;  // Case-sensitive, not unique

// CORRECT
userZoneMap[entry.id] = entry.zoneId;
```

#### 2. ❌ Slug (Deprecated)

```javascript
// WRONG (legacy pattern)
const key = slugifyId(entry.name);  // "Alan" → "alan"
userZoneMap[key] = entry.zoneId;

// CORRECT
userZoneMap[entry.id] = entry.zoneId;
```

#### 3. ❌ entityId (Phase 2 Incomplete)

```javascript
// WRONG (migration incomplete)
activeParticipants = roster.map(entry => entry.entityId);

// CORRECT (current standard)
activeParticipants = roster.map(entry => entry.id || entry.profileId);
```

---

## Migration Status

### Phase 1: slug → userId ✅ COMPLETE

**Status:** All critical paths migrated to userId

**Completed:**
- ✅ TreasureBox.perUser keys
- ✅ FitnessTimeline series keys
- ✅ GovernanceEngine inputs
- ✅ MetricsRecorder timeline keys
- ✅ DeviceAssignmentLedger tracking

**Verification:**
```bash
# Should return 0 results
grep -r "slugifyId" frontend/src/hooks/fitness/
```

---

### Phase 2: userId → entityId ⚠️ INCOMPLETE

**Status:** Infrastructure exists but migration paused

**Completed:**
- ✅ SessionEntity class created
- ✅ EntityId tracked in DeviceAssignmentLedger
- ✅ Roster entries include entityId field

**Incomplete:**
- ❌ TreasureBox still uses userId keys
- ❌ Timeline still uses `user:` prefix
- ❌ GovernanceEngine uses userId
- ❌ Chart queries use userId

**Decision Pending:** Complete Phase 2 or stabilize on Phase 1?

**If Phase 2 continues:**
1. Update TreasureBox to key by entityId
2. Dual-write timeline (`user:` and `entity:` keys)
3. Migrate all consumers to `entity:` keys
4. Remove `user:` keys after migration

**If Phase 2 abandoned:**
1. Remove SessionEntity infrastructure
2. Remove entityId tracking from ledger
3. Remove entityId field from roster entries
4. Stabilize on userId permanently

---

## Identifier Properties

### userId

**Format:** `string` (lowercase, alphanumeric + hyphens)

**Examples:**
- `"kckern"`
- `"felix"`
- `"milo"`
- `"guest-abc123"`

**Properties:**
- ✅ Stable (doesn't change)
- ✅ Unique (one per user)
- ✅ Lowercase (case-insensitive)
- ✅ Short (human-readable)
- ❌ Session-agnostic (can't track multiple participation instances)

**Use Cases:**
- Profile identity
- Timeline series keys
- Dictionary lookups
- Cross-session tracking

---

### name

**Format:** `string` (any case, may include spaces/special chars)

**Examples:**
- `"KC Kern"`
- `"Alan"`
- `"Bob Smith"`

**Properties:**
- ✅ Human-readable
- ✅ User-friendly display
- ❌ Case-sensitive (`"Alan"` ≠ `"alan"`)
- ❌ Not unique (multiple people can share names)
- ❌ Can change
- ❌ May have variants ("KC", "KC Kern", "K.C. Kern")

**Use Cases:**
- UI display ONLY
- Notifications
- Log messages (supplemental)

**⚠️ NEVER use as:**
- Dictionary keys
- Timeline series keys
- Lookup identifiers

---

### entityId (Phase 2 - Incomplete)

**Format:** `entity-${timestamp}-${hash}`

**Examples:**
- `"entity-1735689600000-abc123"`

**Properties:**
- ✅ Unique per session participation
- ✅ Tracks guest device reassignments
- ✅ Session audit trail
- ❌ Long (not human-readable)
- ❌ Session-specific (not useful for cross-session aggregation)
- ❌ Migration incomplete

**Intended Use Cases (if Phase 2 completes):**
- Track guest participation instances
- Session-specific metrics
- Device reassignment continuity

**Current Status:** Infrastructure exists but not fully utilized

---

## Code Snippets

### Getting userId from Roster Entry

```javascript
// Standard pattern
const userId = entry.id || entry.profileId;

// With null check
const userId = entry.id || entry.profileId;
if (!userId) {
  logger.warn('participant_missing_id', { entry });
  return;  // Skip this entry
}
```

### Building activeParticipants

```javascript
// Correct
const activeParticipants = roster
  .filter(entry => entry.isActive !== false && (entry.id || entry.profileId))
  .map(entry => entry.id || entry.profileId);

// Result: ["kckern", "felix", "milo"]
```

### Building userZoneMap

```javascript
// Correct
const userZoneMap = {};
roster.forEach(entry => {
  const userId = entry.id || entry.profileId;
  if (userId) {
    userZoneMap[userId] = entry.zoneId || null;
  }
});

// Result: { "kckern": "hot", "felix": "warm" }
```

### Timeline Key Generation

```javascript
// Correct
const key = `user:${userId}:${metric}`;
assignMetric(key, value);

// Examples
assignMetric(`user:kckern:coins_total`, 42);
assignMetric(`user:kckern:heart_rate`, 150);
```

---

## Troubleshooting

### Symptom: Governance detects 0 users

**Likely Cause:** Identifier mismatch between activeParticipants and userZoneMap

**Debug:**
```javascript
logger.info('governance_inputs', {
  activeParticipants,
  userZoneMapKeys: Object.keys(userZoneMap)
});
```

**Check:**
- Are activeParticipants using userId?
- Are userZoneMap keys using userId?
- Do they match exactly?

---

### Symptom: TreasureBox not tracking coins

**Likely Cause:** perUser Map keyed by wrong identifier

**Debug:**
```javascript
logger.info('treasurebox_state', {
  perUserKeys: Array.from(treasureBox.perUser.keys()),
  activeParticipants: Array.from(activeParticipants)
});
```

**Check:**
- Are perUser keys using userId?
- Are activeParticipants using userId?
- Do they match?

---

### Symptom: Timeline data missing

**Likely Cause:** Chart queries using wrong key format

**Debug:**
```javascript
const expectedKey = `user:${userId}:coins_total`;
const seriesExists = timeline.series.hasOwnProperty(expectedKey);

logger.info('timeline_lookup', {
  expectedKey,
  seriesExists,
  availableKeys: Object.keys(timeline.series).filter(k => k.includes('coins'))
});
```

**Check:**
- Is chart using `user:${userId}:metric` format?
- Is timeline writer using same format?
- Is userId consistent?

---

## Best Practices

### 1. Always Use userId for Lookups

```javascript
// ✅ GOOD
const zone = userZoneMap[userId];

// ❌ BAD
const zone = userZoneMap[userName];
```

### 2. Never Normalize userId

userId is already lowercase and stable. Don't add normalization:

```javascript
// ✅ GOOD
const userId = entry.id || entry.profileId;

// ❌ BAD (unnecessary)
const userId = (entry.id || entry.profileId).toLowerCase();
```

### 3. Filter Before Mapping

```javascript
// ✅ GOOD (filters out null/undefined)
roster
  .filter(e => e.id || e.profileId)
  .map(e => e.id || e.profileId)

// ❌ BAD (may include nulls)
roster
  .map(e => e.id || e.profileId)
  .filter(id => id)
```

### 4. Explicit Null Checks

```javascript
// ✅ GOOD (fails loudly)
if (!userId) {
  logger.error('missing_user_id', { entry });
  return;
}

// ❌ BAD (silent failure)
const userId = entry.id || entry.profileId || 'unknown';
```

---

## References

- [Fitness Data Flow](./fitness-data-flow.md)
- [Fitness Identifier Contract](./fitness-identifier-contract.md)
- [Postmortem: EntityId Migration](../postmortem-entityid-migration-fitnessapp.md)

---

**Document Owner:** DaylightStation Team  
**Last Updated:** 2026-01-03  
**Next Review:** After Phase 2 decision
