# The living-room Shield lost mains power mid-lesson

**Status:** root cause identified, not yet fixed
**Impact:** a child's coursework was interrupted; the TV lost signal with no warning
**Date:** 2026-09-09, ~13:44 PDT

---

## What happened

The Shield went dark in the middle of a reading session. The TV lost its HDMI
signal, the device did not respond, and it had to be power-cycled by hand.

It was a **real power loss**, not a crash and not a page reload:

```
sys.boot.reason      = cold
ro.boot.bootreason   = cold
/proc/uptime         = 287.5s at 20:49:04Z  ->  boot at 20:44:16Z
```

`cold` is Android's code for "came up from a hard power-off". A software
reboot, an `adb reboot`, an app crash and a WebView reload each report
something else, so this one value rules all of them out.

Before this the kiosk browser had been running continuously since
**2025-10-06** — eleven months. This is the first such event in that window.

---

## Timeline (UTC)

| Time | Event |
|---|---|
| 11:00:00 → 11:00:10 | Scheduled nightly Shield power-cycle (04:00 local). Normal. |
| 20:19:2x | App container redeployed. **The living-room page did not reload**; the kiosk rode straight through it. |
| 20:35:49 | Living-room page reloaded. No kiosk restart — a page reload, not a device event. |
| 20:39:23 | A `getScreenshot` read (operator) |
| ~20:43:1x | A second `getScreenshot` read (operator) |
| **20:43:24.744** | **The Shield's smart plug stops reporting.** Last values 6.8 W / 121.2 V, after reporting every ~5s. |
| 20:43:56 | A `deviceInfo` read succeeds — the Shield is alive and the kiosk is on its eleven-month-old process. |
| **20:44:16** | **The Shield cold-boots.** |
| 20:44:43 | Kiosk browser starts |
| 20:44:52 | `/screen/living-room` loads |
| 20:47:00 | The plug reports again: 121.2 V, 8.1 W |

---

## What it was not

Each of these was checked and cleared:

- **Not the application.** The backend holds no reference to the Shield's plug
  entity and has no code path that can call `switch.turn_off` on it.
- **Not the nightly power-cycle automation.** It is time-triggered only and had
  already run normally at 04:00 local.
- **Not the container redeploy.** The living-room page booted at 19:43, 20:35:49
  and 20:44:52 — none of them at the deploy. The kiosk process survived it.
- **Not Home Assistant commanding the plug.** The switch entity's last state
  change was ten hours earlier, at the scheduled cycle.
- **Not the two kiosk REST reads.** They are read-only HTTP calls to the kiosk
  app. They cannot open a mains relay, and `boot.reason = cold` means power was
  physically removed. (Recorded here because they were the last things to touch
  the device, and "we were poking it at the time" deserves to be written down
  rather than left out.)

---

## Most likely cause: the smart plug

The plug the Shield is powered through **went off-network at 20:43:24, fifty-two
seconds before the Shield died**, and stayed silent through the whole event,
returning at 20:47. Its `power_on_behavior` is `on`, which is why mains came
back on its own.

That plug has a fault history: it went `unavailable` six times in about six
hours on 2026-09-02/03.

### The instrument went blind at exactly the wrong moment

Because the plug was off-network, Home Assistant never saw a state change — the
switch entity read `on` for the entire outage. **HA cannot say whether the relay
opened, because it was not listening.** The failure and the loss of the evidence
about the failure have the same cause, which is the part that most needs fixing:
the next occurrence will be just as unprovable.

---

## Why nothing alerted

`power_outage_detection` requires **three or more** plugs to go `unavailable`
before it notifies — it is built for a house-wide outage. A single plug dropping
is exactly this failure, and it raises nothing at all.

---

## Recommended fixes, in order

1. **Take the Shield off the smart plug.** The plug exists only to enable the
   04:00 power-cycle. That convenience is currently wired in series with a
   child's lesson, and it is the one component here with a fault history.
2. **If the nightly reboot is still wanted, do it over ADB** (`adb reboot`)
   rather than by cutting mains. The same automation already drives the Shield
   over ADB in a later phase, so the transport is proven.
3. **Alert on a SINGLE plug going unavailable** for 60s, not three. The
   house-wide detector should stay; this is a second, quieter rule.
4. **Alarm on unexpected Shield restarts** — the kiosk's `lastAppStart` moving
   outside the scheduled window is a one-line check and would have paged before
   anyone noticed the TV.

---

## How to re-check this if it recurs

The two values that settled it, in order of usefulness:

```bash
# 1. Did it lose power, or did something restart it?
adb connect <shield-ip>:5555
adb -s <shield-ip>:5555 shell "getprop sys.boot.reason; cat /proc/uptime"

# 2. When did the kiosk process actually start?
#    (`lastAppStart` in the kiosk's deviceInfo — compare against the 04:00 window)
```

Then read the plug's power sensor history around that moment. A plug that stops
reporting entirely — rather than reporting a drop to ~0 W — is off-network, and
its switch state for that window means nothing.
