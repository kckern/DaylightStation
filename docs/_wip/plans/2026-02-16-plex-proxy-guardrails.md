# Plex Proxy Guardrails

## Problem

On 2026-02-16, Plex became unresponsive causing:
- 60-second proxy timeouts in DaylightStation
- Video stalling in fitness sessions
- Poor user experience with no graceful degradation
- No automatic recovery mechanism

## Current State

### Proxy Configuration
- **Timeout:** 60 seconds (PlexProxyAdapter.getTimeout())
- **Max retries:** 20 attempts
- **Retry delay:** 500ms
- **Retry conditions:** Only 429 (rate limit) and 5xx errors

### Issues
1. **No health checking** - No proactive monitoring of Plex availability
2. **No timeout retries** - Timeouts don't trigger retries (only status code errors do)
3. **No circuit breaker** - Continues hammering failed service
4. **No graceful degradation** - Frontend doesn't handle proxy failures well
5. **No alerting** - Failures are logged but no notifications
6. **No auto-recovery** - Manual restart required

## Proposed Guardrails

### 1. Health Monitoring Service

Create a health check system for Plex:

```javascript
// backend/src/3_applications/monitoring/PlexHealthMonitor.mjs

export class PlexHealthMonitor {
  #plexAdapter;
  #logger;
  #state = {
    healthy: true,
    lastCheck: null,
    consecutiveFailures: 0,
    lastError: null
  };

  constructor({ plexAdapter, logger }) {
    this.#plexAdapter = plexAdapter;
    this.#logger = logger;
  }

  /**
   * Check Plex health via lightweight endpoint
   * @returns {Promise<{ healthy: boolean, responseTime: number }>}
   */
  async check() {
    const start = Date.now();
    try {
      // Use Plex's identity endpoint (fast, requires auth)
      const response = await fetch(
        `${this.#plexAdapter.getBaseUrl()}/identity?X-Plex-Token=${token}`,
        { timeout: 5000 }
      );
      
      const responseTime = Date.now() - start;
      
      if (response.ok) {
        this.#state.healthy = true;
        this.#state.consecutiveFailures = 0;
        this.#state.lastCheck = Date.now();
        
        return { healthy: true, responseTime };
      }
      
      this.#handleFailure('Non-OK status', response.status);
      return { healthy: false, responseTime };
      
    } catch (error) {
      this.#handleFailure(error.message);
      return { healthy: false, responseTime: Date.now() - start };
    }
  }

  #handleFailure(reason, statusCode = null) {
    this.#state.consecutiveFailures++;
    this.#state.lastError = { reason, statusCode, timestamp: Date.now() };
    
    if (this.#state.consecutiveFailures >= 3) {
      this.#state.healthy = false;
      this.#logger.error?.('plex.health.failed', {
        consecutiveFailures: this.#state.consecutiveFailures,
        lastError: this.#state.lastError
      });
    }
  }

  isHealthy() {
    return this.#state.healthy;
  }

  getState() {
    return { ...this.#state };
  }
}
```

**Schedule:** Every 30 seconds via cron job

### 2. Circuit Breaker Pattern

Add circuit breaker to ProxyService:

```javascript
// backend/src/0_system/proxy/CircuitBreaker.mjs

export class CircuitBreaker {
  #state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
  #failureCount = 0;
  #successCount = 0;
  #lastFailureTime = null;
  #config;

  constructor(config = {}) {
    this.#config = {
      failureThreshold: config.failureThreshold || 5,
      resetTimeout: config.resetTimeout || 60000, // 1 min
      halfOpenRequests: config.halfOpenRequests || 3,
      ...config
    };
  }

  async execute(fn) {
    if (this.#state === 'OPEN') {
      if (Date.now() - this.#lastFailureTime > this.#config.resetTimeout) {
        this.#state = 'HALF_OPEN';
        this.#successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (error) {
      this.#onFailure();
      throw error;
    }
  }

  #onSuccess() {
    this.#failureCount = 0;
    
    if (this.#state === 'HALF_OPEN') {
      this.#successCount++;
      if (this.#successCount >= this.#config.halfOpenRequests) {
        this.#state = 'CLOSED';
        this.#successCount = 0;
      }
    }
  }

  #onFailure() {
    this.#failureCount++;
    this.#lastFailureTime = Date.now();
    
    if (this.#failureCount >= this.#config.failureThreshold) {
      this.#state = 'OPEN';
    }
  }

  getState() {
    return this.#state;
  }
}
```

**Integration:** Wrap all proxy requests in circuit breaker

### 3. Retry on Timeout

Modify ProxyService to retry timeouts:

```javascript
// In ProxyService.mjs

proxyReq.on('timeout', () => {
  proxyReq.destroy();
  this.#logger.error?.('proxy.timeout', {
    service: serviceName,
    timeout,
    attempt
  });

  // NEW: Retry timeouts like server errors
  if (attempt < retryConfig.maxRetries) {
    this.#logger.debug?.('proxy.retry.timeout', {
      service: serviceName,
      attempt: attempt + 1,
      maxRetries: retryConfig.maxRetries
    });

    setTimeout(() => {
      this.#proxyWithRetry(adapter, req, res, retryConfig, timeout, attempt + 1)
        .then(resolve);
    }, retryConfig.delayMs * Math.pow(2, attempt)); // Exponential backoff
    return;
  }

  if (!res.headersSent) {
    res.status(504).json({
      error: 'Gateway timeout',
      service: serviceName
    });
  }
  resolve();
});
```

### 4. Frontend Graceful Degradation

Add better error handling in video components:

```javascript
// In fitness video loading

if (error.status === 504) {
  // Gateway timeout - show friendly message
  showNotification({
    type: 'warning',
    message: 'Video server is slow to respond. Retrying...',
    duration: 5000
  });
  
  // Retry with exponential backoff
  await retryWithBackoff(() => loadVideo(url), {
    maxAttempts: 3,
    initialDelay: 2000
  });
}
```

### 5. Timeout Configuration Tuning

**Current:** 60 seconds is too long for user-facing requests

**Recommended:**
- **Light requests** (metadata, thumbnails): 10 seconds
- **Video stream requests**: 30 seconds
- **Transcode requests**: 60 seconds

Update PlexProxyAdapter:

```javascript
getTimeout(req) {
  // Determine timeout based on request type
  if (req.url.includes('/video/')) {
    return 30000; // Video streaming
  }
  if (req.url.includes('/transcode/')) {
    return 60000; // Transcode operations
  }
  return 10000; // Metadata and thumbnails
}
```

### 6. Docker Health Checks

Add health checks to docker-compose.yml:

```yaml
services:
  plex:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:32400/identity"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
```

### 7. Auto-Restart on Failure

Add restart policy in docker-compose.yml:

```yaml
services:
  plex:
    restart: unless-stopped
    deploy:
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
```

### 8. Alerting

Send alerts when health fails:

```javascript
// In PlexHealthMonitor

#handleFailure(reason, statusCode = null) {
  // ... existing code ...
  
  if (this.#state.consecutiveFailures === 3) {
    // Send alert via configured notification system
    await notificationService.send({
      channel: 'system',
      severity: 'error',
      title: 'Plex Health Check Failed',
      message: `Plex has failed ${this.#state.consecutiveFailures} consecutive health checks`,
      details: this.#state.lastError
    });
  }
}
```

### 9. Metrics and Monitoring

Track Plex proxy metrics:

```javascript
// Add to ProxyService

#trackMetrics(serviceName, attempt, duration, statusCode, success) {
  metricsService.record('proxy.request', {
    service: serviceName,
    attempt,
    duration,
    statusCode,
    success,
    timestamp: Date.now()
  });
}
```

### 10. Fallback Behavior

When Plex is unavailable:

```javascript
// In video loading logic

if (plexUnavailable) {
  // Show cached thumbnail instead of video
  // Or show "Service temporarily unavailable" message
  // Continue fitness session without video
}
```

## Implementation Priority

### Phase 1 (Immediate - 1 day)
1. ✅ Add timeout retries to ProxyService
2. ✅ Implement circuit breaker
3. ✅ Add docker health checks

### Phase 2 (Short-term - 1 week)
4. ☐ Create PlexHealthMonitor service
5. ☐ Add frontend graceful degradation
6. ☐ Implement timeout tuning based on request type

### Phase 3 (Medium-term - 2 weeks)
7. ☐ Add alerting system
8. ☐ Implement metrics tracking
9. ☐ Add fallback behavior for fitness
10. ☐ Create monitoring dashboard

## Testing Strategy

### Unit Tests
- Circuit breaker state transitions
- Timeout retry logic
- Health monitor failure detection

### Integration Tests
- Plex proxy with circuit breaker
- Health monitor with real/mock Plex
- Frontend error handling

### Manual Testing
- Use `enablePlexShutoff()` to simulate Plex failures
- Verify circuit breaker opens after threshold
- Confirm graceful degradation in UI
- Test auto-recovery when Plex comes back

## Runbook Updates

Create `docs/runbooks/plex-proxy-troubleshooting.md`:

```markdown
# Plex Proxy Troubleshooting

## Symptoms
- Video fails to load in fitness sessions
- 504 Gateway Timeout errors in logs
- `proxy.timeout` events in backend logs

## Diagnosis
1. Check Plex health: `curl http://homeserver.local:32400/identity`
2. Check circuit breaker state: `GET /api/v1/health/plex`
3. Check docker logs: `ssh homeserver.local 'docker logs plex --tail 100'`

## Resolution
1. Restart Plex: `ssh homeserver.local 'docker restart plex'`
2. Wait 30s for health check to recover
3. Circuit breaker will auto-close after 3 successes
4. If persistent, check Plex media mounts

## Prevention
- Monitor `/api/v1/health/plex` endpoint
- Set up alerts for consecutive failures
- Ensure docker health checks are configured
```

## Success Metrics

- **Recovery time:** < 2 minutes (from failure detection to auto-recovery)
- **User impact:** < 30 seconds of degraded experience
- **Alert latency:** < 1 minute from failure to notification
- **False positive rate:** < 1% of health checks

## Related Issues

- 2026-02-16: Plex unresponsive causing video failures
- See logs: `logs/prod-session-fs_20260216093800.txt`
