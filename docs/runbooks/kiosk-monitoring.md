# Kiosk Browser Monitoring & Auto-Recovery

**Created:** 2026-03-11  
**Server:** homeserver.local  
**Browser:** Brave (kiosk mode)  
**Display:** Sway (Wayland compositor)

## Overview

Automated monitoring and recovery system to prevent the kiosk browser from becoming unresponsive or crashing.

## Components

### 1. Watchdog Script

**Location:** `/usr/local/bin/kiosk-watchdog.sh`

**What it does:**
- Checks if Brave is running
- Verifies Chrome DevTools Protocol port (9222) is responsive
- Tracks consecutive failures
- Auto-restarts browser after 3 failed health checks
- Logs all actions to `/home/kckern/kiosk-watchdog.log`

**Health check criteria:**
- Process check: `pgrep -u kckern -f "brave.*--kiosk"`
- Port check: `curl http://localhost:9222/json`

### 2. Systemd Timer (Continuous Monitoring)

**Service:** `kiosk-watchdog.service`  
**Timer:** `kiosk-watchdog.timer`

**Schedule:**
- Runs 2 minutes after boot
- Runs every 3 minutes thereafter

**Status check:**
```bash
ssh homeserver.local 'sudo systemctl status kiosk-watchdog.timer'
```

**Manual trigger:**
```bash
ssh homeserver.local 'sudo systemctl start kiosk-watchdog.service'
```

### 3. Daily Preventive Restart

**Service:** `kiosk-daily-restart.service`  
**Timer:** `kiosk-daily-restart.timer`

**Schedule:** 3:00 AM daily

Preventively restarts the browser to clear memory leaks, hung tabs, or accumulated state issues.

**Next scheduled run:**
```bash
ssh homeserver.local 'sudo systemctl list-timers kiosk-daily-restart.timer'
```

## Logs

| Log File | Purpose |
|----------|---------|
| `/home/kckern/kiosk-watchdog.log` | Watchdog health checks and restarts |
| `/home/kckern/browser-kiosk.log` | Manual browser launch script logs |
| `journalctl -u kiosk-watchdog.service` | Systemd service logs |

**View recent watchdog activity:**
```bash
ssh homeserver.local 'tail -50 /home/kckern/kiosk-watchdog.log'
```

## Manual Operations

### Check Browser Status
```bash
ssh homeserver.local 'ps aux | grep brave | grep kiosk | grep -v grep'
ssh homeserver.local 'curl -s http://localhost:9222/json | jq'
```

### Manual Restart
```bash
ssh homeserver.local 'sudo systemctl start kiosk-watchdog.service'
```

OR directly:
```bash
ssh homeserver.local 'pkill brave; sleep 3; sudo -u kckern bash -c "export WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/1000 DISPLAY=:0; brave-browser --kiosk --no-first-run --disable-infobars --enable-features=WebUIDarkMode,VaapiVideoDecoder --ozone-platform=wayland --remote-debugging-port=9222 https://daylightlocal.kckern.net/screen/office >/dev/null 2>&1 &"'
```

### Disable Monitoring (if needed)
```bash
ssh homeserver.local 'sudo systemctl stop kiosk-watchdog.timer'
ssh homeserver.local 'sudo systemctl disable kiosk-watchdog.timer'
```

### Re-enable Monitoring
```bash
ssh homeserver.local 'sudo systemctl enable --now kiosk-watchdog.timer'
```

## Failure Scenarios

### Browser Crash
- **Detection:** Process check fails
- **Action:** Immediate restart via watchdog

### Browser Hung/Unresponsive
- **Detection:** DevTools port unresponsive for 3 consecutive checks (9 minutes)
- **Action:** Force kill and restart

### Memory Leak / Long-Running Issues
- **Detection:** Scheduled daily restart at 3 AM
- **Action:** Preventive restart regardless of health

## Configuration

### Tuning Health Check Frequency

Edit timer interval:
```bash
ssh homeserver.local 'sudo systemctl edit kiosk-watchdog.timer'
```

Change `OnUnitActiveSec=3min` to desired interval.

### Tuning Failure Threshold

Edit `/usr/local/bin/kiosk-watchdog.sh`:
```bash
MAX_UNRESPONSIVE_COUNT=3  # Change to 2 for faster recovery, 5 for more lenient
```

### Change Daily Restart Time

Edit timer:
```bash
ssh homeserver.local 'sudo systemctl edit kiosk-daily-restart.timer'
```

Change `OnCalendar=*-*-* 03:00:00` to desired time.

## Troubleshooting

### Watchdog Not Running
```bash
ssh homeserver.local 'sudo systemctl status kiosk-watchdog.timer'
ssh homeserver.local 'sudo systemctl start kiosk-watchdog.timer'
```

### Browser Keeps Failing to Start
Check environment variables in watchdog script:
- `WAYLAND_DISPLAY=wayland-1`
- `XDG_RUNTIME_DIR=/run/user/1000`
- `DISPLAY=:0`

Verify Sway is running:
```bash
ssh homeserver.local 'ps aux | grep sway | grep -v grep'
```

### DevTools Port Not Responding
Check if another process is using port 9222:
```bash
ssh homeserver.local 'lsof -i :9222'
```

## Architecture Notes

- **Wayland required:** Brave is launched with `--ozone-platform=wayland` because the kiosk runs under Sway
- **Remote debugging:** Port 9222 enables health checks and remote browser control
- **Sudo required:** Watchdog runs as root to kill/restart processes owned by kckern user
- **No nested scripts:** Watchdog launches Brave directly, not via `/home/kckern/browser-kiosk.sh` to avoid startup delays during recovery

## Future Improvements

Potential enhancements:
- [ ] Monitor CPU/memory usage and restart if excessive
- [ ] WebSocket connection check to verify page is actually responsive
- [ ] Alert/notification on repeated failures
- [ ] Metrics collection (uptime, restart frequency)
- [ ] Integration with Home Assistant for status reporting
