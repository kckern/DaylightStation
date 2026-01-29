# Ambient LED Feature Failing - Home Assistant baseUrl Not Resolved

**Date**: 2026-01-29
**Status**: Resolved
**Severity**: Medium
**Component**: Fitness / Home Automation Integration

## Summary

The ambient LED controller (AmbientLedAdapter) is failing to initialize because Home Assistant baseUrl is not being resolved from services.yml. The system expects the baseUrl to be present in the `homeAssistant` config object passed to bootstrap, but the IntegrationLoader's service URL resolution isn't being applied correctly.

## Symptoms

Frontend error:
```
"API Error Response:","{"ok":false,"error":"Zone LED controller not configured (Home Assistant required)"}"
```

Backend warning on startup:
```json
{
  "event": "fitness.homeassistant.disabled",
  "data": {
    "reason": "Missing baseUrl or token configuration"
  }
}
```

## Environment

- Production container on kckern-server
- Home Assistant running at localhost:8123
- Token present in `data/household/auth/homeassistant.yml`
- Service config present in `data/system/config/services.yml`

## Root Cause

In [bootstrap.mjs](backend/src/0_system/bootstrap.mjs#L506), the fitness initialization checks:
```javascript
if (!haGateway && homeAssistant?.baseUrl && homeAssistant?.token && httpClient) {
```

However, the `homeAssistant` config object doesn't contain `baseUrl` even though:
1. Token exists in `data/household/auth/homeassistant.yml`
2. Service host/port defined in `data/system/config/services.yml`:
   ```yaml
   homeassistant:
     port: 8123
     hosts:
       kckern-server: localhost
   ```
3. Provider declared in `data/household/integrations.yml`:
   ```yaml
   home_automation:
     - provider: homeassistant
   ```

The IntegrationLoader has logic to resolve service URLs via `resolveServiceUrl()` and add them as `host` (which gets normalized to `baseUrl`), but this resolved URL isn't making it to the bootstrap code's `homeAssistant` config object.

## Expected Behavior

The system should automatically resolve `baseUrl` from services.yml using the ConfigService.resolveServiceUrl() method, which should return `http://localhost:8123` for the kckern-server environment.

## Current Workaround

None - feature is non-functional.

## Reproduction Steps

1. Configure Home Assistant in integrations.yml (already done)
2. Add token to household/auth/homeassistant.yml (already done)
3. Configure service in system/config/services.yml (already done)
4. Start fitness session with heart rate monitoring
5. Observe error in frontend console and backend logs

## Investigation Notes

- IntegrationLoader.#buildAdapterConfig() at line 121 calls `resolveServiceUrl(provider)` and adds it as `host`
- The normalization logic at line 169 converts `host` to `baseUrl` for homeassistant
- However, the bootstrap code receives a separate `homeAssistant` config object that doesn't go through this flow
- The bootstrap code may be receiving config from a different source (getServiceConfig? getAdapterConfig?)

## Suggested Fix

Need to investigate how the `homeAssistant` config object is built and passed to bootstrap. Options:
1. Ensure IntegrationLoader's resolved config is used for bootstrap
2. Have bootstrap call `configService.resolveServiceUrl('homeassistant')` directly
3. Pass the loaded adapter from IntegrationLoader to bootstrap instead of config

## Related Code

- [backend/src/0_system/bootstrap.mjs](backend/src/0_system/bootstrap.mjs#L500-L530)
- [backend/src/0_system/registries/IntegrationLoader.mjs](backend/src/0_system/registries/IntegrationLoader.mjs#L110-L130)
- [backend/src/0_system/config/ConfigService.mjs](backend/src/0_system/config/ConfigService.mjs#L328-L345)
- [backend/src/2_adapters/fitness/AmbientLedAdapter.mjs](backend/src/2_adapters/fitness/AmbientLedAdapter.mjs)

## Resolution

### Root Cause
The `getServiceConfig()` method was reading from the wrong location. It reads raw service configuration from `data/system/config/services.yml` but does not resolve the host based on the current hostname. The application code was calling `getServiceConfig('homeassistant')` expecting a resolved `baseUrl`, but this method only returns the raw config structure (port, hosts map).

The correct method to use is `resolveServiceUrl(serviceName)`, which:
1. Reads the service config
2. Resolves the host based on `os.hostname()`
3. Returns the fully-formed URL (e.g., `http://localhost:8123`)

### Fix Commits

1. **`9f0a4910`** - test: add tests documenting getServiceConfig vs resolveServiceUrl behavior
   - Added unit tests to clearly document the different behaviors of these two methods
   - Tests confirm `getServiceConfig` returns raw config while `resolveServiceUrl` returns resolved URL

2. **`903e8a70`** - fix(app): use resolveServiceUrl for Home Assistant URL resolution
   - Changed fitness app initialization to use `resolveServiceUrl('homeassistant')` instead of `getServiceConfig`
   - Home Assistant baseUrl is now correctly resolved

3. **`d1704009`** - fix(app): use getAdapterConfig for thermal printer configuration
   - Fixed printer adapter to use the correct config resolution method
   - Related service that had the same issue pattern

4. **`28251021`** - fix(app): derive daylightHost from app port instead of deprecated getServiceConfig
   - Fixed TV/devices app to derive the daylight host URL correctly
   - Uses app port configuration instead of attempting to read from getServiceConfig

### Related Services Also Fixed
- **Thermal Printer**: Was using incorrect config method, now uses `getAdapterConfig`
- **TV/Devices**: Was attempting to use `getServiceConfig` for daylightHost, now derives from app port
