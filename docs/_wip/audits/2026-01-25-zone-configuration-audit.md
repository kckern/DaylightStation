# Zone Configuration Audit
**Date:** 2026-01-25
**Status:** In Progress
**Issue:** User-level zone overrides not being honored in all components

## Problem Statement
Users reported that their participant card/avatar zone color doesn't match the zone required by GovernanceEngine. This suggests one component uses global default zones while another uses user-specific zones.

## Zone Configuration Sources

### 1. Global Zones (config.yml)
```yaml
zones:
  - id: cool, min: 0
  - id: active, min: 100
  - id: warm, min: 120
  - id: hot, min: 140
  - id: fire, min: 160
```

### 2. User-Specific Zones (profile files & inline config)
**From profile files** (data/users/{id}/profile.yml):
```yaml
apps:
  fitness:
    heart_rate_zones:
      active: 120
      warm: 140
      hot: 165
      fire: 185
```

**From inline config** (config.yml users.family/friends):
```yaml
users:
  friends:
    - name: Lila
      zones:
        active: 120
        warm: 140
        hot: 160
        fire: 180
```

## Data Flow Analysis

### Backend Hydration (UserService.mjs)
- `hydrateFitnessConfig()` loads primary user profiles
- `hydrateUsers()` attaches `zones` from `profile.apps.fitness.heart_rate_zones`
- API returns: `users.primary[].zones = { active: 120, warm: 140, ... }`

**Verified working:** API correctly returns user-specific zones.

### Frontend Zone Resolution Paths

#### Path 1: TreasureBox (for coin awards & avatar color)
```
FitnessContext.useEffect
  → TreasureBox.configure({ users: usersConfig })
  → collectOverrides() iterates usersConfig.primary/family/friends
  → usersConfigOverrides.set(userId, zones)
  → resolveZone(userId, hr) checks usersConfigOverrides
```

#### Path 2: UserManager + ZoneProfileStore (for GovernanceEngine)
```
FitnessContext.useEffect
  → UserManager.configure(usersConfig, zoneConfig)
  → registerUser() creates User with zoneOverrides: config.zones
  → User.zoneConfig = buildZoneConfig(globalZones, zoneOverrides)

FitnessSession.updateSnapshot
  → allUsers = userManager.getAllUsers()
  → ZoneProfileStore.syncFromUsers(allUsers)
  → #buildProfileFromUser(user) uses user.zoneConfig
  → deriveZoneProgressSnapshot({ zoneConfig, heartRate })

GovernanceEngine.evaluate
  → profile = zoneProfileStore.getProfile(participantId)
  → userZoneMap[participantId] = profile.currentZoneId
```

## Identified Gap

**TreasureBox and ZoneProfileStore use different zone configuration sources:**

| Component | Source | Lookup Key |
|-----------|--------|------------|
| TreasureBox | `usersConfigOverrides` Map | userId → zones object |
| ZoneProfileStore | `user.zoneConfig` array | Built from User constructor |

If one is populated correctly but the other isn't, zone colors will mismatch.

## Diagnostic Logging Added

### TreasureBox.js
1. `treasurebox.user_zone_overrides_configured` - Logs when overrides are set
   - `overrideCount`: Number of users with zone overrides
   - `userIds`: Array of user IDs with overrides

2. `treasurebox.zone_resolved` - Enhanced with override info
   - `hasOverrides`: Boolean - whether user has overrides
   - `overrideKeys`: Array of override keys (active, warm, etc.)

### ZoneProfileStore.js (updated 2026-01-26)
1. `zoneprofilestore.build_profile` - Logger-based (visible in Docker logs)
   - `userId`: User ID being processed
   - `hasCustomZones`: Whether user.zoneConfig exists
   - `warmThreshold`: The warm zone min (for comparison)

### UserManager.js (updated 2026-01-26)
1. `usermanager.user_created` - Logger-based (visible in Docker logs)
   - `hasZoneOverrides`: Whether config.zones exists
   - `zoneOverrides`: The actual zone values
   - `userZoneConfigLength`: Length of built zoneConfig

## Verification Results (2026-01-26)

### TreasureBox: ✅ WORKING CORRECTLY
Production logs confirm user-specific zones ARE being honored:

```json
// milo: HR=152 → warm zone with min=140 (user-specific, not global 120)
{"event":"treasurebox.zone_resolved","data":{"profileId":"milo","hr":152,"zone":{"id":"warm","min":140},"hasOverrides":true,"overrideKeys":["active","warm","hot","fire"]}}

// felix: HR=149 → warm zone with min=140 (user-specific)
{"event":"treasurebox.zone_resolved","data":{"profileId":"felix","hr":149,"zone":{"id":"warm","min":140},"hasOverrides":true,"overrideKeys":["active","warm","hot","fire"]}}

// soren: HR=112 → cool zone (user-specific active threshold is 120)
{"event":"treasurebox.zone_resolved","data":{"profileId":"soren","hr":112,"zone":{"id":"cool","min":0},"hasOverrides":true,"overrideKeys":["active","warm","hot","fire"]}}
```

**Key finding:** All users show `hasOverrides: true` and `min: 140` for warm zone, which is the user-specific threshold (not the global 120).

### ZoneProfileStore: ⏳ PENDING VERIFICATION
Updated to use Logger instead of console.log. Needs redeploy to verify.

### UserManager: ⏳ PENDING VERIFICATION
Updated to use Logger instead of console.log. Needs redeploy to verify.

## Next Steps

1. **Redeploy** with updated Logger-based logging for ZoneProfileStore and UserManager
2. **Verify** `zoneprofilestore.build_profile` logs show `hasCustomZones: true` and correct `warmThreshold`
3. **Verify** `usermanager.user_created` logs show `hasZoneOverrides: true` and correct values
4. If both show correct zones, the mismatch may be in GovernanceEngine's zone comparison logic

## Test Plan

1. **Deploy changes** and start a fitness session
2. **Check logs** for:
   - `user_zone_overrides_configured` - Should show overrideCount > 0
   - `zone_resolved` - Should show `hasOverrides: true` for users with custom zones
   - `[ZoneProfileStore]` - Should show `hasCustomZones: true` for same users

3. **Compare** warm thresholds:
   - Milo: Should be 140 (not 120)
   - Alan: Should be 150 (not 120)

4. **Verify avatar color** matches governance requirement at zone boundaries

## Expected Fix

If diagnostics show `usersConfigOverrides` is empty but `user.zoneConfig` is correct:
- Issue is in TreasureBox.configure() - zones not being extracted
- Fix: Debug why collectOverrides() isn't finding zones

If both are empty:
- Issue is in FitnessContext - usersConfig doesn't have zones when passed
- Fix: Ensure API response is loaded before configure() is called

## Related Files
- `frontend/src/hooks/fitness/TreasureBox.js:67-125` (configure)
- `frontend/src/hooks/fitness/TreasureBox.js:432-446` (resolveZone)
- `frontend/src/hooks/fitness/ZoneProfileStore.js:135-178` (buildProfileFromUser)
- `frontend/src/hooks/fitness/UserManager.js:282-329` (registerUser)
- `frontend/src/context/FitnessContext.jsx:489-549` (configure calls)
- `backend/src/0_infrastructure/config/UserService.mjs:51-105` (hydrateUsers)
