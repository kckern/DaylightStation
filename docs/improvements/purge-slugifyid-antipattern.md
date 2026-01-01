# Purge `slugifyId` Anti-Pattern

## Summary

`slugifyId` is a runtime string transformation function that converts display names into URL-safe slugs. It is **100% anti-pattern** because:

1. **Every user/participant already has a proper `id` field** (e.g., `kckern`, `guest-12345`)
2. **Slugifying names at runtime creates identity mismatches** when names contain special characters or change
3. **It duplicates logic everywhere** - the function is copy-pasted into 8+ files
4. **It masks bugs** by silently "fixing" mismatched identifiers instead of failing loudly

### The Correct Approach

User objects always have:
- `id`: The canonical identifier (e.g., `kckern` from `profile.yml`, or `guest-{timestamp}` for guests)
- `name`: Display name (e.g., "KC Kern")
- `profileId`: Sometimes used interchangeably with `id`

**Never derive identity from display names. Always use the `id` field.**

---

## Usage Inventory

### Definition Sites (DELETE THESE)

| File | Line | Action |
|------|------|--------|
| [frontend/src/hooks/fitness/types.js](frontend/src/hooks/fitness/types.js#L1-L9) | 1-9 | Remove export, mark deprecated |
| [frontend/src/modules/Fitness/SidebarFooter.jsx](frontend/src/modules/Fitness/SidebarFooter.jsx#L7) | 7 | Delete local definition |
| [frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L14) | 14 | Delete local definition |
| [frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L7) | 7 | Delete local definition |
| [frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L10) | 10 | Delete local definition |
| [frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js](frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js#L19) | 19 | Delete local definition |
| [frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx](frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L27) | 27 | Delete local definition |
| [frontend/src/hooks/fitness/TreasureBox.js](frontend/src/hooks/fitness/TreasureBox.js#L4) | 4 | Delete local definition |

---

## Replacement Strategy by Category

### 1. User Identity Resolution (HIGH PRIORITY)

These usages attempt to derive a user ID from a name. **Replace with direct `id` access.**

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L6) | 6 | `this.id = configuredId ? String(configuredId) : slugifyId(name);` | `this.id = configuredId ?? throw new Error('User id is required');` |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L218) | 218 | `userId: this.id \|\| slugifyId(this.name)` | `userId: this.id` (id is always set in constructor) |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L279) | 279 | `const userId = config.id \|\| config.profileId \|\| slugifyId(config.name);` | `const userId = config.id \|\| config.profileId; if (!userId) throw new Error('config.id required');` |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L331) | 331 | `return this.users.get(id) \|\| this.users.get(slugifyId(id));` | `return this.users.get(id);` (callers must use canonical id) |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L479) | 479 | `const userId = profileId \|\| slugifyId(name);` | `const userId = profileId; if (!userId) throw new Error('profileId required');` |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L516) | 516 | `slug: slugifyId(user.name)` | Remove `slug` field entirely, use `id` |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L597) | 597 | `profiles.set(slugifyId(user.name), {...})` | `profiles.set(user.id, {...})` |

### 2. Device Identity Resolution

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [DeviceManager.js](frontend/src/hooks/fitness/DeviceManager.js#L5) | 5 | `this.id = slugifyId(data.id \|\| data.deviceId \|\| ...);` | `this.id = data.id \|\| data.deviceId; if (!this.id) throw new Error('Device id required');` |
| [DeviceManager.js](frontend/src/hooks/fitness/DeviceManager.js#L129) | 129 | `const id = slugifyId(deviceId);` | `const id = deviceId;` |
| [DeviceManager.js](frontend/src/hooks/fitness/DeviceManager.js#L167) | 167 | `const id = slugifyId(data.id \|\| data.deviceId);` | `const id = data.id \|\| data.deviceId;` |
| [DeviceManager.js](frontend/src/hooks/fitness/DeviceManager.js#L185) | 185 | `const id = slugifyId(deviceId);` | `const id = deviceId;` |
| [DeviceManager.js](frontend/src/hooks/fitness/DeviceManager.js#L191) | 191 | `return this.devices.get(slugifyId(id));` | `return this.devices.get(id);` |

### 3. Participant Roster / Session Lookups

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L119) | 119 | `const slug = slugifyId(entry.name);` | `const id = entry.id \|\| entry.profileId;` |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L136) | 136 | `const slug = slugifyId(entry.name);` | `const id = entry.id;` |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L150) | 150 | `const slug = slugifyId(entry.name);` | `const id = entry.id;` |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L164) | 164 | `const slug = slugifyId(entry.name);` | `const id = entry.id;` |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L214-216) | 214-216 | Slug-based lookup | Use `entry.id` directly |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L234) | 234 | `const key = slugifyId(entry.user);` | `const key = entry.userId \|\| entry.user;` |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js#L260-261) | 260-261 | Dual slug/id lookup | Use `mappedUser.id` only |

### 4. FitnessSession Lookups

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L107) | 107 | `const slug = slugifyId(name \|\| entry.profileId \|\| ...);` | `const id = entry.profileId \|\| entry.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L452) | 452 | `const resolvedSlug = user ? slugifyId(user.name) : null;` | `const resolvedId = user?.id ?? null;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L703) | 703 | `const key = slugifyId(entry.user);` | `const key = entry.userId;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L721) | 721 | `const key = slugifyId(participantName);` | `const key = participant.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L814-815) | 814-815 | Slug fallback chain | Use explicit `id` fields |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L947) | 947 | `const slug = slugifyId(user.name);` | `const id = user.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1067) | 1067 | `const slug = slugifyId(user.name);` | `const id = user.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1123) | 1123 | `const deviceId = slugifyId(device.id \|\| ...);` | `const deviceId = device.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1131) | 1131 | `const slug = slugifyId(mappedUser.name);` | `const id = mappedUser.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1183) | 1183 | `const slug = slugifyId(mappedUser.name);` | `const id = mappedUser.id;` |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1324) | 1324 | `this.treasureBox.processTick(..., { slugifyId });` | Pass `userId` directly from user objects |
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1356) | 1356 | `const slug = slugifyId(userName);` | `const id = user.id;` |

### 5. FitnessContext Provider

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L324) | 324 | `const slug = slugifyId(entry.name);` | `const id = entry.id \|\| entry.profileId;` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L349) | 349 | `const slug = slugifyId(entry.name);` | `const id = entry.id;` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L481) | 481 | `const slugId = slugifyId(deviceId);` | `const id = deviceId;` (already an ID) |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L923) | 923 | `const slug = slugifyId(name);` | Use `user.id` from caller |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1071) | 1071 | `const id = config.id \|\| slugifyId(config.name);` | `const id = config.id; if (!id) throw new Error('config.id required');` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1077) | 1077 | `profileId: config.id \|\| slugifyId(config.name)` | `profileId: config.id` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1121) | 1121 | `const key = slugifyId(user.name);` | `const key = user.id;` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1200) | 1200 | `const nameKey = slugifyId(profile.name);` | `const key = profile.id;` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1211) | 1211 | `const slug = slugifyId(identifier);` | Pass `id` not `identifier` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1228) | 1228 | `const slug = slugifyId(name);` | Use `user.id` |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1401) | 1401 | `slugifyId(rawId) \|\| String(rawId)...` | `rawId` (already an ID) |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L1656) | 1656 | `const slug = slugifyId(name);` | Use `user.id` |

### 6. Zone Configuration (DIFFERENT CASE)

These usages normalize zone IDs, not user IDs. Zone IDs are static configuration (e.g., "cool", "active", "warm"). **Consider keeping a simpler `normalizeZoneId()` function for these.**

| File | Line | Notes |
|------|------|-------|
| [types.js](frontend/src/hooks/fitness/types.js#L98) | 98 | Zone override key normalization |
| [types.js](frontend/src/hooks/fitness/types.js#L176) | 176 | Zone ID from zone config |
| [types.js](frontend/src/hooks/fitness/types.js#L204) | 204 | Current zone ID derivation |
| [types.js](frontend/src/hooks/fitness/types.js#L299) | 299 | Target zone ID lookup |
| [types.js](frontend/src/hooks/fitness/types.js#L302) | 302 | Zone sequence matching |
| [types.js](frontend/src/hooks/fitness/types.js#L383-384) | 383-384 | Zone threshold lookup |

**Replacement:** Create a dedicated `normalizeZoneId(zoneId)` that only handles zone configuration strings (which are known, finite values like "cool", "active", etc.).

### 7. Guest Assignment / Ledger

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [GuestAssignmentService.js](frontend/src/hooks/fitness/GuestAssignmentService.js#L87) | 87 | `const occupantSlug = slugifyId(value.name);` | Use `value.id` or generate `guest-{timestamp}` |
| [DeviceAssignmentLedger.js](frontend/src/hooks/fitness/DeviceAssignmentLedger.js#L144) | 144 | `const occupantSlug = slugifyId(occupantName);` | Use explicit `occupantId` parameter |
| [DeviceAssignmentLedger.js](frontend/src/hooks/fitness/DeviceAssignmentLedger.js#L146) | 146 | `const displacedSlug = baseUserName ? slugifyId(baseUserName) : null;` | Use `baseUserId` |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L366) | 366 | `const displacedSlug = ... slugifyId(...)` | Use `baseUser.id` |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js#L370) | 370 | `occupantSlug: slugifyId(guestName)` | Generate `guest-{Date.now()}` as ID |

### 8. Metrics / Zone Profile Stores

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [MetricsRecorder.js](frontend/src/hooks/fitness/MetricsRecorder.js#L158) | 158 | `const deviceId = slugifyId(device.id \|\| ...);` | `const deviceId = device.id;` |
| [MetricsRecorder.js](frontend/src/hooks/fitness/MetricsRecorder.js#L199) | 199 | `const slug = slugifyId(mappedUser.name);` | `const id = mappedUser.id;` |
| [MetricsRecorder.js](frontend/src/hooks/fitness/MetricsRecorder.js#L260) | 260 | `const slug = slugifyId(userName);` | Use `user.id` |
| [MetricsRecorder.js](frontend/src/hooks/fitness/MetricsRecorder.js#L312) | 312 | `const slug = slugifyId(user.name);` | `const id = user.id;` |
| [ZoneProfileStore.js](frontend/src/hooks/fitness/ZoneProfileStore.js#L115) | 115 | `const slug = slugifyId(identifier);` | Use `user.id` |
| [ZoneProfileStore.js](frontend/src/hooks/fitness/ZoneProfileStore.js#L127) | 127 | `const slug = slugifyId(user.name);` | `const id = user.id;` |
| [useDeviceAssignments.js](frontend/src/hooks/useDeviceAssignments.js#L31) | 31 | `occupantSlug: entry.occupantSlug \|\| slugifyId(occupantName)` | `occupantId: entry.occupantId` |

### 9. UI Components

| File | Line | Current Code | Replacement |
|------|------|--------------|-------------|
| [FitnessSidebar.jsx](frontend/src/modules/Fitness/FitnessSidebar.jsx#L71) | 71 | `const id = match.id \|\| slugifyId(match.name);` | `const id = match.id;` |
| [FitnessSidebar.jsx](frontend/src/modules/Fitness/FitnessSidebar.jsx#L87) | 87 | `const id = candidate.id \|\| slugifyId(candidate.name);` | `const id = candidate.id;` |
| [FitnessPlayerOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L418) | 418 | `(preferredName ? slugifyId(preferredName) : null)` | Use `participant.id` |
| [FitnessPlayerOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L479) | 479 | `id: zoneId \|\| slugifyId(zoneLabel)` | Use `zoneId` (zone config, see zone section) |
| [FitnessPlayerOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L525) | 525 | `/media/img/users/${slugifyId(canonicalName)}` | `/media/img/users/${user.id}` |
| [FitnessPlayerOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L676) | 676 | `id: zoneId \|\| slugifyId(requirement.zoneLabel)` | Use `zoneId` |
| [FitnessPlayerOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L704) | 704 | `(name ? slugifyId(name) : 'user')` | Use `participant.id` |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L233) | 233 | `const nameKey = slugifyId(profile.name);` | `const key = profile.id;` |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L244) | 244 | `const slug = slugifyId(name);` | Use `user.id` |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L324) | 324 | `slugifyId(assignment.occupantName \|\| ...)` | Use `assignment.occupantId` |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L343) | 343 | `const slug = slugifyId(key);` | Use key directly (should already be ID) |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L351) | 351 | `const nameSlug = slugifyId(nameKey);` | Use `id` from profile |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx#L368) | 368 | `zoneProgressMap.get(slugifyId(name))` | Use `user.id` as key |
| [FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L136) | 136 | `multiAssignableKeys.add(slugifyId(candidate.name));` | Use `candidate.id` |
| [FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L156) | 156 | `blockKeys.push(slugifyId(occupantName));` | Use `occupantId` |
| [FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L164) | 164 | `const baseId = slugifyId(baseName);` | Use `baseUser.id` |
| [FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L170) | 170 | `profileId: slugifyId(baseName)` | Use `baseUser.id` |
| [FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L200) | 200 | `const id = candidate.id \|\| slugifyId(candidate.name);` | `const id = candidate.id;` |
| [FitnessSidebarMenu.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx#L207) | 207 | `profileId: candidate.id \|\| slugifyId(candidate.name)` | `profileId: candidate.id` |
| [FullscreenVitalsOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx#L119) | 119 | `slugifyId(slugSource, 'equipment')` | Use `equipment.id` |
| [FullscreenVitalsOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx#L186-187) | 186-187 | Multiple slug fallbacks | Use explicit `equipmentId` |
| [FullscreenVitalsOverlay.jsx (shared)](frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx#L124) | 124 | Same as above | Same fix |
| [FullscreenVitalsOverlay.jsx (shared)](frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx#L191-192) | 191-192 | Same as above | Same fix |
| [FitnessChartApp.jsx](frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L73-74) | 73-74 | Profile/entry ID derivation | Use `entry.profileId \|\| entry.id` |
| [FitnessChartApp.jsx](frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L128) | 128 | Roster ID mapping | Use `r.profileId \|\| r.id` |
| [FitnessChartApp.jsx](frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L598) | 598 | Clip safe ID for SVG | Use `avatar.id` (sanitize for SVG separately if needed) |
| [FitnessChart.helpers.js](frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js#L32) | 32 | Chart key derivation | Use explicit ID |
| [TreasureBox.js](frontend/src/hooks/fitness/TreasureBox.js#L145-149) | 145-149 | Callback parameter | Pass user IDs directly |
| [TreasureBox.js](frontend/src/hooks/fitness/TreasureBox.js#L179) | 179 | Test/default | Use proper IDs |
| [TreasureBox.js](frontend/src/hooks/fitness/TreasureBox.js#L298) | 298 | User slug lookup | Use `user.id` |

---

## Implementation Order

### Phase 1: Core Identity (Breaking Changes)

1. **Require `id` in User constructor** - Remove fallback to `slugifyId(name)`
2. **Require `id` in Device constructor** - Remove fallback to slugified name
3. **Update all config loading** to ensure `id` is always populated
4. **Audit profile.yml files** to confirm all users have explicit `username` that becomes `id`

### Phase 2: Remove Slug-Based Lookups

1. Update all `Map.get()` calls to use canonical IDs only
2. Remove dual-lookup patterns like `map.get(id) || map.get(slugifyId(id))`
3. Update function signatures to accept `userId` instead of `name`

### Phase 3: Remove Local Definitions

1. Delete all copy-pasted `slugifyId` definitions in UI components
2. Update imports to remove `slugifyId` from `types.js` exports

### Phase 4: Clean Up Zone Handling

1. Create `normalizeZoneId(id)` for zone-config-specific normalization
2. Update zone-related functions to use the new helper
3. Remove remaining `slugifyId` usage in `types.js`

### Phase 5: Documentation Updates

1. Update [docs/notes/fitness-system-architecture-analysis.md](docs/notes/fitness-system-architecture-analysis.md) to remove `slugifyId` references
2. Update [docs/notes/sidebar-chart-inactivity-divergence.md](docs/notes/sidebar-chart-inactivity-divergence.md)
3. Update [project/improvements/fitness-guest-replacement.md](project/improvements/fitness-guest-replacement.md)

---

## Migration Notes

### Guest Users

Current pattern:
```javascript
const slug = slugifyId(guestName); // e.g., "John Doe" → "john_doe"
```

Correct pattern:
```javascript
const guestId = `guest-${Date.now()}`; // e.g., "guest-1735689600000"
```

### Avatar/Media Paths

Current pattern:
```javascript
DaylightMediaPath(`/media/img/users/${slugifyId(canonicalName)}`)
```

Correct pattern:
```javascript
DaylightMediaPath(`/media/img/users/${user.id}`)
```

**Ensure media files are named by `id` (e.g., `kckern.jpg`), not slugified names.**

### SVG Clip Path IDs

For SVG elements that require valid IDs (no special characters), use:
```javascript
const svgSafeId = id.replace(/[^a-zA-Z0-9-_]/g, '_');
```

This is only needed for SVG `id` attributes, not for data lookups.

---

## Files Summary

| Category | File Count | Total Usages |
|----------|------------|--------------|
| Definitions (to delete) | 8 | 8 |
| Core hooks (fitness/) | 9 | ~45 |
| UI Components | 9 | ~40 |
| Context | 1 | ~14 |
| Zone-specific (keep as `normalizeZoneId`) | 1 | ~7 |
| Documentation | 3 | ~8 |
| **Total** | **~25 files** | **~129 usages** |

---

## Verification Checklist

- [ ] All `User` objects have explicit `id` from config
- [ ] All `Device` objects have explicit `id` from WebSocket data
- [ ] No runtime slug generation from display names
- [ ] All `Map` lookups use canonical IDs
- [ ] Avatar paths use `user.id`
- [ ] Guest users get `guest-{timestamp}` IDs at creation
- [ ] Zone functions use dedicated `normalizeZoneId()` helper
- [ ] All 8 local definitions deleted
- [ ] `slugifyId` export removed from `types.js`
- [ ] Documentation updated
