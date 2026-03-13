# BLE Heart Rate Support

Extends the fitness sensor stack to accept heart rate data from standard BLE heart rate monitors (Apple Watch, Polar, Garmin, etc.) alongside existing ANT+ devices.

## Motivation

Some participants use BLE-only devices (e.g., Apple Watch) that cannot broadcast over ANT+. BLE HR support allows them to appear on the fitness dashboard alongside ANT+ users with no frontend changes.

## Architecture

```
BLE HR Device (Apple Watch, etc.)
    │  BLE advertisement: HR Service 0x180D
    ▼
┌──────────────────────────────────┐
│  BLEManager (fitness extension)  │
│  - Python bleak scan subprocess  │
│  - Discovers 0x180D advertisers  │
│  - Connects, subscribes to 0x2A37│
│  - Best-effort user matching     │
│  - BleHeartRateDecoder parses    │
│    GATT packets → BPM            │
└──────────────┬───────────────────┘
               │  WebSocket broadcast
               │  (type: 'ant', profile: 'HR')
               ▼
        DaylightStation backend → frontend
        (same path as ANT+ HR data)
```

### Key Design Decisions

1. **Scan-based discovery, no pairing** — BLE devices (especially Apple Watch) rotate MAC addresses. The scanner discovers any device advertising HR Service UUID 0x180D, connects, and streams data. No Bluetooth pairing step required.

2. **Best-effort user matching** — Discovered BLE HR devices are matched to configured `ble_users` via a priority cascade:
   - Known device name match
   - Single unmatched device + single unmatched user → auto-assign
   - Multiple simultaneous unknown devices would require future enhancement (name matching or UI claiming)

3. **Frontend-transparent** — BLE HR messages use `type: 'ant'` with `data.ComputedHeartRate`, so the frontend's DeviceEventRouter handles them identically to ANT+ HR. Zero frontend changes needed.

4. **Pluggable decoder pattern** — `BleHeartRateDecoder` follows the same interface as `RenphoJumpropeDecoder`: `processPacket()`, `formatForWebSocket()`, `reset()`.

## GATT Heart Rate Measurement (0x2A37)

The standard BLE Heart Rate Measurement characteristic:

| Byte | Field | Description |
|------|-------|-------------|
| 0 | Flags | Bit 0: format (0=UINT8, 1=UINT16). Bits 1-2: sensor contact status |
| 1 | HR value | UINT8 BPM (if flag bit 0 = 0) |
| 1-2 | HR value | UINT16 little-endian BPM (if flag bit 0 = 1) |
| 3+ | RR-intervals | Optional (not used) |

## Configuration

### Environment Variable

`BLE_HR_USERS` — comma-separated list of user IDs expected to connect via BLE HR. Set in docker-compose or passed directly.

```yaml
# docker-compose.yaml
environment:
  - BLE_HR_USERS=user1,user2
```

### Fitness Config (fitness.yml)

BLE HR users need entries in the device mapping with synthetic device IDs:

```yaml
devices:
  heart_rate:
    12345: user_a        # ANT+ numeric ID
    ble_user_b: user_b   # BLE (auto-matched, synthetic ID)

ble_users:
  - user_b               # users expected via BLE HR

device_colors:
  heart_rate:
    ble_user_b: purple
```

## WebSocket Message Format

BLE HR broadcasts the same shape as ANT+ HR:

```json
{
  "topic": "fitness",
  "source": "fitness",
  "type": "ant",
  "profile": "HR",
  "deviceId": "ble_user_b",
  "timestamp": "2026-03-08T12:00:00.000Z",
  "data": {
    "ComputedHeartRate": 128,
    "sensorContact": true,
    "source": "ble"
  }
}
```

The `data.source: 'ble'` field is metadata only — not used for routing.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ble/hr/start` | GET | Start BLE HR scanning |
| `/ble/hr/stop` | GET | Stop BLE HR scanning |
| `/status` | GET | Includes `hr_scan` section with running state, configured users, matched devices |

## Files

| File | Purpose |
|------|---------|
| `_extensions/fitness/src/decoders/heart_rate.mjs` | GATT 0x2A37 packet parser |
| `_extensions/fitness/src/ble.mjs` | BLEManager — HR scan mode, Python subprocess, user matching |
| `_extensions/fitness/src/server.mjs` | Config loading, auto-start, API endpoints |
| `_extensions/fitness/simulation-heartrate.mjs` | HR simulator for testing |

## Testing

### Simulator

```bash
# Simulate BLE HR data without real hardware
node _extensions/fitness/simulation-heartrate.mjs --duration=60 --user=testuser

# Options:
#   --duration=SECONDS  (default: 120)
#   --user=USER_ID      (default: grannie)
#   --resting=BPM       (default: 72)
```

The simulator sends data directly via WebSocket, bypassing the BLE scan layer. Useful for verifying frontend integration.

### Real Device Testing

1. Ensure the fitness extension container has Bluetooth access (privileged mode, host network, dbus mounts)
2. The BLE HR user must have an active Workout session on their device (Apple Watch only broadcasts HR during workouts)
3. Check logs: `docker logs daylight-fitness --tail=50 -f`
4. Look for: `Found BLE HR device`, `Matched HR device`, `BLE HR (userId): N bpm`

## Limitations

- **Apple Watch requires active Workout** — HR is only broadcast over BLE during an active Workout app session
- **MAC address rotation** — handled by scan-based discovery (no address-based config)
- **Single BLE HR user works best** — best-effort matching is reliable for one unmatched device + one unmatched user. Multiple simultaneous unknown BLE HR devices need enhanced matching
- **Bluetooth range** — ~10 meters from the Bluetooth adapter on the fitness host
