# Ambient LED Troubleshooting Guide

This guide helps diagnose and fix issues with the Ambient LED fitness zone feature.

## Quick Diagnostics

### 1. Check Feature Status
```bash
curl http://localhost:3000/fitness/zone_led/status
```

**Expected response when working:**
```json
{
  "enabled": true,
  "scenes": { "off": "...", "cool": "...", ... },
  "state": { "failureCount": 0, "isInBackoff": false }
}
```

### 2. Check Metrics
```bash
curl http://localhost:3000/fitness/zone_led/metrics
```

Look for:
- `totals.activated` > 0 (scenes are being activated)
- `totals.failures` = 0 (no HA errors)
- `circuitBreaker.isOpen` = false (not in backoff)

---

## Common Issues

### Issue: Feature Shows as Disabled

**Symptoms:**
- `enabled: false` in status response
- No LED changes during workout

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Missing `ambient_led` section | Add `ambient_led:` section to fitness config |
| Missing `scenes` object | Add `scenes:` under `ambient_led:` |
| Missing `off` scene | Add `off: your_scene_name` (required) |
| Wrong config file | Ensure config is in correct household path |

**Verify config location:**
```
data/households/{household_id}/apps/fitness/config.yml
```

---

### Issue: LEDs Not Changing

**Symptoms:**
- Status shows `enabled: true`
- `lastScene` never updates
- Metrics show `activated: 0`

**Diagnostic Steps:**

1. **Check if requests are reaching backend:**
   ```bash
   # Watch logs
   tail -f logs/backend.log | grep zone_led
   ```

2. **Check skip reasons in metrics:**
   ```bash
   curl http://localhost:3000/fitness/zone_led/metrics | jq '.skipped'
   ```

**Common skip reasons:**

| Reason | Meaning | Solution |
|--------|---------|----------|
| `duplicate` | Same scene already active | Normal behavior - only changes are sent |
| `rate_limited` | Too many requests | Wait for throttle window (default 2s) |
| `backoff` | Circuit breaker open | Fix HA connection, then reset |
| `feature_disabled` | Config missing | Check config file |

3. **Test manual scene activation:**
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led \
     -H "Content-Type: application/json" \
     -d '{"zones":[{"zoneId":"warm","isActive":true}]}'
   ```

---

### Issue: Home Assistant Connection Failures

**Symptoms:**
- `failureCount` > 0 in status
- `isInBackoff: true` (circuit breaker open)
- Error logs showing HA connection issues

**Diagnostic Steps:**

1. **Check HA connectivity:**
   ```bash
   curl -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
        http://your-ha-host:8123/api/
   ```

2. **Test scene activation directly:**
   ```bash
   curl -X POST http://your-ha-host:8123/api/services/scene/turn_on \
     -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"entity_id": "scene.your_scene_name"}'
   ```

**Common causes:**

| Cause | Solution |
|-------|----------|
| Wrong HA host/port | Update `home_assistant.host` and `home_assistant.port` in config |
| Invalid token | Generate new long-lived access token in HA |
| Network issues | Check firewall, DNS resolution |
| HA offline | Wait for HA to come back online |

3. **Reset circuit breaker after fixing:**
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led/reset
   ```

---

### Issue: Scene Doesn't Exist in HA

**Symptoms:**
- HA returns 404 or error
- Error log shows "scene not found"

**Solution:**

1. Verify scene exists in HA:
   ```bash
   curl -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
        http://your-ha-host:8123/api/states/scene.your_scene_name
   ```

2. Check scene naming:
   - Config uses scene **name** (e.g., `garage_led_blue`)
   - HA uses entity_id format: `scene.garage_led_blue`
   - The backend adds `scene.` prefix automatically

3. Create missing scene in HA `scenes.yaml`

---

### Issue: Wrong Zone Displayed

**Symptoms:**
- LED color doesn't match expected zone
- Unexpected zone resolution

**Diagnostic Steps:**

1. **Check what zones are being sent:**
   ```bash
   # In browser console during workout
   # Or check backend logs for zone_led.activated events
   ```

2. **Verify zone calculation:**
   - Max zone among all **active** participants is used
   - Inactive users (heart rate timeout) are excluded
   - Single user in fire = "all fire" (breathing effect)

3. **Test zone resolution:**
   ```bash
   # Test warm zone
   curl -X POST http://localhost:3000/fitness/zone_led \
     -H "Content-Type: application/json" \
     -d '{"zones":[{"zoneId":"warm","isActive":true}]}'
   ```

---

### Issue: Rate Limiting Too Aggressive

**Symptoms:**
- Many `rate_limited` skips in metrics
- LED changes feel delayed

**Solution:**

Reduce throttle time in config:
```yaml
ambient_led:
  throttle_ms: 1000  # Reduce from default 2000ms
  scenes:
    # ...
```

**Note:** Don't go below 500ms to avoid overwhelming Home Assistant.

---

### Issue: Circuit Breaker Won't Reset

**Symptoms:**
- `isInBackoff: true` even after HA is fixed
- Backoff keeps increasing

**Solution:**

1. **Manual reset:**
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led/reset
   ```

2. **Verify HA is actually reachable** before resetting

3. **Check for recurring failures** - if HA keeps failing, circuit will re-open

---

## Log Analysis

### Key Log Events

| Event | Level | Meaning |
|-------|-------|---------|
| `fitness.zone_led.activated` | INFO | Scene successfully changed |
| `fitness.zone_led.skipped` | DEBUG | Request skipped (see reason) |
| `fitness.zone_led.failed` | ERROR | HA call failed |
| `fitness.zone_led.circuit_open` | ERROR | Circuit breaker opened |
| `fitness.zone_led.backoff` | WARN | Request rejected due to backoff |
| `fitness.zone_led.reset` | INFO | State was manually reset |

### Enable Debug Logging

To see all zone_led events including skipped requests:
```bash
# Set log level to debug for fitness app
export LOG_LEVEL=debug
```

### Log Search Examples

```bash
# Find all scene activations
grep "zone_led.activated" logs/backend.log

# Find failures
grep "zone_led.failed\|zone_led.circuit_open" logs/backend.log

# Count by event type
grep "zone_led" logs/backend.log | cut -d'"' -f4 | sort | uniq -c
```

---

## Testing Tools

### Manual Test Script

```bash
# Test all zones in sequence
node scripts/test-zone-led.mjs test-all
```

### Individual Zone Commands

```bash
node scripts/test-zone-led.mjs cool    # Blue
node scripts/test-zone-led.mjs warm    # Yellow
node scripts/test-zone-led.mjs hot     # Orange
node scripts/test-zone-led.mjs fire    # Red
node scripts/test-zone-led.mjs off     # Off
```

### Stress Test (Throttle Verification)

```bash
node scripts/test-zone-led.mjs stress
```

---

## Health Check Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /fitness/zone_led/status` | Current state and config |
| `GET /fitness/zone_led/metrics` | Detailed usage metrics |
| `POST /fitness/zone_led/reset` | Reset circuit breaker |

---

## Recovery Procedures

### Full Reset Procedure

1. Stop any active workout sessions
2. Fix underlying issue (HA connectivity, config, etc.)
3. Reset circuit breaker:
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led/reset
   ```
4. Test with manual scene change:
   ```bash
   curl -X POST http://localhost:3000/fitness/zone_led \
     -H "Content-Type: application/json" \
     -d '{"zones":[{"zoneId":"cool","isActive":true}]}'
   ```
5. Verify in status:
   ```bash
   curl http://localhost:3000/fitness/zone_led/status
   ```

### Emergency LED Off

If LEDs are stuck on and need to be turned off immediately:

```bash
# Via DaylightStation
curl -X POST http://localhost:3000/fitness/zone_led \
  -H "Content-Type: application/json" \
  -d '{"sessionEnded":true}'

# Directly via Home Assistant
curl -X POST http://your-ha-host:8123/api/services/scene/turn_on \
  -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "scene.garage_led_off"}'
```

---

## Contact & Support

If issues persist after following this guide:
1. Collect logs: `grep zone_led logs/backend.log > zone_led_debug.log`
2. Get metrics: `curl http://localhost:3000/fitness/zone_led/metrics > metrics.json`
3. Get status: `curl http://localhost:3000/fitness/zone_led/status > status.json`
4. Include config (redact sensitive data)
