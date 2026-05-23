# Living Room TV Wake Latency — Diagnosis Design

**Date:** 2026-05-23
**Goal:** Drive button-press-to-playback latency on `livingroom-tv` to a local minimum within existing design constraints, by **diagnosing first, fixing second**.
**Related audit:** `docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md`

---

## 1. Background

The audit established that a cold kitchen-button trigger to `livingroom-tv` takes ~82 seconds end-to-end. Of that, ~73s is the LG TV physically getting from `plug off` to "backlight drawing >30W". The remaining ~9s is content load.

The audit initially proposed three fixes (longer polling timeout, parallel load, reachable-template sensor). On reflection, those fixes only *tolerate* the 73s cold boot — they don't ask why it's happening.

The user's reaction was the right one: **"that should only happen as last resort, not be default."** And in fact the HA configs agree — `script.living_room_tv_off` is structured to try CEC-off 5× and only kill the plug if power stays above a threshold. The plug-kill is explicitly designed as a fallback. But the plug history shows it's firing in practice (`switch.living_room_tv_plug` was off for 11 of the last 24 hours, including overnight). So the fallback is effectively the default path.

The diagnosis needs to answer: **why is the fallback firing, and can we stop it?**

---

## 2. Working Hypothesis

**The 5W plug-kill threshold in `script.living_room_tv_off` is incompatible with the LG TV's "Quick Start" pseudo-standby power profile. CEC-off is working correctly; the script systematically misreads its success as failure and pulls the plug.**

### 2.1 Evidence already in hand

From the captured cold-boot telemetry (`sensor.living_room_tv_plug_power` during the 2026-05-23 15:37 trigger):

| Time after plug-on | Power | Inferred TV state |
|---:|---:|---|
| +3s | 8.1 W | TV controller booting |
| +5s | 9.9 W | early standby |
| +10s | 12.1 W | WebOS up, screen off |
| +32s | 10.7 W | **steady "WebOS up, screen off"** |
| +73s | 35.6 W | backlight ignited |

The TV settles at **10-13W during "WebOS up, screen off"**. This is the textbook signature of LG WebOS "Quick Start" mode — the mode where CEC WAKEUP can wake the screen in 2-3s.

### 2.2 The script's plug-kill logic

`<HA>/_includes/scripts/living_room_tv_off.yaml`:

```yaml
- if:
  - condition: template
    value_template: "{{ states('sensor.living_room_tv_plug_power') | float(0) > 5 }}"
  then:
  - action: switch.turn_off
    target:
      entity_id: switch.living_room_tv_plug
```

After running the CEC-off iteration loop, the script checks if the plug is still drawing >5W. The TV in Quick Start standby draws ~10W. So **every successful CEC-off triggers the plug-kill**, regardless of whether CEC-off worked.

### 2.3 Why this is the bug

The script's own comment captures the design intent:

> "LG OLED true standby is <1W; ~30W means it's still in pseudo-on (Quick Start / kiosk with screen off / etc) and the network/IR off didn't fully take."

But ~10W is **not** "didn't fully take" — it's exactly Quick Start working as designed. The TV is in its fastest-wake state. The threshold conflates "screen still lit" (~30W+) with "Quick Start standby" (~10W).

The cost of this misdiagnosis is a forced cold boot on the next wake: ~73s instead of ~3s. ~70 seconds per wake event.

---

## 3. Test Protocol

A single targeted experiment, ~15 minutes of active time. The objective is to observe what `sensor.living_room_tv_plug_power` does in the 60-180s window after CEC-off, *without* allowing the plug-kill fallback to fire and contaminate the measurement.

### 3.1 Setup

**Pre-conditions:**
- TV is on (content playing or just `media_player.living_room_tv = on`)
- `switch.living_room_tv_plug = on`
- `sensor.living_room_tv_plug_power ≥ 30W`
- Shield is on, FKB foreground
- Operator has HA Developer Tools open with `sensor.living_room_tv_plug_power` pinned to the live States view

### 3.2 Variant A — `media_player.turn_off` only (cleanest signal)

1. Snapshot baseline: power, `media_player.living_room_tv` state, `binary_sensor.living_room_tv_state`, `binary_sensor.living_room_tv_power`
2. Call HA service: `media_player.turn_off` on `media_player.living_room_tv` (single CEC-off attempt, no retry loop, no plug-kill)
3. Watch power for 3 minutes. Record every transition.
4. Capture: time-series of power readings, time each binary sensor flipped (if it did), settled wattage at t = 60s, 120s, 180s.

This tests the cleanest path: one HA off command, no script wrapper. If the TV settles in the 8-15W band, the lg_webos integration is doing its job and the script's surrounding logic is the problem.

### 3.3 Variant B — `script.living_room_tv_off` with plug-kill bypassed

1. Edit `<HA>/_includes/scripts/living_room_tv_off.yaml`: comment out the entire trailing `- if: … then: switch.turn_off …` block (keep the CEC-off loop intact)
2. `reload_config.sh` (or HA UI → Server Management → Reload Scripts)
3. Confirm TV is back on (Variant A may have left it off; turn it back on via the dashboard or by calling `script.living_room_tv_on`)
4. Trigger `script.living_room_tv_off` manually via HA Developer Tools
5. Watch power for 3 minutes
6. Capture same data as Variant A, plus: how many iterations of the loop ran, what `binary_sensor.living_room_tv_state` reported during each iteration
7. **Restore the script** (uncomment the plug-kill block) and reload

This tests the realistic production path. If the iterations succeed (loop exits because `binary_sensor.living_room_tv_state` flipped off) and power settles at 8-15W, the script's iteration logic is fine and only the final threshold check is wrong.

### 3.4 Data capture format

For each variant, record:

```
Variant: A | B
Test start (UTC): YYYY-MM-DD HH:MM:SS
Pre-test power: __ W
CEC-off command issued at: HH:MM:SS

Power time series:
  t+0s    __ W   media_player=?  binary_sensor.living_room_tv_state=?
  t+5s    __ W   ...
  t+15s   __ W   ...
  t+30s   __ W   ...
  t+60s   __ W   ...
  t+120s  __ W   ...
  t+180s  __ W   ...

Settled power at t+180s: __ W
binary_sensor.living_room_tv_state final: on | off
binary_sensor.living_room_tv_power final: on | off
media_player.living_room_tv final: on | off | unavailable
Plug-kill fired (Variant B only, expected: no): yes | no
```

This is a one-shot test, not a multi-day passive collection. The hypothesis is sharp enough that one good measurement decides.

---

## 4. Decision Tree

Three possible shapes for the settled (t = 60-180s) power profile, each with a clear fix path:

### Row 1 — Settled at 8-15W (hypothesis confirmed)

**Interpretation:** CEC-off works. TV is in Quick Start. The 5W threshold is the bug.

**Fix:** raise the plug-kill threshold in `script.living_room_tv_off` and `living_room_timer_power_cycle_shield` from 5W to 25W. Quick Start (10W) counts as off; stuck-on-screen (>30W with backlight) still triggers the safety net.

**Expected outcome:**
- Wake from button press: **2-5 seconds** (Shield is up, FKB is up, only the TV display needs to wake from Quick Start)
- Plug stays on between sessions; TV idles at ~10W (≈$0.50/month vampire draw)
- The audit's R1-R3 become safety belts for the truly rare power-outage scenarios, not workarounds for daily behavior

### Row 2 — Settled at >30W persisting (CEC-off genuinely not taking)

**Interpretation:** Hypothesis wrong. CEC-off isn't reaching the TV or the TV is ignoring it.

**Fix:** out of scope for this spec. Trigger a follow-up diagnosis covering: lg_webos integration health (`media_player.living_room_tv` connection status), Shield ADB CEC path (does `remote.turn_off` on `remote.shield_android_tv` actually issue CEC? Or just close the Shield UI?), HDMI-CEC bus state.

**Provisional action:** keep current plug-kill behavior. Don't change anything until the follow-up diagnosis runs. The audit's R1 (longer polling timeout) becomes the only safe immediate fix.

### Row 3 — Settled at <2W (true off, plug-kill should not be firing)

**Interpretation:** CEC-off works AND drops the TV to deep standby. The plug-kill check would not fire. Hypothesis wrong about the cause; plug must be getting cut by something else.

**Fix:** correlate plug-off timestamps with HA logbook to find what's actually toggling the plug. Candidates: `living_room_timer_power_cycle_shield` (4am — but plug-history shows mid-evening flips, so probably not this), dashboard manual toggle, mobile app, another automation we haven't found, Zigbee2MQTT misbehavior.

**Provisional action:** add a "who turned off the plug?" automation that snapshots context (user_id, parent_id of the state-change event) every time `switch.living_room_tv_plug` transitions to off. Run for a week.

---

## 5. Implementation Order

1. **Run Variant A** (≤5 minutes). If row 1, this is enough to confirm. If row 2 or 3, proceed to Variant B for more detail.
2. **Run Variant B** if needed (≤10 minutes including script edit + reload + restore).
3. **Apply fix matching the row.** For row 1, this is a one-line YAML edit per script. For row 2, write the follow-up diagnosis. For row 3, install the snapshot automation.
4. **Verify** (next cold-or-warm trigger after the fix lands):
   - Plug should stay on after a normal session-end
   - Next wake should be 2-5s, not 73s
   - No spurious `wake-and-load.power.unverified` warnings
   - Zombie Wake Guard still arms/disarms correctly overnight
5. **Update the audit** at `docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md` to reflect the actual root cause and downgrade R1-R3 from urgent to safety-belt status.

---

## 6. Out of Scope

The following are real concerns but explicitly deferred:

- **R2 (parallel content load in WakeAndLoadService)** — if the fix above lands and wakes drop to 2-5s, parallel loading offers diminishing returns. Reconsider only if measurements show orchestration overhead still dominates.
- **R3 (new `binary_sensor.living_room_tv_reachable` template)** — same argument. With Quick Start working, the 30W threshold sensor flips fast enough that a faster signal isn't needed.
- **CEC-off path failures (row 2)** — covered above; needs its own diagnosis spec.
- **Other devices' state_sensor mismatches (audit R4)** — orthogonal cleanup, not part of this work.
- **HA architecture doc refresh (audit R5)** — should happen but doesn't block this fix.

---

## 7. Success Criteria

The diagnosis is complete when we can state, with one measurement to back it up:

- The settled power profile post-CEC-off for this specific TV
- Which row of the decision tree it matches
- The exact line(s) to change (for row 1) or the next investigation to run (for row 2/3)

The fix is complete when:

- A cold-or-warm trigger to `livingroom-tv` from a sessions-ended state results in playback in <10s (for Quick Start path), with no `wake-and-load.power.unverified` warning in the backend logs
- The plug history shows `switch.living_room_tv_plug` remaining `on` across at least 3 normal session-end events

---

## 8. Related Documents

- `docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md` — the symptom-side analysis that prompted this diagnosis
- `<HA>/docs/living_room_tv_architecture.md` — HA-side architecture (note: contains stale description of `script.living_room_tv_on`; audit R5 calls for refresh)
- `<HA>/_includes/scripts/living_room_tv_off.yaml` — the file containing the suspected bug
- `<HA>/_includes/scripts/living_room_tv_on.yaml` — the wake script we expect to become trivially fast once Quick Start is preserved
- `<HA>/_includes/automations/living_room_timer_power_cycle_shield.yaml` — 4am Shield power cycle; contains a second copy of the same plug-kill pattern that may need the same fix
