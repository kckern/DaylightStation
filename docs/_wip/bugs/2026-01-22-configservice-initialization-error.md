# ConfigService Initialization Error

## Summary

The v1 dev server fails to start with a fatal error: `ConfigService not initialized. Call initConfigService(dataDir) at startup.`

## Error Details

```
[FATAL] Server initialization failed: ConfigService not initialized. Call initConfigService(dataDir) at startup.
    at getConfigService (backend/_legacy/lib/config/index.mjs:65:11)
    at Object.get (backend/_legacy/lib/config/index.mjs:87:17)
    at createApp (backend/src/app.mjs:174:37)
    at main (backend/src/server.mjs:126:21)
```

## Root Cause

The v1 app (`app.mjs`) calls `configService.getDefaultHouseholdId()` at line 174, which internally uses the legacy config module (`backend/_legacy/lib/config/index.mjs`). The legacy config requires explicit initialization via `initConfigService(dataDir)`, but this isn't being called before the v1 code path tries to use it.

## Relevant Files

- `backend/src/app.mjs:174` - Where the error is triggered
- `backend/src/server.mjs:126` - Server main entry point
- `backend/_legacy/lib/config/index.mjs:65,87` - Legacy config service that throws the error
- `backend/src/0_infrastructure/config/ConfigService.mjs` - New config service (initialized correctly)

## Observations

1. The new ConfigService (`0_infrastructure/config/ConfigService.mjs`) initializes successfully:
   ```
   [Config] Source: env-vars, Config: /Users/.../data/system
   [Config] ConfigService initialized
   ```

2. The error occurs when `app.mjs` tries to use `configService.getDefaultHouseholdId()` which delegates to the legacy config module

3. The legacy config module has a guard that throws if not initialized:
   ```javascript
   // backend/_legacy/lib/config/index.mjs:65
   if (!configService) {
     throw new Error('ConfigService not initialized. Call initConfigService(dataDir) at startup.');
   }
   ```

## Potential Fixes

1. **Initialize legacy config in server.mjs** - Call `initConfigService()` from the legacy module before `createApp()`

2. **Update app.mjs to use new ConfigService** - Replace the call to legacy `configService.getDefaultHouseholdId()` with the new infrastructure ConfigService

3. **Bridge the configs** - Have the new ConfigService initialize the legacy one automatically

## Impact

- v1 dev server cannot start on `localhost:3112`
- Blocks testing of v1 API endpoints
- Prod server on port 3111 appears unaffected (uses different code path)

## Reproduction

```bash
NODE_ENV=development node backend/src/server.mjs
```

## Related

- The prod server (port 3111) runs via Docker and may have different initialization
- This is a v1/DDD migration issue where old and new config systems coexist
