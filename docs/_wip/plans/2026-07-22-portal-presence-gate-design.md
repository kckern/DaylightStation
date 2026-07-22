# Portal presence gate — design

> **Status:** agreed 2026-07-22. Backend + frontend buildable now; the APK half
> needs a flash and on-device verification.

A **physical** parental control for the Portal. The panel is usable only while
specific Bluetooth devices — identified by MAC in config — are connected. The
parent takes the headset off the hook, or switches it off, and School closes.

---

## 1. Why Bluetooth presence is the right lever

The headset gate is not an arbitrary lock bolted onto the app. **Every rung's
prompt is audio.** No headset means the drill genuinely cannot run, so
"disabled" is a description of reality rather than a punishment — which is a far
better thing to explain to a child than "you are not allowed."

The keyboard gate is arbitrary by comparison, so it gets the lighter severity.

| Device | Absent → | What that means |
|---|---|---|
| headset | `disabled` | Screensaver. Audio IS the app. |
| keyboard | `hindered` | `dictation` + `interpretation` leave the ladder; `repetition` (+ `recording`) remain, and sentences **graduate across the gap**. |

The hindered path is **already built and tested** — it is the capability chain
in `2_domains/school/language/ladder.mjs`. When that shipped the comment said
script availability "cannot be detected by any web API, so it is declared per
device." That is true of a *generic* keyboard and false of a *known* keyboard at
a known MAC. The APK replaces the manual localStorage toggle with a real signal;
nothing downstream changes.

---

## 2. Failure behaviour — degrade, never brick

The decision that matters. `portal-keys/README.md` already records a day when a
sleep gesture took the panel off WiFi and **nothing could be verified remotely
for the rest of the session**. A gate that treats "cannot confirm" as "locked"
turns any APK crash or WiFi blip into a dead panel that a child cannot fix and a
parent cannot diagnose. A gate that treats it as "unlocked" fails silently — the
control stops working and nobody finds out until they test it.

So the backend holds the **last known presence with a TTL**:

```
fresh signal (< ttl)   → obey it exactly
stale (> ttl)          → HINDERED
never                  → HINDERED
```

Never full access on a stale signal; never a black screen nobody can clear. A
glitch costs the lesson, not the panel — and killing the APK cannot *unlock*
anything, because stale never resolves upward.

**Debounce is asymmetric, on purpose.** Bluetooth in this house is
documented-flaky (playback-hub: A2DP links that will not hold, adapters losing
PSCAN). Absence must persist `graceMs` (default 30s) before it is reported;
presence is reported **immediately**. Losing the screen mid-sentence because a
headset stuttered for two seconds is the failure that would make this feature
hated.

---

## 3. Where the gate is enforced

**Server-side.** The APK reports to the backend; the backend resolves the gate
and School obeys. The frontend renders what it is told and decides nothing.

A client-only gate is a `div` — a reload could race it, and any frontend bug
opens the lock. Since the backend is already the authority for opening study
sessions, it is the natural place to refuse.

```
Portal APK  ──POST /api/v1/device/presence──▶  backend (in-memory, TTL)
                                                   │
                                   resolveGate(presence, now, config)
                                                   │
                            ┌──────────────────────┴──────────────────┐
                       School API                              School SPA
                  (refuses tracked work)                  (renders the state)
```

In-memory is deliberate and matches School's existing "sessions are in memory by
design": a backend restart loses presence, which resolves to **hindered** — the
safe direction — and the next heartbeat (≤ `heartbeatMs`) restores it.

---

## 4. The contract the APK must satisfy

```http
POST /api/v1/device/presence
{
  "deviceId": "portal",
  "at": "2026-07-22T09:00:00.000Z",
  "devices": [
    { "mac": "AA:BB:CC:DD:EE:FF", "role": "headset",  "connected": true  },
    { "mac": "11:22:33:44:55:66", "role": "keyboard", "connected": false }
  ]
}
```

Sent on every ACL connect/disconnect **and** on a `heartbeatMs` timer (default
60s). The timer is what makes staleness meaningful: without it the backend
cannot tell "still connected" from "APK died".

`connected` is the **debounced** value — the APK owns the grace window, because
it is the only party that sees the raw events.

### APK implementation notes

- `targetSdk 28` means `BLUETOOTH_CONNECT` (API 31 runtime permission) does not
  apply. Install-time `android.permission.BLUETOOTH` is sufficient — no prompt,
  nothing to re-grant after a reboot.
- Keyboard: `BluetoothProfile.HID_HOST`. Headset: `HEADSET` and/or `A2DP`
  (report connected if **either** profile holds it — a headset can be bonded for
  media without SCO).
- `getProfileProxy()` per profile → `getConnectedDevices()` → match MAC
  case-insensitively.
- `ACTION_ACL_CONNECTED` / `ACTION_ACL_DISCONNECTED` for events; poll every
  `heartbeatMs` as a backstop, because ACL broadcasts are not guaranteed.
- New config keys, alongside the existing ones in `Config.java`:
  `gateDevices` (JSON array of `{mac, role}`), `gateGraceMs`, `gateHeartbeatMs`,
  `gateEndpoint`.
- Presence also on `GET /status` so `pkctl` can see it without the backend.

---

## 5. Levels

`open` → everything. `hindered` → browse and listen; typing rungs absent;
**tracked work refused**. `disabled` → screensaver, with a plain statement of
what to reconnect.

A `disabled` screen must always name the remedy ("Connect the headset to
continue") — the same rule the ladder holds for a blocked rung. A lock that does
not say how to open it is the trap this project keeps refusing to build.

---

## 6. Deliberately not built

- **Per-child gates.** The gate is a property of the panel, not the learner.
- **Time-of-day rules.** Physical possession is the control; a schedule is a
  second, weaker one that would need its own override path.
- **Tamper alerting.** Presence transitions land in the event log; nobody is
  paged. A child unplugging a headset is not a security incident.
