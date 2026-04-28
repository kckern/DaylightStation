# NFC multi-scan + TV powering off mid-track

**Reported:** 2026-04-27 (after deploy of trigger end-behavior commits `fc112a217`..`62adde623`)
**Severity:** Medium (functional but disruptive UX)
**Status:** **Root cause confirmed for both symptoms** — Symptom 2 is unrelated to the new code; Symptom 1 is cold-start latency.

## Root cause summary (added 2026-04-27, post-investigation)

**Symptom 2 (TV off mid-track) — `automation.living_room_tv_zombie_wake_guard` killed the TV.** The host runs in Pacific time. The user's reported playback at 13:42–13:48 UTC was 06:42–06:48 AM PT — inside the guard's 00:00–07:00 "sleep hours" window. The guard's logic: when `binary_sensor.living_room_tv_state` goes `on` during that window, wait 60 s, then call `script.living_room_tv_off`. Logbook proof at 13:48:13 UTC: `[script] Living Room TV Off: started`, immediately followed by SHIELD off, LG TV off, plug power dropping. **The new trigger end-behavior code is innocent.** Smoke test at 07:06 UTC confirmed POST `/api/v1/trigger/side-effect` with `{behavior:tv-off,location:living_room}` returns `200 ok` and `previousState:off,currentState:off,elapsedMs:2` (TVControlAdapter no-op'd because TV was already off) — and would have logged `trigger.side-effect.fired` if it had run during Pooh; no such log entry exists.

**Symptom 1 (multi-scan) — cold-start latency drives user retries.** Inter-tap intervals on the same UID were 16, 84, 12 seconds — far outside the 3 s debounce window, and far longer than any plausible ESP double-fire. Cold wake-and-load takes ~25 s with no on-screen feedback, so the user taps again. Each retry triggers a fresh `script.living_room_tv_on` ("Already running" warnings on HA at 13:45:02, 13:46:42).

## Recommended fixes

**For Symptom 2 (Zombie Wake Guard false-positive on legitimate wakes):**

The guard's existing condition (time-of-day) is too coarse. Three options, in order of preference:

1. **Suppress via HA `input_boolean`.** Add `input_boolean.living_room_intentional_wake`. Have `script.living_room_tv_on` (or the wake-and-load device adapter, via HA service call) flip it `on` when called, and an automation reset it `off` after 10 minutes. Add to the Zombie Wake Guard's condition: `state of input_boolean.living_room_intentional_wake is off`. Cleanest separation: legitimate wakes are flagged at the source, the guard ignores them.
2. **Suppress via WS topic.** When `wake-and-load.execute` runs, broadcast a `livingroom.intentional-wake` event with a 10-minute TTL. Modify the guard to check this state via REST (HA can read DaylightStation state, but this couples HA to DS).
3. **Tighten the time window.** Currently 00:00–07:00. Kids wake up at 06:30. Change to `after: 00:00 before: 06:00` or `before: 06:15`. Quick fix; risks letting a real zombie wake go uncaught for the last 45 min before 07:00.

Recommend Option 1.

**For Symptom 1 (cold-start latency makes users retry):**

The user has no UI to add — the TV is the UI, and it's not on yet. Two options:

A. **Wider per-UID debounce.** Change `TriggerDispatchService.mjs:47` `debounceWindowMs` from 3000 to 30000 (30 s) — keyed on `(location, modality, value)` — long enough to absorb a full wake-and-load cycle. The first tap fires; subsequent taps within 30 s of the same UID return `{ok: true, debounced: true}` without restarting wake-and-load. Existing 3 s debounce was sized for HA's `tag_scanned` duplicate-fire (2-3 events per physical tap, all within ~500 ms), and 30 s preserves that protection while also covering user impatience.

B. **Auditory feedback on the ESP.** Buzzer/LED on the ESP to confirm the tag was read. Hardware change; out of scope for code-only fix.

Recommend A as a one-line code change.

## User-reported symptoms

1. **"Have to scan a book 2-3 times before it takes."** Users tap an NFC tag, content doesn't appear (or appears slowly), so they tap again. And again.
2. **"TV is turning off early."** A book starts playing, but the TV powers off well before the track is finished.

## Investigation timeline (UTC)

Container build: `62adde623` (deployed 2026-04-27 04:45:32Z). All times below are observed in container logs after that deploy.

### Symptom 1 evidence — multi-scan duplicate dispatches

`backend.trigger.fired` events for the same NFC UID, post-deploy:

| When (UTC) | Tag UID | dispatchId (last 4) | elapsedMs | Inferred user-tap time |
|---|---|---|---|---|
| 13:41:54 | `04_ca_76_72_cc_2a_81` (Pooh) | `..d2a9` | 24837 | 13:41:30 |
| 13:42:20 | `04_ca_76_72_cc_2a_81` (Pooh) | `..7a447` | 7218  | 13:42:13 |
| 13:45:19 | `04_4d_2b_72_cc_2a_81` (Peter Pan) | `..2509ea5` | 25993 | 13:44:53 |
| 13:45:19 | `04_4d_2b_72_cc_2a_81` (Peter Pan) | `..b959ad` | 9937  | 13:45:09 |
| 13:46:59 | `04_4d_2b_72_cc_2a_81` (Peter Pan) | `..513dff5` | 25904 | 13:46:33 |
| 13:46:59 | `04_4d_2b_72_cc_2a_81` (Peter Pan) | `..62109c24` | 13845 | 13:46:45 |

Each row is a fully-completed dispatch (`ok: true`). Different `dispatchId`s = different invocations of `TriggerDispatchService.handleTrigger`.

**Inter-tap intervals all exceed the 3 s debounce window** (`TriggerDispatchService.mjs:47`, `debounceWindowMs: 3000`):
- Pooh: 43 s between taps.
- Peter Pan: 16 s, 84 s, 12 s.

So debounce is correctly NOT suppressing them — these are *intentionally different scans* by an impatient user, not duplicate fires of the same physical tap.

`script.living_room_tv_on: Already running` warnings on the HA side at 13:45:02, 13:46:42 confirm overlapping wake-and-load cycles — each new scan starts a fresh 25 s wake-and-load while a prior one is still in flight.

### Symptom 2 evidence — TV powering off mid-track

Pooh playback (Disney Read-Along, 708.87 s = 11:48 mm:ss):
- `13:42:20.385Z` — `playback.started` `{title: "Winnie the Pooh and the Blustery Day", duration: 708.87}`
- `13:42:19.948Z` — `playback.queue-track-changed` `{queueLength: 2, queuePosition: 0}` ← **side-effect marker IS appended (queueLength = 1 real + 1 marker)**
- `13:48:18.640Z` — `binary_sensor.living_room_tv_power` flips `on → off` (plug power dropped below 30 W threshold)

That's **5 min 58 s into a 11 min 49 s track** — TV powered off at ~50% completion.

**Crucial:** No `script.living_room_tv_off` invocation in HA logs. No `trigger.side-effect.fired` `{behavior: 'tv-off', ok: true}` in backend logs. Our new side-effect handler **did not fire this TV-off**. Something else physically powered down the TV.

## What we know vs. don't know

### Known good (post-deploy, working as designed)

- The `endBehavior: 'tv-off', endLocation: 'living_room', endDeviceId: 'livingroom-tv'` triple makes it through the full pipeline:
  - `wake-and-load.load.start` shows it in `query` (line 1, log file 13:42:20.014Z).
  - `commands.queue` (frontend) shows it in `params` (13:42:19.573Z) — proves the WS envelope carries it.
- Frontend builds the queue with the synthetic marker: `queueLength: 2` for a single-track Pooh request.
- Backend POST `/api/v1/trigger/side-effect` is mounted and validating: empty body returns `400 behavior required`.
- Trigger registry parses the new `end_location` field (no `trigger.config.parse.failed` warnings).

### Symptom 1 — multi-scan — root-cause hypotheses

**Hypothesis A (most likely): Cold-start latency drives user impatience, not ESP duplication.**
- First Peter Pan scan: 25.9 s elapsed (cold path — Shield wake, FKB load, prepare).
- 16 s after the first tap completes, user taps again → second dispatch: 9.9 s elapsed (warm path).
- 84 s later, user taps again → third dispatch: 25.9 s elapsed.
- Pattern: every "cold" scan takes ~26 s. User has no feedback that the first scan was received during that window. They tap again.
- **Not an ESP bug.** Inter-tap times (16/84/12 s) are far longer than any plausible double-tap from the ESP firmware.

**Hypothesis B (less likely, worth ruling out): ESP is sending each tap once, but HA's `tag_scanned` event fires multiple times per ESP send.**
- Per the existing TriggerDispatchService comment (line 99-103): "HA fires `tag_scanned` 2-3 times per physical tap; without this guard each one spawns a fresh 22-35 s wake-and-load cycle."
- The 3 s debounce is meant to absorb that. The duplicates we see here all exceed 3 s, so they survive the debounce.
- If HA is now firing `tag_scanned` 16 s apart from a single physical tap, the existing 3 s debounce is too short.

**Diagnostic to disambiguate:** check the ESP firmware's `tag_scanned` send rate (one-shot per tap vs. retry-on-no-ack) AND check HA's `tag_scanned` event log for each UID. If HA shows one event per physical tap, the user is genuinely retrying. If HA shows multiple events for one tap, the ESP or HA tag-reader integration is the source.

### Symptom 2 — TV-off mid-track — root-cause hypotheses

**Hypothesis A: A non-`tv-off`-script path turned off the TV.**

Possible non-script paths into `binary_sensor.living_room_tv_power → off`:
- LG webOS Eco/no-signal auto-off (TV's own firmware turns display off after a brief no-signal).
- Manual remote button press.
- `automation.living_room_paddle_up_triggers_print` — fires on `sensor.printer_switch_printer_switch_scene_state_scene_001` change → calls `script.living_room_tv_off`. (Last logged "Already running" at 2026-04-27 00:45:53 — well before this incident.)
- `automation.kitchen_buttons_longpress_tv_off.yaml` — kitchen button long-press → tv off.
- A successful `script.living_room_tv_off` invocation that doesn't error or warn (HA only logs `ERROR`/`WARNING` by default; clean runs are invisible at the default level).

**Evidence consistent with this hypothesis:**
- `media_player.living_room_tv missing or not currently available` warnings at 13:45:15 and 13:46:55 — the LG webOS service was unreachable at the time, suggesting the TV was already in some kind of degraded/transitional state.
- `Living Room TV Volume: ... Device is off and cannot be controlled` at 13:42:15.843 (just before Pooh started!) — the volume script ran but the LG TV was already reporting "off" via its webOS state. Suggests the TV had been bouncing on/off during the multi-scan storm.

**Hypothesis B: Our new side-effect path fired without being logged.**

We searched for `trigger.side-effect.fired` with `ok: true` in 6 hours of logs — only one entry, at 05:38:37, with `error: 'missing-behavior'` (the smoke test from earlier). The backend logs the success case with `logger.info?.(...)` at `trigger.mjs:95`. If logger.info isn't exposed on the injected logger child, the call would no-op.

**Diagnostic to rule out:** check `logger.info` resolves on the trigger router's injected logger; also check whether `playbackLog('side-effect-fired', ...)` from `useQueueController.js` ever appears in container logs (we see zero of these — either the dispatch never fired, OR the WS log forwarding lost them; multiple "Connection stale (no data in 45s), forcing reconnect" messages around this time make the latter plausible).

**Hypothesis C: The Player remounted on the second Peter Pan scan, and the old Pooh queue was replaced — but somehow the marker fired during that handoff.**

Sequence:
- 13:42:20 — Pooh starts (queue: `[Pooh, sideeffect-marker]`)
- 13:45:19 — Peter Pan tag scanned. Backend builds query with `op: 'play-next', endBehavior: 'tv-off', ...` and pushes via WS/URL.
- Frontend useQueueController re-runs with new `play` props.
- 13:46:59 — second Peter Pan scan, same again.
- 13:48:18 — TV power off.
- 13:49:27 — Peter Pan finally starts (`queuePosition: -1` — fresh single item, NOT in a multi-item queue).

If the second scan caused `useQueueController.initQueue()` to rebuild the queue, the *old* `[Pooh, marker]` is destroyed. But: between the destruction and the new queue mounting, could `useEffect` on `playQueue` have fired the marker once if the marker briefly sat at index 0?
- Possible if the queue went `[Pooh, marker] → [marker] → [PeterPan, marker]` (rather than atomic replacement).
- Or if React batched updates such that the marker was momentarily at index 0 before being replaced.

`firedMarkersRef` (Set) prevents the same marker firing twice from the same hook instance — but if the queue is rebuilt and the OLD marker briefly becomes the head, that's a fresh mark.

**Diagnostic to rule out:** add temporary instrumentation to `useQueueController.js` to log every `setQueue` call with the resulting queue's `mediaType`s, and re-run with a multi-scan scenario.

**Hypothesis D (low likelihood): The synthetic marker's `id` collided with a real id.**
- Marker id format: `sideeffect:tv-off:<guid>` — guid is from `frontend/src/modules/Player/lib/helpers.js`. Collision astronomically unlikely.
- Skip.

## Reproduction steps

1. With `livingroom-tv` powered off (cold), tap an NFC book tag at the living room reader.
2. While the wake-and-load cycle is running (25 s), tap a *different* book tag (or the same one again).
3. Observe: HA `script.living_room_tv_on` fires twice (`Already running` warning), backend logs two `trigger.fired` events, eventually content plays.
4. Observe (sometimes): TV powers down mid-track without our `side-effect-fired` event ever appearing in logs.

## Recommended next actions

1. **Add HA-side observability:** turn on INFO logging for `homeassistant.components.script` so successful `living_room_tv_off` invocations are visible.
2. **Add backend dispatch trace:** include `result` from `tvControlAdapter.turnOff` in the `trigger.side-effect.fired` log and dump it on every code path so an `info?.()` no-op is detectable.
3. **Add frontend marker lifecycle logging:** every `setQueue` (or setOriginalQueue) call in `useQueueController.js` should `playbackLog('queue-mutation', { length, kinds: queue.map(i=>i.mediaType) })` so we can see exactly what happened to the marker across multi-scan storms.
4. **Add per-tag debounce widening (non-blocking):** change debounce from 3 s to 30 s for the *same UID* (different UIDs unaffected). The current 3 s window catches HA's duplicate-tag-scanned events but does nothing for impatient re-scans; a longer per-UID window would suppress those *and* signal "we got it, just wait" to the user via a deduped response.
5. **Consider a "scan acknowledged" UI cue:** the user re-scans because nothing visible happens for 25 s. A brief on-screen indicator ("Loading: Peter Pan…") rendered immediately on `trigger.fired` (before wake-and-load completes) would short-circuit the impatience loop entirely.
6. **Bisect the TV-off path:** disable the side-effect handler in YAML (`end: nothing`) and reproduce the multi-scan scenario. If the TV still powers off mid-track, the new code is exonerated and the cause is upstream (LG webOS auto-off, paddle automation, kitchen-button automation, or webOS state churn from rapid `tv_on` calls).

## Related files

- Backend: `backend/src/3_applications/trigger/TriggerDispatchService.mjs:47` (debounce window), `backend/src/3_applications/trigger/sideEffectHandlers.mjs`, `backend/src/4_api/v1/routers/trigger.mjs` (POST /side-effect).
- Frontend: `frontend/src/modules/Player/hooks/useQueueController.js` (marker append + dispatch), `frontend/src/modules/Player/Player.jsx` (activeSource skip).
- HA: `_includes/automations/living_room_paddle_up_triggers_print.yaml`, `_includes/automations/kitchen_buttons_longpress_tv_off.yaml`, `script.living_room_tv_off`.

## Commits in scope

```
62adde623 feat(player): trigger end-behavior — synthetic side-effect tail item
5941983e6 feat(bootstrap): wire tvControlAdapter into trigger router
9a31b2b84 feat(trigger/api): POST /side-effect with markerId dedup
234e6ee4e feat(trigger): sideEffectHandlers for tv-off + clear
6314313f4 feat(wake-and-load): inject end-behavior into contentQuery
b9a4b3834 feat(trigger/actions): forward intent.end into wakeAndLoad opts
846dcf0a8 feat(trigger/resolver): emit intent.end + intent.endLocation
fc112a217 feat(trigger/parser): validate location-level end + end_location
```
