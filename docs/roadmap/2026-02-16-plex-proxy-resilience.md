# Plex Proxy Resilience & Circuit Breaker

> Guardrails to prevent Plex outages from cascading into user-facing failures, with automatic detection, graceful degradation, and self-healing

**Last Updated:** 2026-02-16  
**Status:** Design  
**Related Code:** `backend/src/0_system/proxy/ProxyService.mjs`, `backend/src/1_adapters/proxy/PlexProxyAdapter.mjs`  
**Incident:** 2026-02-16 — Plex unresponsive, 60s proxy timeouts, video stalling during fitness sessions

---

## Problem

When Plex goes unresponsive (hung process, network issue, disk I/O), DaylightStation has no resilience:

1. **No health checking** — No proactive detection of Plex failure
2. **No circuit breaker** — Keeps sending requests to a dead service, each waiting 60s
3. **No timeout retries** — Timeouts don't trigger retry logic (only status codes do)
4. **No graceful degradation** — Frontend hangs on stalled video with no fallback
5. **No alerting** — Failures logged but nobody notified
6. **Worst case:** 20 retries × 60s timeout = 20 minutes of blocked requests per client

Current config in `PlexProxyAdapter`:
- Timeout: 60,000ms
- Max retries: 20
- Retry delay: 500ms (no backoff)
- Retries only on 429 / 5xx status codes — **not** on timeouts or connection errors

---

## Design

### 1. Circuit Breaker (ProxyService layer)

Generic circuit breaker usable by any proxy adapter. Lives in `backend/src/0_system/proxy/`.

```
CLOSED ──(failures ≥ threshold)──▶ OPEN
                                      │
                              (resetTimeout elapsed)
                                      │
                                      ▼
                                  HALF_OPEN ──(success × N)──▶ CLOSED
                                      │
                                (any failure)
                                      │
                                      ▼
                                    OPEN
```

**Config per adapter:**

| Parameter | Plex Default | Description |
|-----------|-------------|-------------|
| `failureThreshold` | 5 | Consecutive failures to trip open |
| `resetTimeout` | 60,000ms | Time before trying half-open |
| `halfOpenSuccesses` | 3 | Successes needed to close |
| `countTimeouts` | true | Timeouts count as failures |

**Behavior when OPEN:**
- Immediately return 503 with `Retry-After` header
- Log `proxy.circuit_breaker.open` once (not per request)
- Include `circuitBreaker: 'open'` in response body so frontend can differentiate

**Integration point:** `ProxyService.#proxyWithRetry()` wraps the request in circuit breaker before making the HTTP call.

### 2. Timeout Retry with Exponential Backoff

Change `ProxyService` timeout handler to retry (currently it just 504s):

```javascript
proxyReq.on('timeout', () => {
  proxyReq.destroy();
  
  if (attempt < retryConfig.maxRetries) {
    const delay = retryConfig.delayMs * Math.pow(2, attempt);
    setTimeout(() => {
      this.#proxyWithRetry(adapter, req, res, retryConfig, timeout, attempt + 1)
        .then(resolve);
    }, Math.min(delay, 30000)); // Cap at 30s
    return;
  }
  
  // All retries exhausted
  res.status(504).json({ error: 'Gateway timeout', service: serviceName });
  resolve();
});
```

Also reduce `PlexProxyAdapter` retry count from 20 to 3 for non-streaming requests.

### 3. Request-Type Aware Timeouts

Different Plex operations have different latency profiles:

| Request Pattern | Timeout | Max Retries | Rationale |
|----------------|---------|-------------|-----------|
| `/identity` | 5s | 1 | Health check, must be fast |
| `/library/sections/*` | 10s | 2 | Metadata lookup |
| `/photo/:/transcode/*` | 15s | 2 | Thumbnail generation |
| `/video/:/transcode/*` | 30s | 1 | Video transcoding, long but one-shot |
| `Range` header present | 30s | 0 | Streaming byte-range, no retry |

Implement via `PlexProxyAdapter.getTimeout(req)` and `PlexProxyAdapter.getRetryConfig(req)`.

### 4. Health Monitor (Cron-Based)

Lightweight Plex health check running on the existing cron system:

```yaml
# In cron config
plex_health:
  schedule: "*/30 * * * * *"  # Every 30 seconds
  handler: plexHealthCheck
```

Hits `GET /identity` (fast, requires auth, returns server name). Updates shared state:

```javascript
// Shared state accessible by ProxyService
plexHealth = {
  healthy: true,
  lastCheck: Date.now(),
  consecutiveFailures: 0,
  avgResponseTime: 45,    // Rolling average
  lastError: null
};
```

When `consecutiveFailures ≥ 3`:
- Set `healthy: false`
- Log `plex.health.degraded` (error level)
- Optional: trigger Home Assistant notification via existing HA adapter

When recovering (`healthy: false` → `true`):
- Log `plex.health.recovered`
- Circuit breaker transitions to HALF_OPEN on next request

### 5. Frontend Graceful Degradation

**Video component (`FitnessVideoOverlay`):**
- On 503 with `circuitBreaker: 'open'`: Show "Video temporarily unavailable" banner, continue session without video
- On 504: Show retry spinner with countdown, auto-retry after 5s (max 3 attempts)
- On recovery: Auto-resume video playback

**Playback stall handling:**
- Current `stall_threshold_exceeded` at 15s is good detection
- Add action: after 30s stall, offer "Continue without video" button
- After 60s stall, auto-switch to video-less mode

### 6. Docker Health Checks

Add to Plex service in docker-compose:

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:32400/identity"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 60s
```

Docker will mark container unhealthy and can auto-restart with `restart: unless-stopped`.

---

## Implementation Plan

### Phase 1 — Circuit Breaker + Timeout Retry (1-2 days)

| Task | File | Change |
|------|------|--------|
| Create `CircuitBreaker.mjs` | `backend/src/0_system/proxy/` | New class with CLOSED/OPEN/HALF_OPEN states |
| Integrate into ProxyService | `ProxyService.mjs` | Wrap `#proxyWithRetry` in circuit breaker |
| Add timeout retry | `ProxyService.mjs` | Retry on timeout with exponential backoff |
| Reduce Plex retries | `PlexProxyAdapter.mjs` | 20 → 3 max retries, add backoff |
| Expose circuit state | API router | `GET /api/v1/proxy/health` endpoint |

### Phase 2 — Health Monitor + Docker (1 day)

| Task | File | Change |
|------|------|--------|
| Create `PlexHealthMonitor.mjs` | `backend/src/3_applications/monitoring/` | Cron-based health checks |
| Register cron job | Cron config | 30-second health check schedule |
| Docker health check | `docker-compose.yml` | Plex container healthcheck config |
| Wire health → circuit breaker | ProxyService | Health failures inform circuit state |

### Phase 3 — Frontend Resilience (1 day)

| Task | File | Change |
|------|------|--------|
| Handle 503/circuit-open | Video components | "Video unavailable" fallback |
| Improve stall handling | `FitnessVideoOverlay` | "Continue without video" after 30s |
| Add retry UI | Playback module | Countdown spinner on 504 |

### Phase 4 — Observability (stretch)

| Task | Description |
|------|-------------|
| Proxy metrics | Track request count, latency, failure rate per service |
| Health dashboard widget | Show Plex status on admin dashboard |
| Alert integration | Push notification on sustained failures |

---

## Files Touched

```
backend/src/0_system/proxy/
├── CircuitBreaker.mjs          (new)
├── ProxyService.mjs            (modify — timeout retry, circuit breaker integration)
└── IProxyAdapter.mjs           (modify — add getTimeout(req), getRetryConfig(req))

backend/src/1_adapters/proxy/
└── PlexProxyAdapter.mjs        (modify — request-type timeouts, reduce retries)

backend/src/3_applications/monitoring/
└── PlexHealthMonitor.mjs       (new)

backend/src/4_api/v1/routers/
└── proxy.mjs                   (modify — expose circuit breaker state)

docker/
└── docker-compose.yml          (modify — add healthcheck)

frontend/src/modules/Fitness/
└── components/FitnessVideoOverlay.jsx  (modify — degradation UI)
```

---

## Success Criteria

- Circuit breaker trips within 30s of Plex failure (5 × 5s timeout)
- Subsequent requests fail-fast with 503 (no 60s wait)
- Circuit auto-recovers within 2 minutes of Plex coming back
- Fitness sessions continue without video when Plex is down
- Health check detects failure within 60s
- No manual intervention required for transient Plex outages
