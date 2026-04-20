# Fitness Player Recovery Runbook

## Symptom: Video won't start — stuck on "Recovering…" indefinitely

### Diagnostic command

Inspect the most recent fitness session log:

```bash
sudo docker exec daylight-station sh -c 'ls -t media/logs/fitness | head -1 | xargs -I {} tail -n 200 media/logs/fitness/{}'
```

Look for the pattern of events below.

### Sequence A — Stale transcode session (auto-recovers now)

1. `dash.error` code 28 repeatedly, message contains `/transcode/universal/session/<uuid>/0/header`
2. `playback.stale-session-detected` fires (after 3 errors in 10s)
3. `resilience-recovery` with `reason: "stale-session-detected"`
4. `playback.stream-url-refreshed` with `previousSrc` and `nextSrc` (the nextSrc ends in `_refresh=<timestamp>`)
5. `dash.manifest-loaded` (fresh manifest)
6. `dash.playback-started`

**Action:** None. The fix is working end-to-end.

If you see Sequence A repeatedly for the same episode within minutes, Plex itself may be under resource pressure — check `sudo docker stats plex`.

### Sequence B — Plex-side failure (auto-recovery exhausts)

1. `dash.error` code 28 repeatedly
2. `playback.stream-url-refreshed` does fire — but…
3. …the new session UUIDs also return 404 immediately
4. After 5 attempts, `resilience-recovery-exhausted` fires with `urlRefreshesAttempted: 4` (or similar)
5. User-facing "Retry playback" button appears

**Action:**

- `sudo docker logs plex --tail 100` — look for OOM / transcode crashes / licensed-codec errors
- `curl -s http://localhost:32400/identity` — confirm Plex is up at all
- `sudo docker restart plex` then wait 60s before tapping Retry

### Sequence C — Backend proxy misrouting

1. `dash.error` code 28 on URLs that do NOT contain `/session/<uuid>/`
2. Watchdog does not escalate (it filters on code 28 only, but the URL shape suggests the backend proxy is returning something unexpected)

**Action:** The proxy may have cached a bad response. Restart the app:
```bash
sudo docker restart daylight-station
```

## Architecture pointer

See `frontend/src/modules/Player/README.media-resilience.md` for the full
recovery pipeline (watchdog → resilience state machine → Player →
VideoPlayer hardReset) and the list of observability events.

## Key files

- `frontend/src/modules/Player/lib/staleSessionWatchdog.js` — sliding-window error counter
- `frontend/src/modules/Player/hooks/useMediaResilience.js` — recovery state machine, `shouldRefreshUrlForReason` predicate
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx` — `hardReset` with `refreshUrl` branch, `appendRefreshParam` helper
- `frontend/src/modules/Player/Player.jsx` — `handleResilienceReload` forwards `refreshUrl`
