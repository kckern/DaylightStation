# Portal presence gate — design

> **Status:** revised 2026-07-22 after an adversarial review that found six
> field-fatal problems, all corrected below before the APK was written — which
> was the point of reviewing first. Backend implemented; **APK not started.**
>
> **Unresolved and blocking the APK:** the idle-sleep numbers in §2a must be
> measured on the real headset and keyboard before any grace constant is
> frozen, and `BluetoothProfile.HID_HOST` must be confirmed reachable from an
> untrusted app on this panel (§4). Both are "measured, not assumed" items.

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
| keyboard | `hindered` | `dictation` + `interpretation` leave the ladder; `repetition` (+ `recording`) remain **and still record**, and sentences **graduate across the gap**. |

> The first implementation refused *every* attempt unless the gate was fully
> open, so a child was shown a repetition drill, did it, and was told to
> "connect the keyboard" for a rung needing no keyboard. Gating is now
> **per rung** (`allowsRung`), resolved against the same requirement the queue
> uses — the recorder and the queue cannot disagree about what is doable.

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
stale (> ttl)          → HINDERED   (and refuses all tracked work)
never                  → HINDERED
```

`hindered` **permits the rungs whose hardware is present** but `stale` refuses
everything: hindered means we know what is missing, stale means we do not know
anything, and guessing generously is how a gate stops being a gate.

**`disabled` decays to `hindered` when reports stop.** This is deliberate and
worth stating plainly, because the earlier claim that "killing the APK cannot
unlock anything" was false in that direction. Availability wins: a child must
not be locked out of everything by a crash. The residual bypass — kill the
reporter, wait out the TTL, regain browse-and-listen — is accepted, because the
alternative is a dead panel nobody can clear.

**`disabled` renders a screensaver with the display ON.** Not display-off. On
this panel the display going off **drops WiFi** (`portal-keys/README.md`), which
would kill the very reports that maintain `disabled` — the lock would switch
itself off. `fkb keepawake` is a hard precondition of arming the gate, enforced
the same way `screenToggleEnabled` is preflight-gated.

Never full access on a stale signal, and never a black screen nobody can clear.
A glitch costs the lesson, not the panel.

**Debounce is asymmetric, on purpose.** Absence must persist before it is
reported; presence is reported **immediately**.

### 2a. Grace is PER ROLE, and the numbers are unmeasured

A single 30s grace was calibrated for A2DP flapping and is wrong for the thing
that will actually happen. **Bluetooth HID keyboards idle-sleep** — typically
minutes — and reconnect on keypress. A child doing twenty minutes of audio rungs
has an idle keyboard, which is indistinguishable from a confiscated one.
Headsets power off after their own idle timeout, and their batteries die.

So "the parent took it" and "it went to sleep" look identical on the wire, and
the only lever is how long we wait. Grace is therefore per role, and the
constants are **to be measured on the actual hardware** before being frozen:

| role | grace | why |
|---|---|---|
| headset | seconds (~30) | absence is meaningful fast; audio is the app |
| keyboard | minutes, > its idle timeout | must outlast idle sleep, or the gate misfires constantly |

Consider also treating the keyboard as present when *bonded and recently seen*
rather than *link currently up*. Decide after measuring.

**Server-stamped freshness.** The backend stamps `receivedAt` on arrival and
judges staleness on that alone. The client's `at` is stored for skew diagnostics
and never trusted: a panel with a slow clock would be permanently stale with
every device connected, and a single POST carrying a future `at` would hold the
gate open indefinitely.

---

## 3. Where the gate is enforced

**Server-side.** The APK reports to the backend; the backend resolves the gate
and School obeys. The frontend renders what it is told and decides nothing.

A client-only gate is a `div` — a reload could race it, and any frontend bug
opens the lock. Since the backend is already the authority for opening study
sessions, it is the natural place to refuse.

```
Portal APK ─POST /device/{id}/presence─▶ backend (in-memory, TTL, seq-guarded)
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
POST /api/v1/device/{deviceId}/presence
{
  "at":          "2026-07-22T09:00:00.000Z",   // diagnostics only; NEVER trusted for freshness
  "seq":         42,                            // monotonic; a regression is dropped
  "uptimeMs":    3600000,                       // "did the APK restart" is the first question
  "version":     "1.2.0",
  "heartbeatMs": 60000,                         // so the backend can warn if TTL < heartbeat
  "devices": [                                  // ALL bonded devices, not a configured subset
    { "mac": "AA:BB:CC:DD:EE:FF", "connected": true  },
    { "mac": "11:22:33:44:55:66", "connected": false }
  ]
}
```

**The APK does not know which devices matter.** It reports every bonded device
and their connection state; the backend owns the required list and the roles.
An earlier draft had `gateDevices` in the APK config *and* `gate.devices` in
`school.yml` — two lists of the same fact, so replacing a dead headset in one
place and not the other would strand the gate at `disabled` with the new headset
connected and nothing detecting the drift. `role` is therefore **not** in the
report; severity comes from config alone.

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
  `gateGraceMsByRole` (or a headset/keyboard pair), `gateHeartbeatMs`,
  `gateEndpoint`, `gateToken`. **No device list** — see above.
- `ControlServer.handleConfig` whitelists keys and rejects unknowns, so each new
  key must be added there; presence on `GET /status` means extending `status()`.
- `BluetoothProfile.HID_HOST` is a hidden/SystemApi constant. **Verify on the
  panel in the first spike** whether an untrusted app can obtain that proxy; if
  not, fall back to bonded-devices + ACL events. Do not assume.

---

## 4a. Operations

- `GET /api/v1/device/{deviceId}/presence` returns the last report, the **recent
  transitions**, and the **resolved gate** — the endpoint the "it locked and I
  do not know why" question is answered from. A last-value-only store could not
  answer it after the fact.
- `gate.force: open | closed | auto` in `school.yml`, re-read on **every**
  resolution rather than cached at boot, so relieving a misfiring gate is a
  config edit and not a container restart. For a control that will sometimes be
  wrong, the recovery path cannot be ops work.
- An unrecognised role fails **open** (a typo must not brick a panel) and now
  **warns at boot**, because failing open silently is the exact "nobody finds
  out" mode this design rejects.
- A closed gate returns **HTTP 423** with `{level, missing, stale}`, not a 403.
  The SPA has to tell "gate closed" from "not signed in" to render a remedy
  screen rather than a toast.

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
- **Tamper alerting.** Presence transitions are kept in a ring buffer; nobody is
  paged. A child unplugging a headset is not a security incident.
- **Authenticating the presence POST beyond a shared token.** Worth the token
  (it closes the casual-curl hole and costs nothing), and worth no more than
  that: the School API itself has no auth, so a LAN-capable teenager can POST
  attempts directly and skip the drills entirely. Hardening only this endpoint
  while that stands would be theatre. The honest scope of this control is young
  children and accidents, which is what it was asked to cover.
