# Tick Rate Investigation - 2026-01-20

## Summary

Investigation into FitnessTimeline prune log spam and whether it represents a real problem requiring a fix.

## Observed Symptoms

1. **Prune logs flooding** at ~77/sec with messages like:
   ```
   [FitnessTimeline] Pruned 138706 old points from device:60161:rpm (current length: 2000)
   ```

2. **Stack overflow errors** in tick timer:
   ```
   fitness.tick_timer.error: Maximum call stack size exceeded
   ```

3. **Validation failures** preventing session save:
   ```
   VALIDATION_FAIL: series-tick-mismatch
   series.length=2000, tickCount=156647
   ```

## Analysis

### Expected vs Actual Tick Rates

| Metric | Expected | Actual | Ratio |
|--------|----------|--------|-------|
| Tick interval | 5000ms | ~13ms | 385x faster |
| Ticks per minute | 12 | ~4620 | 385x more |
| Ticks in 30min session | 360 | ~138,600 | 385x more |

### Root Cause Hypothesis

`FitnessSession._maybeTickTimeline()` is called on every device data ingest (line 588):
```js
this._maybeTickTimeline(deviceData?.timestamp || now);
```

If device data arrives frequently (~77 Hz from ANT+ sensors), and each call potentially triggers a tick, the tick count inflates rapidly.

### Impact Assessment

**Confirmed impacts:**
- Session validation fails (`series-tick-mismatch`) → data loss
- Stack overflow in tick timer → app instability
- 138k array allocations/deallocations per tick → GC pressure

**Unconfirmed:**
- Whether this correlates with the 409MB memory leak from Session 3 audit
- Whether this affects all sessions or only specific device configurations

## Evidence Quality

| Claim | Evidence | Confidence |
|-------|----------|------------|
| Tick rate is too high | Log timestamps show ~13ms between ticks | HIGH |
| Causes validation failure | Log shows `series-tick-mismatch` rejection | HIGH |
| Causes stack overflow | Log shows `Maximum call stack size exceeded` | HIGH |
| Causes memory leak | Correlation only, not causation | LOW |
| Affects typical sessions | Only one session observed | LOW |

## Open Questions

1. **Is device 60161 anomalous?** We only observed one device/session. Is this a common pattern or an edge case?

2. **What triggers the high ingest rate?** ANT+ sensors typically send at 4 Hz, not 77 Hz. Is there message amplification somewhere?

3. **Did the catch-up loop work correctly?** The `_maybeTickTimeline` loop should only tick when `(now - lastTick) >= 5000ms`. Why is it ticking every 13ms?

4. **Is `lastTickTimestamp` being updated?** If the timeline's `lastTickTimestamp` isn't updating, the catch-up loop would keep firing.

## Reproduction Steps (Needed)

To confirm this is a real issue:
1. Start a fitness session with an ANT+ device
2. Monitor tick rate via logs or debug overlay
3. Run for 30+ minutes
4. Check if tick count stays ~360 or inflates to thousands

## Recommendation

**MONITOR** - Telemetry added, awaiting data from next sessions.

### Telemetry Added (2026-01-20)

Location: `FitnessSession.js`

**Metrics tracked:**
- `ingestCalls` - How often device data arrives
- `maybeTickCalls` - How often `_maybeTickTimeline` is invoked
- `actualTicks` - How many timeline ticks actually occur
- `loopIterationsTotal` - Catch-up loop iterations
- `avgLoopIterations` - Average iterations per `_maybeTickTimeline` call

**Log output:** Every 30 seconds during active session:
```json
{
  "event": "fitness.tick_telemetry",
  "ingestRate": "X/sec",
  "maybeTickRate": "X/sec",
  "actualTickRate": "X/sec",
  "expectedTickRate": "0.20/sec",
  "avgLoopIterations": "X.XX",
  "tickCount": N,
  "anomaly": "HIGH_TICK_RATE" | null
}
```

**What to look for:**
- `actualTickRate` >> `expectedTickRate` → confirms tick rate bug
- `avgLoopIterations` > 1 → catch-up loop running multiple times per call
- `ingestRate` very high → device flooding data
- `anomaly: "HIGH_TICK_RATE"` → automatic flag when tick rate > 2x expected

### Next steps:
1. Deploy and run a 30+ minute fitness session
2. Check logs for `fitness.tick_telemetry` entries
3. If `anomaly: HIGH_TICK_RATE` appears, we have reproduction
4. Use `avgLoopIterations` to determine if catch-up loop is the culprit

### If fix is urgent:
Quick mitigation would be to add a guard in `_maybeTickTimeline`:
```js
// Don't tick more than once per interval
if ((targetTimestamp - lastTick) < interval) return;
```

But this might break legitimate catch-up scenarios.

## Conclusion

The symptoms are real (validation failures, stack overflows), but the root cause isn't definitively proven. The evidence suggests a tick rate bug, but we've only observed one session. Recommend adding telemetry and monitoring before implementing a fix.
