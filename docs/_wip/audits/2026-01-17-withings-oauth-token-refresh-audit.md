# Audit: Withings OAuth Token Refresh Process

**Date:** January 17, 2026  
**Component:** `backend/lib/withings.mjs`  
**Status:** ⚠️ Bug Identified  

---

## Summary

The Withings OAuth refresh token flow has a critical bug: the access token's `expires_in` field is treated as if it were still valid relative to the current time, but without a timestamp of when it was issued, there's no way to determine if it has actually expired.

---

## OAuth Token Refresh Flow (Expected)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load auth from disk                                          │
│    └── data/users/{username}/auth/withings.yml                  │
│                                                                 │
│ 2. Check if access token is valid                               │
│    ├── If cached & not expired → use cached token               │
│    └── If expired → refresh using refresh_token                 │
│                                                                 │
│ 3. Refresh token via Withings API                               │
│    POST https://wbsapi.withings.net/v2/oauth2                   │
│    └── action=requesttoken, grant_type=refresh_token            │
│                                                                 │
│ 4. Save new tokens to disk                                      │
│    └── userSaveAuth(username, 'withings', updatedAuth)          │
│                                                                 │
│ 5. Use new access token for API calls                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Bug Analysis

### Current Auth File Format

```yaml
# data/users/kckern/auth/withings.yml
userid: '854219'
access_token: 71be2d33f12ce9e0c6fcfd6b3f2b76cd8ef83abb
scope: user.metrics
expires_in: 10800          # ← Seconds from issuance (3 hours)
token_type: Bearer
refresh_token: a8c401ff4f25875549b099222a0c987eb9c49c1e
```

### Problem: No Timestamp to Calculate Expiry

The code in `getAccessToken()` does this (lines 137-149):

```javascript
// Allow seeded access token with expiry from auth file for immediate reuse
if (!accessTokenCache.token && authData?.access_token) {
    const expiresInSeed = authData?.expires_in ? Number(authData.expires_in) : null;
    if (expiresInSeed && expiresInSeed > 60) {
        // BUG: This calculates expiry from NOW, not from when token was issued
        const seededExpiry = moment().add(Math.max(60, expiresInSeed - tokenBufferSeconds), 'seconds');
        accessTokenCache.token = authData.access_token;
        accessTokenCache.expiresAt = seededExpiry;
        // ...
        if (accessTokenCache.expiresAt && now.isBefore(accessTokenCache.expiresAt)) {
            return accessTokenCache.token;  // ← Uses stale token!
        }
    }
}
```

**The Bug:** `expires_in: 10800` means "valid for 10800 seconds *from when issued*". But without knowing *when* it was issued, the code assumes it was just issued and calculates expiry as `now + 10800 seconds`. This means:

1. Token issued at 10:00 AM, expires 1:00 PM
2. Container restarts at 2:00 PM
3. Code calculates: `2:00 PM + 10800s = 5:00 PM` (wrong!)
4. Token is already expired but code thinks it's valid
5. API call fails with `invalid_token`

### Why Refresh Isn't Attempted

The token refresh logic (lines 152-201) only runs if:
1. Cache is empty (`!accessTokenCache.token`)
2. AND env token is expired
3. AND seeded token check fails

But the seeded token check at line 147 *always* returns the stale access token because it wrongly believes `expires_in` is still valid.

---

## Evidence from Logs

```json
{"level":"error","event":"withings.api.invalid_response","data":{
  "status":401,
  "error":"XRequestID: Not provided invalid_token: The access token provided is invalid"
}}
```

No `withings.auth.token_refreshed` or `withings.auth.refresh_failed` events appear because the refresh code path is never reached.

---

## Root Cause

**Missing Field:** The auth file needs either:
- `expires_at` - Absolute timestamp when token expires
- `updated_at` / `created_at` - Timestamp when token was issued

Without this, `expires_in` is meaningless after the first container lifecycle.

---

## Fix Options

### Option A: Use `expires_at` Instead of `expires_in` (Recommended)

**When saving tokens (line 176-188):**
```javascript
const updatedAuth = {
    ...authData,
    access_token,
    expires_at: moment().add(expiresIn, 'seconds').toISOString(),  // ← Store absolute expiry
    refresh_token: refresh_token || refresh,
    updated_at: new Date().toISOString()
};
// Remove legacy field
delete updatedAuth.expires_in;
```

**When checking validity:**
```javascript
if (!accessTokenCache.token && authData?.access_token) {
    const expiresAt = authData?.expires_at ? moment(authData.expires_at) : null;
    if (expiresAt && expiresAt.isValid() && expiresAt.isAfter(now)) {
        accessTokenCache.token = authData.access_token;
        accessTokenCache.expiresAt = expiresAt;
        return accessTokenCache.token;
    }
    // Otherwise, fall through to refresh
}
```

### Option B: Use `updated_at` to Calculate Expiry

**When saving tokens:**
```javascript
const updatedAuth = {
    ...authData,
    access_token,
    expires_in: expiresIn,
    updated_at: new Date().toISOString()  // ← Track when saved
};
```

**When checking validity:**
```javascript
if (!accessTokenCache.token && authData?.access_token) {
    const updatedAt = authData?.updated_at ? moment(authData.updated_at) : null;
    const expiresIn = authData?.expires_in ? Number(authData.expires_in) : null;
    if (updatedAt && expiresIn) {
        const expiresAt = updatedAt.clone().add(expiresIn, 'seconds');
        if (expiresAt.isAfter(now)) {
            accessTokenCache.token = authData.access_token;
            accessTokenCache.expiresAt = expiresAt;
            return accessTokenCache.token;
        }
    }
    // Otherwise, fall through to refresh
}
```

---

## Secondary Issue: ConfigService Caching

The `configService.getUserAuth('withings', username)` returns auth data loaded at startup. When `userSaveAuth()` writes new tokens to disk, ConfigService still has stale data in memory.

**Current flow:**
1. ConfigService loads auth at startup (from disk)
2. Withings refreshes token, saves to disk via `userSaveAuth()`
3. ConfigService still returns old token from memory cache
4. Next request uses stale token

**Fix:** After saving auth, either:
- Reload ConfigService auth cache
- Use `loadFile()` directly instead of ConfigService for auth
- Add a `configService.reloadUserAuth()` method

---

## Recommended Changes

### 1. Fix token expiry calculation in withings.mjs

```javascript
// Line ~137: Replace seeded token logic
if (!accessTokenCache.token && authData?.access_token) {
    // Use expires_at if available, otherwise skip seeded token
    const expiresAt = authData?.expires_at ? moment(authData.expires_at) : null;
    if (expiresAt && expiresAt.isValid() && expiresAt.isAfter(now.clone().add(tokenBufferSeconds, 'seconds'))) {
        accessTokenCache.token = authData.access_token;
        accessTokenCache.expiresAt = expiresAt;
        withingsLogger.debug('withings.auth.seed_token_loaded', { expiresAt: expiresAt.toISOString() });
        return accessTokenCache.token;
    }
    // No valid seeded token - will fall through to refresh
    withingsLogger.debug('withings.auth.seed_token_expired', { 
        expiresAt: expiresAt?.toISOString() || 'missing',
        hasRefreshToken: !!authData?.refresh_token
    });
}
```

### 2. Save expires_at when refreshing (line ~178)

```javascript
const updatedAuth = {
    ...authData,
    access_token,
    expires_at: moment().add(expiresIn, 'seconds').toISOString(),
    refresh_token: refresh_token || refresh,
    updated_at: new Date().toISOString()
};
delete updatedAuth.expires_in;  // Remove legacy field
delete updatedAuth.refresh;     // Remove legacy field
```

### 3. Load auth directly from disk instead of ConfigService

```javascript
// In getWeightData(), change:
// const authData = configService.getUserAuth('withings', username) || {};

// To:
const authData = loadFile(`users/${username}/auth/withings`) || {};
```

---

## Testing Checklist

After fix:
- [ ] Fresh token file with only `refresh_token` → should refresh and save `expires_at`
- [ ] Token file with valid `expires_at` in future → should use cached token
- [ ] Token file with expired `expires_at` → should refresh
- [ ] Container restart → should correctly evaluate token validity
- [ ] `updated_at` is saved on every refresh

---

## Related Code

- [backend/lib/withings.mjs](backend/lib/withings.mjs) - Token refresh logic
- [backend/lib/io.mjs](backend/lib/io.mjs#L459) - `userSaveAuth()` function
- [backend/lib/config/configLoader.mjs](backend/lib/config/configLoader.mjs#L101) - Auth loading at startup
- [backend/lib/config/ConfigService.mjs](backend/lib/config/ConfigService.mjs#L119) - `getUserAuth()` method

---

## Timeline

| Date | Event |
|------|-------|
| ~Jan 10 | Token likely expired, refresh stopped working |
| Jan 17 | Cron scheduler fixed, withings job attempts to run |
| Jan 17 | Auth failure discovered (`invalid_token`) |
| Jan 17 | This audit created |
| Jan 17 | Fix applied to withings.mjs - now uses `expires_at` and loads fresh from disk |
| Jan 17 | Same fix applied to fitsync.mjs for consistency |

---

## Also Fixed: fitsync.mjs

The same issues existed in `backend/lib/fitsync.mjs`:
1. Used `configService.getUserAuth()` (cached) instead of loading fresh from disk
2. Didn't save `expires_at` when refreshing tokens

Both files now:
- Load auth fresh from disk via `loadFile()` instead of cached ConfigService
- Save `expires_at` (absolute timestamp) instead of relying on `expires_in`
- Save `updated_at` for tracking
