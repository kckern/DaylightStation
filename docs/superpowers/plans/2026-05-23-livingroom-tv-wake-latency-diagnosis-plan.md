# Living Room TV Wake Latency — Diagnosis & Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a targeted test that confirms or refutes the working hypothesis (the 5W plug-kill threshold in `script.living_room_tv_off` misreads LG Quick Start mode as failure), then apply the corresponding fix so the plug stays on between sessions and wakes drop from ~73s to 2-5s.

**Architecture:** Two-variant power-trace experiment via HA REST API, decision tree based on settled post-CEC-off wattage, single-line YAML fix in HA scripts (most-likely outcome), end-to-end verification by triggering a real wake.

**Tech Stack:** Home Assistant REST API (host-network on kckern-server), Zigbee plug power telemetry, bash + curl for polling, file-system edits on the HA Docker mount, no DaylightStation code changes expected.

**Reference spec:** `docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md`

**Reference audit:** `docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md`

---

## Environmental notes (read before starting)

- HA runs in **host network mode** on `kckern-server`, so `http://localhost:8123` reaches it directly from the host shell.
- The HA long-lived access token is in `data/household/auth/homeassistant.yml` inside the `daylight-station` container. The `claude` user cannot read the data volume directly — fetch via `sudo docker exec daylight-station`.
- HA config files (the ones we'll edit) are bind-mounted on the host at `/media/kckern/DockerDrive/Docker/Home/homeassistant/` and editable directly (no docker exec needed).
- Reloading HA scripts after editing YAML: HTTP `POST` to `http://localhost:8123/api/services/script/reload` — no full HA restart required.
- The LG TV currently boots from cold in ~73s. Plan for ~3 minutes between "trigger off" and "TV ready to test again" if Variant A leaves the TV in true off (not just Quick Start).
- Recovery: if anything misbehaves, `switch.turn_on switch.living_room_tv_plug` via HA brings the plug back; `script.living_room_tv_on` re-wakes the TV.

---

### Task 0: Stage a session worksheet

**Files:**
- Create: `/tmp/tv-diag-session-$(date +%Y%m%d-%H%M%S)/notes.md`

This task gives later tasks a single place to record observations so the final write-up has all the data in one spot.

- [ ] **Step 1: Create the session directory**

```bash
SESSION_DIR=/tmp/tv-diag-session-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$SESSION_DIR"
echo "Session dir: $SESSION_DIR"
```

Expected output: a path like `/tmp/tv-diag-session-20260523-153000`. Save this path — every subsequent task writes into it.

- [ ] **Step 2: Initialize the notes file**

```bash
cat > "$SESSION_DIR/notes.md" <<'EOF'
# TV Wake Latency Diagnosis Session

Date (UTC): <fill in>
Operator: <fill in>

## Pre-flight state
- TV power (W):
- switch.living_room_tv_plug:
- binary_sensor.living_room_tv_state:
- binary_sensor.living_room_tv_power:
- media_player.living_room_tv:

## Variant A results
(see variant-a.tsv for raw trace)
- Settled power at t+60s:
- Settled power at t+120s:
- Settled power at t+180s:
- Decision row (1/2/3):

## Variant B results (if run)
(see variant-b.tsv for raw trace)
- Iterations of off-loop that ran:
- Settled power at t+180s:
- Decision row (1/2/3):

## Fix applied
- File:
- Line(s) changed:
- Threshold before / after:

## Post-fix verification
- session-end plug state:
- next-wake elapsed (button to playback):
EOF
echo "Worksheet ready at $SESSION_DIR/notes.md"
```

Expected output: `Worksheet ready at /tmp/tv-diag-session-…/notes.md`

No commit needed yet — this is a scratch worksheet on the host.

---

### Task 1: Pre-flight — confirm TV is in a testable state

**Files:**
- Read: HA states via REST API
- Write: `$SESSION_DIR/preflight.json`

- [ ] **Step 1: Fetch the HA token**

```bash
TOKEN=$(sudo docker exec daylight-station sh -c 'grep token data/household/auth/homeassistant.yml | cut -d" " -f2')
echo "Token length: ${#TOKEN}"
```

Expected output: a length somewhere in 100-200. If you get `0`, the secret file shape changed — open `data/household/auth/homeassistant.yml` and grab whatever key holds the token.

- [ ] **Step 2: Verify HA is reachable**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost:8123/api/
```

Expected output: `200`. If `401`, the token is wrong. If `000` or connection refused, HA isn't running on host port 8123 — `sudo docker ps | grep homeassistant` to check.

- [ ] **Step 3: Snapshot pre-flight entity states**

```bash
ENTS='sensor.living_room_tv_plug_power,binary_sensor.living_room_tv_state,binary_sensor.living_room_tv_power,switch.living_room_tv_plug,media_player.living_room_tv'

for e in $(echo $ENTS | tr ',' ' '); do
  state=$(curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8123/api/states/$e" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d['entity_id']} = {d['state']}\")")
  echo "$state"
done | tee "$SESSION_DIR/preflight.txt"
```

Expected output, *for a TV that's already on*:
```
sensor.living_room_tv_plug_power = 35.x  (or higher — should be >30W)
binary_sensor.living_room_tv_state = on
binary_sensor.living_room_tv_power = on
switch.living_room_tv_plug = on
media_player.living_room_tv = on
```

**If the TV is not on**, wake it first: `curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"entity_id":"script.living_room_tv_on"}' http://localhost:8123/api/services/script/turn_on`, then wait 90 seconds and re-snapshot. The test requires a TV that's actually drawing >30W (backlight on) so the post-off transition is measurable.

- [ ] **Step 4: Record the snapshot in the worksheet**

Manually copy/paste the `preflight.txt` contents into the `## Pre-flight state` section of `$SESSION_DIR/notes.md`.

No commit yet.

---

### Task 2: Write the data-capture poller

**Files:**
- Create: `$SESSION_DIR/poll.sh`

The poller runs in the background during Variants A and B, sampling the four key entities every 2 seconds and writing a TSV trace to a file path passed as an argument.

- [ ] **Step 1: Write the poll script**

```bash
cat > "$SESSION_DIR/poll.sh" <<'POLL'
#!/usr/bin/env bash
# Usage: poll.sh <output-tsv> <duration-seconds>
set -euo pipefail
OUT="${1:?missing output path}"
DUR="${2:-180}"

TOKEN=$(sudo docker exec daylight-station sh -c 'grep token data/household/auth/homeassistant.yml | cut -d" " -f2')
START=$(date +%s)
END=$((START + DUR))

echo -e "elapsed_s\tts_utc\tplug_power_w\ttv_state\ttv_power\ttv_plug\tmedia_player" > "$OUT"

while [ "$(date +%s)" -lt "$END" ]; do
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ELAPSED=$(($(date +%s) - START))
  read W BS_STATE BS_POWER SWITCH MP < <(
    curl -s -H "Authorization: Bearer $TOKEN" \
      "http://localhost:8123/api/states/sensor.living_room_tv_plug_power" \
      "http://localhost:8123/api/states/binary_sensor.living_room_tv_state" \
      "http://localhost:8123/api/states/binary_sensor.living_room_tv_power" \
      "http://localhost:8123/api/states/switch.living_room_tv_plug" \
      "http://localhost:8123/api/states/media_player.living_room_tv" \
      | python3 -c "
import sys, json
parts = sys.stdin.read().strip()
# Five JSON objects concatenated; parse them in order
dec = json.JSONDecoder()
out = []
idx = 0
while idx < len(parts):
    while idx < len(parts) and parts[idx].isspace():
        idx += 1
    if idx >= len(parts):
        break
    obj, end = dec.raw_decode(parts, idx)
    out.append(obj.get('state','?'))
    idx = end
print(' '.join(out))
"
  )
  echo -e "${ELAPSED}\t${TS}\t${W}\t${BS_STATE}\t${BS_POWER}\t${SWITCH}\t${MP}" >> "$OUT"
  sleep 2
done
POLL
chmod +x "$SESSION_DIR/poll.sh"
echo "Poller ready at $SESSION_DIR/poll.sh"
```

Expected output: `Poller ready at /tmp/tv-diag-session-…/poll.sh`

- [ ] **Step 2: Smoke-test the poller (5 seconds)**

```bash
"$SESSION_DIR/poll.sh" "$SESSION_DIR/smoke.tsv" 5
cat "$SESSION_DIR/smoke.tsv"
```

Expected output: header line + 2-3 data rows, each showing the current power reading, the four entity states. The `plug_power_w` column should match the pre-flight snapshot from Task 1 Step 3.

If the columns are empty or `?`, the inline Python parser couldn't split the concatenated JSON — fall back to five separate curl calls (one per entity) in the loop.

- [ ] **Step 3: Remove the smoke output**

```bash
rm "$SESSION_DIR/smoke.tsv"
```

No commit yet (this is all under `/tmp/`).

---

### Task 3: Variant A — run `media_player.turn_off` and capture the trace

**Files:**
- Read: `$SESSION_DIR/poll.sh`
- Write: `$SESSION_DIR/variant-a.tsv`

- [ ] **Step 1: Re-confirm the TV is on and drawing >30W**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8123/api/states/sensor.living_room_tv_plug_power" \
  | python3 -c "import sys,json; print('power:', json.load(sys.stdin)['state'], 'W')"
```

Expected output: `power: 35.x W` or higher. If less than 30W, the TV is not in a state where this test produces a meaningful signal — run `script.living_room_tv_on` and wait 90 seconds before continuing.

- [ ] **Step 2: Start the poller in the background, 180-second window**

```bash
"$SESSION_DIR/poll.sh" "$SESSION_DIR/variant-a.tsv" 180 &
POLLER_PID=$!
echo "Poller PID: $POLLER_PID"
# Give it 3 seconds of baseline before triggering the off command
sleep 3
```

- [ ] **Step 3: Trigger `media_player.turn_off` via HA service call**

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id":"media_player.living_room_tv"}' \
  http://localhost:8123/api/services/media_player/turn_off
echo
date -u +"CEC-off issued at %Y-%m-%dT%H:%M:%SZ"
```

Expected output: HA returns a JSON array of affected states (often empty `[]` — that's fine, the service was accepted). Then the timestamp line. Note this timestamp — it's `t=0` for the analysis.

- [ ] **Step 4: Wait for the poller to finish (~3 minutes total)**

```bash
wait $POLLER_PID
echo "Poller done. Output: $SESSION_DIR/variant-a.tsv"
```

Expected: blocks until the 180s window closes, then prints the done message.

- [ ] **Step 5: Inspect the trace**

```bash
echo "=== Header + first 5 rows ==="
head -6 "$SESSION_DIR/variant-a.tsv"
echo
echo "=== Power at key elapsed marks ==="
awk -F'\t' 'NR==1 || $1==30 || $1==60 || $1==90 || $1==120 || $1==150 || $1==178 || $1==180' "$SESSION_DIR/variant-a.tsv"
echo
echo "=== Final 3 rows ==="
tail -3 "$SESSION_DIR/variant-a.tsv"
```

Expected output: the trace's power column drops from the starting >30W to some settled value. Determine the settled value by looking at the final ~30 seconds.

- [ ] **Step 6: Classify the result (record in the worksheet)**

Open `$SESSION_DIR/notes.md` and fill in the `## Variant A results` section. Specifically:
- Power at t+60s, t+120s, t+180s (from the awk output)
- Decision row:
  - **Row 1** if settled power is in 8-15W band → hypothesis confirmed, skip Variant B and go directly to Task 5
  - **Row 2** if settled power stays >25W → Variant B is required to see if the script's iteration loop succeeds where a single `media_player.turn_off` failed
  - **Row 3** if settled power drops below 2W → also confirmed-but-different (plug-kill wouldn't fire); Variant B optional, primarily to confirm script-path consistency

No commit yet.

---

### Task 4: Variant B (conditional) — run `script.living_room_tv_off` with plug-kill bypassed

**Skip this task entirely if Variant A landed in Row 1 with clean data.**

**Files:**
- Modify: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml` (temporary edit + restore)
- Write: `$SESSION_DIR/variant-b.tsv`
- Write: `$SESSION_DIR/living_room_tv_off.yaml.backup`

- [ ] **Step 1: Re-wake the TV if it's currently off**

```bash
power=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8123/api/states/sensor.living_room_tv_plug_power | python3 -c "import sys,json; print(float(json.load(sys.stdin)['state']))")
echo "Current power: $power W"
if [ "$(echo "$power < 30" | bc -l)" = "1" ]; then
  echo "Waking TV…"
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"entity_id":"script.living_room_tv_on"}' \
    http://localhost:8123/api/services/script/turn_on
  echo "Waiting 90s for the TV to come up…"
  sleep 90
fi
```

Expected output: either `Current power: 35.x W` (skip wake) or `Waking TV…` followed by a 90s wait.

- [ ] **Step 2: Back up the off-script file**

```bash
cp /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml \
   "$SESSION_DIR/living_room_tv_off.yaml.backup"
diff -q /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml "$SESSION_DIR/living_room_tv_off.yaml.backup"
```

Expected: `diff -q` produces no output (files identical). The backup is your restore source if anything goes wrong in Step 3.

- [ ] **Step 3: Comment out the plug-kill block**

Edit `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml`. Find this section near the end:

```yaml
- if:
  - condition: template
    value_template: "{{ states('sensor.living_room_tv_plug_power') | float(0) > 5 }}"
  then:
  - action: switch.turn_off
    target:
      entity_id: switch.living_room_tv_plug
```

Replace it with this (every line commented; comment block annotates why):

```yaml
# TEMPORARY: plug-kill disabled for wake-latency diagnosis (2026-05-23).
# Restore after running Variant B. See docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md
# - if:
#   - condition: template
#     value_template: "{{ states('sensor.living_room_tv_plug_power') | float(0) > 5 }}"
#   then:
#   - action: switch.turn_off
#     target:
#       entity_id: switch.living_room_tv_plug
```

Verify the YAML still parses (no service call yet — just check syntactically):

```bash
python3 -c "import yaml; yaml.safe_load(open('/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml'))" && echo "YAML OK"
```

Expected output: `YAML OK`. If yaml raises, restore from backup (`cp $SESSION_DIR/living_room_tv_off.yaml.backup /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml`) and re-edit.

- [ ] **Step 4: Reload HA scripts**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8123/api/services/script/reload
echo "Scripts reloaded"
```

Expected output: empty response then `Scripts reloaded`. (HA returns 200 with empty body on successful service calls.)

- [ ] **Step 5: Start poller, trigger script.living_room_tv_off, wait**

```bash
"$SESSION_DIR/poll.sh" "$SESSION_DIR/variant-b.tsv" 180 &
POLLER_PID=$!
sleep 3
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id":"script.living_room_tv_off"}' \
  http://localhost:8123/api/services/script/turn_on
date -u +"script.living_room_tv_off issued at %Y-%m-%dT%H:%M:%SZ"
wait $POLLER_PID
echo "Poller done."
```

Expected: 3 minutes of background polling, identical mechanics to Variant A.

- [ ] **Step 6: Inspect the trace and the HA logbook to count iterations**

```bash
echo "=== Variant B power profile ==="
awk -F'\t' 'NR==1 || $1==15 || $1==30 || $1==45 || $1==60 || $1==90 || $1==120 || $1==180' "$SESSION_DIR/variant-b.tsv"

echo
echo "=== Off-script iterations from HA logbook ==="
NOW=$(date -u -d "5 minutes ago" +%Y-%m-%dT%H:%M:%S.000Z)
LATER=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8123/api/logbook/$NOW?end_time=$LATER" \
  | python3 -c "
import sys, json
for e in json.load(sys.stdin):
    name = e.get('name','')
    eid  = e.get('entity_id','')
    if 'living_room_tv' in (name+eid).lower() or 'media_player.turn_off' in (e.get('message','') or ''):
        print(e.get('when',''), '|', name, '|', e.get('message','') or eid)
"
```

Expected output:
- Power profile shows the same shape as Variant A but possibly with cleaner steps as each iteration runs
- Logbook shows a sequence of `media_player.turn_off`, `remote.turn_off`, and (after the 15s delay each) the next iteration

- [ ] **Step 7: Restore the off-script and reload**

```bash
cp "$SESSION_DIR/living_room_tv_off.yaml.backup" \
   /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml
diff -q "$SESSION_DIR/living_room_tv_off.yaml.backup" \
        /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8123/api/services/script/reload
echo "Restored and reloaded"
```

Expected: `diff -q` produces no output (file restored byte-for-byte), then `Restored and reloaded`. **Do not skip this step** — leaving plug-kill bypassed risks an actual zombie-wake-on-the-cheap scenario where the TV stays drawing power because the safety net is off.

- [ ] **Step 8: Record results in worksheet**

Open `$SESSION_DIR/notes.md`, fill in the `## Variant B results` section. Classify the row using the same criteria as Task 3 Step 6.

No commit yet.

---

### Task 5: Apply the fix based on findings

This task has three branches, one per decision row. Execute only the branch that matches your results.

#### Branch 1 — Row 1 (settled at 8-15W, hypothesis confirmed)

**Files:**
- Modify: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml`
- Modify: `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/living_room_timer_power_cycle_shield.yaml` (if it has the same threshold)

- [ ] **Step 1: Update the off-script threshold from 5 to 25**

Edit `/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml`. Find:

```yaml
- if:
  - condition: template
    value_template: "{{ states('sensor.living_room_tv_plug_power') | float(0) > 5 }}"
  then:
  - action: switch.turn_off
    target:
      entity_id: switch.living_room_tv_plug
```

Change to:

```yaml
# Plug-kill safety net. 25W threshold distinguishes LG Quick Start standby
# (~10W, "off but fast-wake ready") from stuck-on-screen (>30W, backlight lit).
# Raised from 5W on 2026-05-23 after the lower threshold systematically
# misread Quick Start as failure. See docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md
- if:
  - condition: template
    value_template: "{{ states('sensor.living_room_tv_plug_power') | float(0) > 25 }}"
  then:
  - action: switch.turn_off
    target:
      entity_id: switch.living_room_tv_plug
```

Verify YAML parses:

```bash
python3 -c "import yaml; yaml.safe_load(open('/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/scripts/living_room_tv_off.yaml'))" && echo "YAML OK"
```

Expected: `YAML OK`.

- [ ] **Step 2: Check whether `living_room_timer_power_cycle_shield.yaml` has the same plug-kill pattern**

```bash
grep -n "tv_plug_power\|switch.turn_off" /media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/living_room_timer_power_cycle_shield.yaml
```

Expected output: a few line numbers. If you see a `value_template` referencing `tv_plug_power | float(0) > 5` *anywhere in this file*, that's a second copy of the same bug — fix it identically (Step 3). If the file uses `binary_sensor.living_room_tv_state` instead of the power sensor as the fallback gate, leave it alone; that path is different and the audit can address it separately if it ever fires.

From an earlier read this file uses `binary_sensor.living_room_tv_state` (not the power sensor) for its fallback gate — so most likely no edit needed here. Confirm before changing anything.

- [ ] **Step 3 (only if Step 2 found a power-threshold copy): apply the same change**

If the file had `tv_plug_power | float(0) > 5`, change it to `> 25` using the same comment block.

Verify YAML parses:

```bash
python3 -c "import yaml; yaml.safe_load(open('/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/living_room_timer_power_cycle_shield.yaml'))" && echo "YAML OK"
```

- [ ] **Step 4: Reload HA scripts and automations**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8123/api/services/script/reload
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8123/api/services/automation/reload
echo "Reloaded"
```

Expected: empty responses from both, then `Reloaded`.

- [ ] **Step 5: Commit (HA-side change)**

The HA configs are version-controlled separately. Commit there:

```bash
cd /media/kckern/DockerDrive/Docker/Home/homeassistant
git status
git diff _includes/scripts/living_room_tv_off.yaml
git add _includes/scripts/living_room_tv_off.yaml
# also add _includes/automations/living_room_timer_power_cycle_shield.yaml if Step 3 modified it
git commit -m "fix(living-room-tv): raise plug-kill threshold from 5W to 25W

LG OLED Quick Start standby draws ~10W. The previous 5W threshold
misread this as 'CEC-off didn't take', forcing a plug-kill on every
session-end and a 73s cold-boot on next wake.

25W cleanly separates Quick Start (~10W) from stuck-on-screen (>30W).
With plug now staying on between sessions, next-wake latency drops
from ~73s to 2-5s.

See: DaylightStation docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md"
```

Expected: `git diff` shows the threshold change. `git commit` succeeds. Push if applicable.

#### Branch 2 — Row 2 (settled at >30W, CEC-off didn't take)

- [ ] **Step 1: Do not change any threshold.** Record the finding in `$SESSION_DIR/notes.md` and skip to Task 7 to write a follow-up diagnosis.

- [ ] **Step 2: As a stopgap, apply the audit's R1**

Edit `data/household/config/devices.yml` inside the daylight-station container (or via the Dropbox mount on macOS workstations). Under `livingroom-tv.device_control`, add:

```yaml
device_control:
  powerOnWaitOptions:
    timeoutMs: 80000
    pollIntervalMs: 2000
  displays:
    tv:
      ...
      powerOnRetries: 1
```

This is a safety belt for the unmoved cold-boot path; not the real fix. Restart `daylight-station` after the change:

```bash
sudo docker exec daylight-station sh -c "cat data/household/config/devices.yml" | head -40  # verify
sudo docker restart daylight-station
```

#### Branch 3 — Row 3 (settled at <2W, plug-kill not firing)

- [ ] **Step 1: Find what's actually toggling the plug.** Do not modify the off script. Record in worksheet and write up a follow-up diagnosis covering: plug-off automations not yet found, dashboard toggles, mobile-app toggles, Zigbee2MQTT misbehavior.

---

### Task 6: End-to-end verification

**Files:**
- Read: HA states, `switch.living_room_tv_plug` history
- Read: `sudo docker logs daylight-station`

**Only run this if Branch 1 was applied.** Branch 2 and Branch 3 each have their own verification under their respective follow-ups.

- [ ] **Step 1: Confirm TV is currently on**

```bash
power=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8123/api/states/sensor.living_room_tv_plug_power | python3 -c "import sys,json; print(float(json.load(sys.stdin)['state']))")
echo "Power: $power W"
```

Expected: >30W. If not, wake it via `script.living_room_tv_on` and wait 90s.

- [ ] **Step 2: Trigger the fixed off-script and watch for 90s**

```bash
"$SESSION_DIR/poll.sh" "$SESSION_DIR/verify-off.tsv" 90 &
POLLER_PID=$!
sleep 3
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id":"script.living_room_tv_off"}' \
  http://localhost:8123/api/services/script/turn_on
wait $POLLER_PID
tail -5 "$SESSION_DIR/verify-off.tsv"
```

Expected: the final rows show `tv_plug = on` (plug stayed on, the fix worked) and `plug_power_w` settled in the 8-15W band.

If `tv_plug = off`, the threshold change isn't catching the Quick Start band — either the YAML edit didn't reload, or the actual settled power is above 25W for this specific TV. Re-inspect the trace and adjust the threshold.

- [ ] **Step 3: Trigger a wake and measure latency**

```bash
"$SESSION_DIR/poll.sh" "$SESSION_DIR/verify-on.tsv" 30 &
POLLER_PID=$!
sleep 3
date -u +"Wake-and-load trigger at %Y-%m-%dT%H:%M:%SZ"
curl -s "http://localhost:3111/api/v1/device/livingroom-tv/load?queue=slow-tv&shader=minimal&shuffle=1" > "$SESSION_DIR/wake-response.json"
date -u +"Wake-and-load response at %Y-%m-%dT%H:%M:%SZ"
wait $POLLER_PID
echo "=== Wake response ==="
cat "$SESSION_DIR/wake-response.json" | python3 -m json.tool | head -30
echo
echo "=== Power profile during wake ==="
awk -F'\t' 'NR==1 || NR%2==0' "$SESSION_DIR/verify-on.tsv"
```

Expected:
- `wake-response.json` has `"ok": true` and `"totalElapsedMs"` in the 3000-8000 range (vs ~80000 before the fix)
- No `power.unverified` warning in the docker logs (verified in Step 4)
- The power profile in `verify-on.tsv` shows the TV jumping from ~10W (Quick Start standby) to >30W (backlight lit) within 5 seconds of the trigger

- [ ] **Step 4: Verify no `wake-and-load.power.unverified` in the docker logs**

```bash
sudo docker logs daylight-station --since 5m 2>&1 | grep -E "wake-and-load\.(power\.unverified|retry\.start|power\.done|complete)" | tail -10
```

Expected output: a `wake-and-load.power.done verified:true elapsedMs:XXXX` with XXXX in the low thousands (a few seconds), `wake-and-load.complete totalElapsedMs:XXXX` similarly low, **no** `power.unverified` and **no** `retry.start`.

- [ ] **Step 5: Record results in worksheet**

Fill in the `## Post-fix verification` section of `$SESSION_DIR/notes.md`:
- Session-end plug state (from Step 2 trace)
- Settled power during standby (from Step 2 trace)
- Next-wake elapsed (from Step 3 response)
- Whether `power.unverified` was absent (from Step 4)

---

### Task 7: Update the audit document

**Files:**
- Modify: `docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md`

- [ ] **Step 1: Append a postmortem section**

Open the audit and append a new section at the end (after section 8):

```markdown
---

## 9. Postmortem (2026-05-23, after diagnosis)

The root cause turned out to be in `script.living_room_tv_off`, not in DaylightStation's `WakeAndLoadService`:

- **Settled power after CEC-off (measured):** XX W (matches the 8-15W Quick Start band)
- **Bug:** the script's plug-kill fallback fired at any power > 5W, misreading Quick Start standby (~10W) as "CEC-off didn't take". This forced a plug-kill on every session-end, which forced a 73s cold-boot on the next wake.
- **Fix:** raised the threshold from 5W to 25W in `_includes/scripts/living_room_tv_off.yaml`. Quick Start counts as off; stuck-on-screen (>30W) still triggers the safety net.
- **Verified wake latency post-fix:** XX seconds (vs ~80s pre-fix).

### Status of original recommendations

- **R1 (longer polling timeout):** downgraded to safety belt. The cold-boot path is now rare (only after genuine power loss). Optional cleanup, not urgent.
- **R2 (parallel content load):** deferred. With wakes at 2-5s, orchestration overhead is no longer the bottleneck.
- **R3 (reachable template sensor):** deferred. Same reasoning.
- **R4 (cross-check other devices):** still valid as orthogonal cleanup.
- **R5 (refresh stale HA arch doc):** still valid; describes a script structure that no longer exists.

Reference: `docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md`
```

Replace `XX` placeholders with the actual measurements from `$SESSION_DIR/notes.md`.

- [ ] **Step 2: Commit (DaylightStation side)**

```bash
cd /opt/Code/DaylightStation
git status
git diff docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md
git add docs/_wip/audits/2026-05-23-livingroom-tv-power-verify-timeout-mismatch-audit.md
git add docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md
git add docs/superpowers/plans/2026-05-23-livingroom-tv-wake-latency-diagnosis-plan.md
git commit -m "docs(livingroom-tv): audit postmortem + diagnosis spec/plan

Confirmed the wake latency root cause was the plug-kill threshold in
\`script.living_room_tv_off\` (5W vs LG Quick Start's ~10W draw).
HA-side fix landed separately; this commit captures the design spec,
implementation plan, and audit postmortem on the DaylightStation side."
```

Expected: `git status` shows three new/modified files. Commit succeeds.

Per CLAUDE.md, don't push without explicit user approval — the user reviews commits before they go upstream.

---

## Self-review notes (inline)

**Spec coverage:**
- Spec §3 Variant A → Task 3 ✓
- Spec §3 Variant B → Task 4 ✓
- Spec §4 decision tree → Task 5 Branches 1/2/3 ✓
- Spec §5 implementation order → Task 1 → 3 → 4 → 5 → 6 → 7 ✓
- Spec §7 success criteria → Task 6 Steps 3-5 ✓
- Spec §8 related docs → updated audit in Task 7 ✓

**Placeholder scan:** None. All steps have concrete commands, file paths, and expected outputs. The `XX` placeholders in Task 7 Step 1 are intentional (filled with measured values at execution time).

**Type/name consistency:**
- `$SESSION_DIR` and `$TOKEN` are introduced in Task 0/1 and used consistently
- `poll.sh` signature `<output-tsv> <duration-seconds>` matches all three call sites
- File paths to the HA scripts are byte-identical across tasks
- TSV column names (`elapsed_s`, `ts_utc`, `plug_power_w`, …) match between Task 2 writer and Task 3/4/6 readers

**Scope check:** Plan stays within the single subsystem (LG TV wake latency). Out-of-scope items from the spec stay deferred.
