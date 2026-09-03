# Fitness: false RPM zeros paused the video 7 times during a cycle challenge

**Date:** 2026-09-02
**Note:** learner names are redacted to learner-A..D and host values to {env.*} placeholders — this repo is public (see CLAUDE.md, "No instance-specific data").
**Found by:** KC, after the evening session — "the ANT dongles were dropping the connection left and right", "RPM meters (and HR meters?) flickered offline many many times"
**Status:** **fixed** on `fitness/false-zero-pipeline-stall` (2026-09-02). Not merged, not deployed — live verification on the next multi-rider session pending; recipe at the end of this file.
**Severity:** high. A rider pedalling at 85 RPM had his video locked and paused 7 times in 99 seconds. The governance/challenge system punished a child for a defect in our transport.
**Session:** `fs_20260902194750` — 2026-09-02 19:47:50–20:20 local (02:47–03:20 UTC 09-03), 5 participants
**Surfaces:** `frontend/src/hooks/fitness/DeviceManager.js:269-302` (`pruneStaleDevices`), `frontend/src/hooks/fitness/FitnessSession.js:28-32` (`FITNESS_TIMEOUTS.rpmZero`), `frontend/src/context/FitnessContext.jsx:1474-1484` (prune driver), `frontend/src/modules/Fitness/player/panels/RealtimeCards/RpmDeviceCard.jsx:13`
**Related:** `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md` — the fix for *that* bug is the direct cause of this one

---

## What happened

During the 03:10:09–03:11:48 cycle challenge (`default_0_7_1788405009451`, rider **learner-A**),
the challenge state machine locked seven times with `reason: health_depleted`. Each lock
paused the video. Six of the seven locks fired at **exactly `currentRpm: 0`**.

```
>>> playback.paused=8  playback.resumed=8  cycle->locked=7
```

(The eighth pause, 03:09:55.695, is 14 s before the challenge began and belongs to a
separate `activeParticipantCount: 0` event — see "Loose ends".)

learner-A was never not pedalling.

---

## Evidence: what the app believed vs. what the sensor sent

learner-A's cadence sensor is ANT+ device **bike-1**. Every row below is the same wall-clock
second, app-side (`governance.cycle.state_transition`, VictoriaLogs) against sensor-side
(`daylight-fitness` container stdout on the garage box):

| lock (UTC) | app `currentRpm` | garage log, same second | revs |
|---|---|---|---|
| 03:10:20.7 | **0** | `CAD:83 REV:46687` | advancing |
| 03:10:30.4 | **0** | `CAD:84 REV:46702` | +2/s |
| 03:10:39.5 | **0** | `CAD:81 REV:46714` | +2/s |
| 03:10:52.4 | **0** | `CAD:77 REV:46730` | +2/s |
| 03:11:07.1 | **0** | `CAD:86 REV:46751` | +2/s |
| 03:11:21.7 | **0** | `CAD:83 REV:46771` | +2/s |
| 03:11:35.9 | 33.7 | `CAD:87 REV:46792` | +2/s |

learner-A held **77–99 RPM continuously** for the whole challenge, cumulative revolution
count climbing ~2 every second without a single break, from REV 46687 to REV 46811.

For device bike-1 during the challenge window there were:
- **zero** `cadence revolution-stall` events (its only five in the entire session were at 03:05:18, 03:05:48, 03:09:00, 03:10:19, 03:16:50 — none inside 03:10:09–03:11:48)
- **zero** silence gaps > 3 s after 03:10:10

Every one of those zeros was manufactured downstream of the dongle.

---

## The ANT+ hardware is provably innocent

This was the original hypothesis and it is wrong. Ruling it out mattered, so the
disproof is recorded here.

**Both dongles opened once at container start and were never re-initialised** across
the full 14 h log window — no channel reset, no USB reclaim, no re-scan:

```
Device 0: ID 0fcf:1008 Dynastream ANTUSB2 Stick   → opened successfully
Device 1: ID 0fcf:1009 Dynastream ANTUSB-m Stick  → opened successfully
✅ Successfully initialized 2 ANT+ device(s)
```

All 26 ANT-related lines in 14 h come from that single boot sequence.

**The garage process never stalled.** Across the 1990-second session the container
logged on **1928 distinct seconds with zero gaps > 2 s**.

**HR reception was continuous.** Per strap, whole session:

| strap | owner | valid samples | span | gaps > 5 s |
|---|---|---|---|---|
| strap-A | learner-A | 1412 | 02:47:43–03:18:26 | 1 (6 s, at strap-off) |
| strap-B | learner-B | 1141 | 02:52:53–03:17:28 | 3 (16/7/7 s, first 4 min) |
| strap-C | learner-C | 1118 | 02:55:03–03:18:30 | 0 |
| strap-D | learner-D | 1092 | 02:55:32–03:18:24 | 0 |
| strap-E | Dad | 979 | 02:56:10–03:18:18 | 3 (7 s each, first minute) |

~1 sample/sec, continuous. The `HR rejected: 0 bpm outside 50-230` bursts cluster
entirely at strap-on and strap-off — normal contact-loss, not RF loss.

---

## Root cause

Two independent facts combine.

### 1. The backend event loop was blocked 6–8 seconds, for twenty minutes

`system.event-loop.lag`, backend, one row per 60 s window:

```
02:47  max   541   p99    60   p50  20     ← healthy (first autosave 02:48:47)
02:50  max  8116   p99   191   p50  20     ← already blocking; p99 hides it
02:58  max  8120   p99  5625   p50  26     ← 4 learners publishing; p99 crosses
03:02  max  7931   p99  6606   p50  21
03:05  max 13153   p99  7244   p50  21     ← worst
03:10  max  8632   p99  8162   p50 129     ← the challenge
03:11  max  8439   p99  6891   p50  65
03:16  max  8523   p99  6409   p50  65
03:19  max  2007   p99   158   p50  20     ← session ends, recovers
03:24  max   598   p99    69   p50  20
```

p50 rose from 20 ms to 129 ms; p99 sat at 6–8 s for twenty minutes and cleared the
moment the session ended. While the loop is blocked, **no sensor packets reach the
browser for any device**.

### 2. `pruneStaleDevices` zeros cadence after 1200 ms, on a timer that cannot stall

`FitnessContext.jsx:1478` runs the prune on a client-side `setInterval` every 3000 ms.
That timer lives in the browser and is completely unaffected by a backend stall.

`DeviceManager.js:295-301`:

```js
const timeSinceSignificant = now - (device.lastSignificantActivity || device.lastSeen);
if (isCadence && timeSinceSignificant > timeouts.rpmZero) {
  if (device.cadence > 0 || device.power > 0 || device.speed > 0) {
    device.resetMetrics();
    mutated = true;
  }
}
```

`FITNESS_TIMEOUTS.rpmZero` is **1200 ms** (`FitnessSession.js:31`).

**The defect: this check cannot distinguish "the rider stopped pedalling" from "no
packets have arrived because the transport stalled."** It only looks at the age of the
last sample. A 6–8 s backend stall is five to seven times the 1200 ms window, so on the
next 3 s tick every cadence device in the map is past the threshold and
`resetMetrics()` fires on **all of them simultaneously**.

That simultaneity is the whole signature KC spotted. N sensors appearing to drop at the
same instant is never N independent RF failures — it is one shared choke point upstream.

### The regression trade-off

`rpmZero` used to be **3000 ms**. Commit `1601175f9` (2026-05-28,
*"fix(fitness): zero RPM ~1.2s after last cadence broadcast (tighten rpmZero)"*)
tightened it to 1200 ms to fix the opposite complaint — RPM staying frozen at the last
value for up to 125 s after a rider stopped (`2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md`).

That fix was correct for its bug and made this one sharper. At 3000 ms a stall had to
exceed 3 s to produce a false zero; at 1200 ms almost any transport hiccup does. Neither
value is right, because **elapsed time since the last packet is the wrong signal** — the
same number means "stopped pedalling" and "nothing is being delivered", and the code
treats them identically.

### The chain

```
backend event loop blocks 6–8 s
  → no ANT packets reach the browser (all devices at once)
    → local 3 s prune timer fires regardless
      → every cadence device is > 1200 ms stale
        → resetMetrics() zeros them all simultaneously
          → RPM tiles read 0; > 5 s stale they render "--" (RpmDeviceCard.jsx:13)
            → GovernanceEngine reads currentRpm 0
              → cycle challenge: health_depleted → locked
                → playback.paused
```

---

## Does this hit HR meters too?

**Not the same way.** HR devices take the `lastSeen` branch and are only touched by the
60 s `inactive` timeout, so they never hit `resetMetrics()` during a 6–8 s stall.
`PersonCard.jsx` has no staleness rule for `heartRate` — it renders whatever value it was
last given. So HR tiles **freeze at the last value** rather than blanking.

The visible blank-out is RPM-specific: `RpmDeviceCard.jsx:13` sets
`STALENESS_THRESHOLD_MS = 5000` and renders `--` past it, and the stalls (6–8 s) clear
that bar. So "RPM flickered offline" is exactly right; "HR flickered offline" is more
likely the tiles going motionless at the same moment, which reads the same on a wall
display.

---

## What blocked the event loop — VERIFIED

Two independent blockers. Either one alone produces false zeros.

### Blocker A — State Gates YAML write amplification, every 15 s

1. The browser autosaves the session every 15 s — `frontend/src/hooks/fitness/SessionLifecycle.js:44` (`autosaveIntervalMs: 15000`).
2. `POST save` → `FitnessSessionOperations.save` → `notifySessionsChanged({operation:'saved'})` — `backend/src/3_applications/fitness/services/FitnessSessionOperations.mjs:80`.
3. Wired straight into `fitnessStateGatesProducer.requestReconcile(change)` — `backend/src/app.mjs:3522` (500 ms debounce).
4. `#reconcile` fires **`Promise.all` over every learner** whose value changed — `backend/src/3_applications/measures/WeeklyMeasuresStateGatesProducer.mjs`. During a live session that is all four kids, every cycle.
5. Each publish → `StateGatesEngine.#commit` (`backend/src/3_applications/state-gates/StateGatesEngine.mjs:224-246`): up to 3 attempts of `#load` → `buildGraph` → `#derive` → `commitRevision` → `#deliver` → `markPublished`.
6. Every step hits `backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs`, which does **synchronous whole-file I/O each time**: `#read` = `readFileSync` + `yaml.load` + deep `mapKeys(camel)` walk; `#write` = deep `plain` + `mapKeys(snake)` + `yaml.dump({sortKeys:true})` + `writeFileSync` + `renameSync`. Per successful assertion: **3 parses + 2 dumps of the whole file**.

**The file is 2.6 MB.** The entire transition journal lives inside `current.yml` — retention 5000 entries / 30 days (`backend/src/5_composition/modules/stateGates.mjs:54`), and `#compact` never trims below that, so `compacted_through: 0`. Live file in the container: 2,591,661 bytes, 2282 entries, revision 2508, growing ~700 envelopes/day.

Measured in the production container (idle): `yaml.load` 132–144 ms, `yaml.dump` 158 ms → 0.7 s per successful commit, **3.3 s per 4-learner cycle in pure YAML**. The remainder to ~8 s is the 24 deep object walks over the same graph plus GC churn from allocating a 2.6 MB object graph 18× per cycle (split is HYPOTHESIS; the attribution is not — nothing else runs inside the gaps).

Four concurrent publishers against one optimistic revision: attempt 1 → 4 loads, 1 wins; attempt 2 → 3 loads, 1 wins; attempt 3 → 2 loads, 1 wins; **the 4th learner always exhausts 3 attempts and throws**. That is 18 parses + 6 dumps per cycle plus a guaranteed failure. Everything chains through `await`s on already-resolved promises (microtasks), so nothing yields to the loop until the cycle completes.

**Direct measurement of one cycle** (backend log stream, all events, 03:10:16–03:10:24):

```
03:10:16.619  last unrelated event
03:10:18.739  state-gates.assertion.corrected  learner-A
03:10:21.278  state-gates.assertion.corrected  learner-B
03:10:23.504  state-gates.assertion.corrected  learner-C
03:10:24.047  state-gates.fitness.publish-failed  learner-D
03:10:24.599  queued burst of everything that piled up
              → 8.0 s of TOTAL backend silence, vs that window's maxMs 8632
```

Not even the ~29/s fitness relay logs appear inside those gaps.

**Why it appeared to start at 02:58 and stop at 03:19.** It actually started at **02:48:47**, the first autosave. Corrections per minute: 02:48 → 1, 02:50 → 4, 02:54 → 6, 02:57 → 9 (first `publish-failed`), 02:58 → 13, then 10–13/min through 03:16, tailing to the last at 03:18:56. That ramp is the strap-on order. p99 only crosses into view once the loop is blocked more than ~50 % of a window, which needed all four kids — the 02:50 and 02:54 rows already carry 7.8–8.1 s `maxMs`. It cleared because session end stopped the autosaves.

### Blocker B — the 4-minute school bank prewarm, all day, every day

`backend/src/app.mjs:3201-3205` runs `schoolService.warmBanks({force:true})` on a 4-minute `setInterval`. `readAllBankRaws` (`YamlSchoolDatastore.mjs:239-257`) calls `#bankFile(id)` for each of **637 ids**; for a v2 course `#bankFile` (:146-155) calls `#v2BankEntries` (:117-130), which synchronously `listYamlFiles`-walks and `loadYamlSafe`s **every bank in that course — per id**. O(N²) synchronous YAML, all before the first real `await`, so the "off the main thread" comment at `SchoolService.mjs:240-243` is false.

`school.banks.prewarmed` lands at :06 of every 4th minute and every one sits inside a ~7.8 s `maxMs` window. Corroboration: `speaker-red` is declared offline (`sinceMs` 15–22 s) at 02:29:56, 02:34:04, 02:41:56 — each seconds before a prewarm.

**This puts an 8 s data blackout on the fitness wall every 4 minutes regardless of fitness.** With `rpmZero = 1200 ms` that is a guaranteed false zero every 4 minutes in every session, even after Blocker A is fixed.

(An hourly 13–17 s spike at :05 is a prewarm coinciding with something else hourly — unexplained, HYPOTHESIS only.)

### Chronic since 2026-08-30

`ae5ee9c0e` (2026-08-30, *"Wire School & Fitness into State Gates"*) introduced `onSessionsChanged → requestReconcile`; the journal's `PolicyGraphActivated` is 2026-08-31 02:29Z. Every multi-learner session since shows the same storm: 08-31T18 286/h, 08-31T20 188, 09-01T03 208, 09-01T17 255, 09-02T03 202, 09-03T03 214 corrections/hour. The lag monitor itself only exists since 2026-09-02 (`553db4e16`), so earlier lag is invisible — not absent. The single-rider 09-02 16:47 session produced 8 corrections and a healthy loop (p99 44–154), consistent with cost scaling by learner count and file size.

---

## Correctness bug found inside the noise

`state-gates.fitness.publish-failed` × 46, all learner `learner-D` — **not** a real concurrency signal. It is the deterministic loser of a 4-way optimistic-revision race with a 3-attempt cap; roster order makes the last learner lose every cycle.

**learner-D's weekly rings were never published for the entire session.** His State Gates entitlement was stale throughout. That is a correctness defect sitting on top of the performance one, and it will recur every multi-learner session.

---

## Signals now attributed

| Signal | Verdict |
|---|---|
| `state-gates.fitness.publish-failed` × 46 (learner-D) | VERIFIED — deterministic race loser; rings never published |
| `device-liveness.online/offline` × 243 each, `ha.callService` × 48, `fitness.zone_led` flapping | VERIFIED — heartbeats unprocessed during each 8 s block, re-processed in the burst |
| `fitness_chart.participant_mismatch`, `activeParticipantCount: 0`, `render_thrashing` | HYPOTHESIS, consistent — ~29 relay msgs/s (39,746 in 23 min) stop dead during a block, then ~200 land at once. Chart empty during, thrash on the burst. Not measured frontend-side. |
| `harvester.*.error`, `proxy.timeout`, `timelapse.failed` | HYPOTHESIS — collateral of a loop that cannot service sockets for 8 s (the gcal/gmail `ETIMEDOUT` fire 0.6 s after start, i.e. already-expired timers) |
| Garage bridge | VERIFIED INNOCENT — ~7 sensor lines/s (11,535 over the session); its 8 WebSocket 502s are at container boot 14 h earlier and the 03:35Z redeploy, none during the session |

---

## The transport path: why the starvation was invisible

The data was never lost on the wire. It **queued**.

The garage box is wired — `enp44s0` UP at {env.garage_ip}, `wlo1` **DOWN**, route to the backend over copper. No WiFi involved.

`_extensions/fitness/src/server.mjs:173`:

```js
function broadcastFitnessData(message) {
  if (websocketClient && websocketClient.readyState === WebSocket.OPEN) {
    websocketClient.send(JSON.stringify(message));
  }
}
```

Three things absent (verified by grep across `_extensions/fitness/src/`): no `send()` error callback, no `bufferedAmount` backpressure check, and **no heartbeat or liveness watchdog of any kind**.

When the backend loop blocks it stops reading its socket; the TCP receive window fills; `send()` keeps succeeding into the garage process's own memory; `readyState` stays `OPEN`; no error or close fires; the garage log keeps printing (the log line precedes the send). Then the backend unblocks and the backlog floods through. Head-of-line blocking, not packet loss — which is exactly why the meters flicker and recover rather than staying dead.

Corroboration: baseline ingest is ~31 msg/s, but the circuit breaker tripped at **100/s (501 calls in 5 s)**. A steady 31/s cannot produce that; a draining backlog can. So the breaker is a *symptom of the flush*, not a bystander — while remaining true that it drops renders, not data.

Asymmetry worth noting: the **backend** is the careful side (`WebSocketEventBus.mjs:191`) — 30 s protocol ping plus an app-level `heartbeat` message, terminating a client after 3 missed pongs (`eventbus.client_stale` fired at 02:45:37 and 03:02:52). The garage bridge never pings and **ignores the app-level heartbeat the backend sends specifically so clients can detect liveness**. It cannot distinguish a wedged backend from a healthy one; only a TCP close, which a blocked-but-alive peer never sends. Same shape as `reference_omr_relay_half_open_ws_loss`.

Note: the bridge connects to `wss://{env.app_host}/ws` (reverse proxy), **not** `{env.prod_host}:{env.bridge_port}` — the compose values are defaults that `.env` overrides.

---

## Latent hazard found while reading the same handler

`FitnessContext.jsx:1406`, eleven lines above the ingest call:

```js
if (reconnectCountRef.current > 3) {
  return;   // returns BEFORE session.ingestData(data)
}
```

The counter increments on every false→true WebSocket transition (`:1438`) and resets only
after **60 s of stability** (`:1445`). Four reconnects inside any 60 s window silently
blackholes every sensor packet until the socket gets a full quiet minute, and **nothing is
logged when it happens**.

No evidence it fired on 2026-09-02 — the garage container logged only 2 WS reconnects in
14 h, both after session end, and that is the garage→backend link, not browser→backend. It
is the only path found that would produce `rosterCount: 5, chartPresentCount: 0` exactly.
Recorded as a hazard, not as this session's cause.

---

## Recommendations

1. **Gate the RPM zeroing on transport liveness.** `pruneStaleDevices` must not zero
   cadence when the reason for silence is that *nothing at all* is arriving. Track a
   last-packet-received-from-any-device timestamp; if it is older than ~1.5× `rpmZero`,
   the link is stalled — hold values and mark the tiles as *stale/unknown* rather than
   claiming 0 RPM. "No data" and "0 RPM" are different states and must render differently.
2. **Never let a governance/challenge lock fire on a zero that came from a prune.**
   `health_depleted` should require a fresh sample that is genuinely low, not the absence
   of a sample. This is the difference between a fair challenge and punishing a kid for
   our event loop.
3. **Log the false-zero.** `resetMetrics()` firing for more than one device inside the
   same tick is a transport symptom, not rider behaviour, and should emit a warn. It is
   currently invisible — the entire diagnosis above had to be reconstructed by joining
   two log sources by hand.
4. **Instrument the reconnect blackhole** at `FitnessContext.jsx:1406`, or bound it —
   silently discarding all sensor data with no log line is not an acceptable failure mode.
5. **Give the garage bridge a liveness watchdog and backpressure check**
   (`_extensions/fitness/src/server.mjs:173`). Watch the app-level `heartbeat` the backend
   already sends every 30 s, and check `bufferedAmount` before `send()` — a queue forming
   is the earliest available signal that the backend has wedged, and today nothing
   anywhere records it.

### Backend — the blockers themselves

Note on layering: **`backend/src/2_domains/state-gates/` is not implicated.** It holds no
file I/O and no YAML (verified by grep) — pure aggregates, definitions, evaluations and
`GateEvaluator`. The cost is entirely in `0_system/utils/FileIO.mjs`,
`1_adapters/state-gates/persistence/`, the retry/fan-out in `3_applications/`, and the
composition wiring. The domain being clean is what makes these fixes tractable.

6. **Stop the per-commit full-file round trips** —
   `1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs`. The engine already
   serialises writers per household (`#serialized`/`#queues`); keep the parsed state in
   memory after the first `#read` and serve `loadProjection`/`commit`/`markPublished`/`pending`
   from it, writing through on mutation. That removes all 18 parses per cycle at once.
7. **Split the journal out of `current.yml`** into an append-only file, so a commit dumps
   only the ~100-line projection (24 assertions / 48 evaluations / 24 decisions) instead of
   2.6 MB. The README's "bounded transition journal"
   (`docs/reference/state-gates/README.md:89`) is bounded at 5000 entries × 30 days — not a
   bound the write path can afford.
8. **Publish learners sequentially, not `Promise.all`** —
   `3_applications/measures/WeeklyMeasuresStateGatesProducer.mjs` `#reconcile`. Removes the
   wasted retry attempts *and* the deterministic 4th-learner failure, which fixes learner-D's
   stale rings.
9. **Don't reconcile on every 15 s autosave** — `backend/src/app.mjs:3522`: skip
   `change.operation === 'saved'` (the producer's 5-min `refreshMs` poll and the `ended`
   hook still update rings), or raise `debounceMs` to ≥ 60 s. One line, and it
   halves-to-quarters the cost immediately while 6–8 land.
10. **Emergency config mitigation available today**:
    `5_composition/modules/stateGates.mjs:54` `journalRetention` 5000/30 d → e.g. 200
    entries / 1 day. Compaction only trims fully-published batches, and replay cursors
    older than `compactedThrough` already get a 410 the design handles.
11. **Fix the 4-minute school prewarm (Blocker B)** — in
    `YamlSchoolDatastore.readAllBankRaws`, compute the v2 entries map once per
    (subject, work) and have `listBankIds` return `{id, file}` so `#bankFile` is not called
    per id (kills the O(N²)); and yield with a real macrotask (`setImmediate`) between
    batches — `await Promise.all` over already-synchronous work does not yield. **Until
    this lands, every session gets a guaranteed false zero every 4 minutes regardless of
    anything else on this list.**
12. Minor: `WebSocketEventBus.mjs:~546` logs every fitness relay message at `info` —
    41,661 rows in 23 minutes shipped to the log store. Make it `debug` or `sampled`.

---

## Corrections to the first-pass triage

Recorded so the wrong version does not get quoted later:

- **"The ANT dongles were dropping."** No. Both dongles held for 14 h; every strap
  streamed ~1 sample/sec with no gaps; the garage process logged 1928 of 1990 session
  seconds with zero gaps.
- **"Cadence sensor bike-2 has a magnet/sensor fault."** No. Its median inter-revolution
  interval is 1.00 s — identical to the two healthy sensors. It is also not the challenge
  rider's bike; learner-A rode bike-1. Generalising from the wrong device produced the wrong
  conclusion.
- **"bike-2's frozen REV for 4 minutes is a sensor problem."** No — that rider stopped
  pedalling at 03:15:54 and the session ended at 03:20.
- **"The circuit breaker was throwing sensor updates away."** No. `FitnessContext.jsx:1429`
  runs `session.ingestData(data)` *before* `batchedForceUpdate()`, so a tripped breaker
  drops **renders, not data**. It fired once, at 03:16:38 — after the challenge, and
  irrelevant to it. Note its `renderTimestamps` array counts *calls*, not renders; actual
  renders are already capped at ~4/s by the 250 ms throttle below it.
- **"The `bridge.socket-error` storm (359 events) is a fitness problem."** No —
  `context.component: piano-bridge-notes`, `ws://localhost:8770`, reconnect attempt #844.
  That is the piano tablet and a separate standing issue.
- **"The stall began mid-session at 02:58."** No — it began at **02:48:47** with the first
  autosave. p99 hid it until all four learners were publishing; the 02:50 and 02:54 rows
  already show 7.8–8.1 s `maxMs`.
- **"First suspect: writes into the Dropbox-synced data tree."** Wrong, and not needed.
  Reading the 2.6 MB file in-container takes 7 ms. The cost is CPU-bound YAML parse/dump
  plus deep object walks, 18–24 times per cycle — not I/O.
- **"`State Gates state changed concurrently` is an unexplained concurrency signal."** No —
  it is a deterministic race loser (4 publishers, 3-attempt cap, roster order), and it
  means one learner's rings were never published all session.
- **"The garage bridge uplinks to `{env.prod_host}:{env.bridge_port}`."** No — container logs show
  `wss://{env.app_host}/ws` via the reverse proxy. The compose values I
  quoted are defaults that `.env` overrides.
- **"1928 seconds with zero gaps proves delivery to the backend."** No — that log line is
  written *before* `broadcastFitnessData()`. It proves the dongle received; the agent
  separately verified delivery from the backend's relay counts (39,746 `topic: fitness`
  broadcasts in 23 min).
- **"The circuit breaker is a bystander."** Half right. It drops renders not data, and it
  fired after the challenge — both stand. But its 100/s trip against a 31/s baseline is
  the backlog *flushing*, so it is a symptom of the stall, not unrelated to it.

---

## Side finding: idle sensor and a wedged reader

- **Cadence device bike-4** broadcast 1386 packets across the entire session with
  **zero revolutions** (REV 65 → 65) and was already broadcasting an hour before the
  session started. A live sensor on a bike nobody rode.
- The garage **fingerprint reader is wedged**: `scan-loop: 10 consecutive reader faults —
  reader likely wedged (USB claim leak / device busy)`, preceded by
  `reader overheated (#1)`. It is in 30 s backoff and the log says to restart the
  `daylight-fitness` container. Unrelated to ANT, but live.

---

## The fix

Branch `fitness/false-zero-pipeline-stall`, off `2248faade`. Plan: `docs/_wip/plans/2026-09-02-fitness-false-zero-pipeline-stall-fix.md`.

**Backend — remove the two things blocking the loop**

| Commit | Change |
|---|---|
| `aea41147e` `a1af768ef` `cac09572b` | Autosave-driven reconciles coalesce on a 60 s debounce; `ended`/`deleted` stay prompt at 500 ms and upgrade a pending slow request. Pending state is one indivisible struct; a throwing scheduler can no longer wedge it. |
| `7d08ad5e7` | Learners publish **sequentially**. Removes the 4-way race on one household revision — and with it the deterministic every-cycle failure that left learner-D's rings unpublished. |
| `d3bacbd8d` `6374136b7` `9d4bc5075` | State Gates state is parsed **once** and kept in memory, written through, and dropped on write failure. `commit` serialises caller input before touching the cached copy, so an unwalkable value fails with nothing mutated. |
| `1058e9999` | Journal retention 5000 entries / 30 d → 500 / 7 d. The journal shares `current.yml` with the projection, so its size is the cost of every commit. |
| `09f226456` | The 4-minute school prewarm walks each v2 course **once** (was once per bank id — O(N²) synchronous YAML) and yields a real macrotask between works. |

**Frontend — never render a starved pipeline as 0 RPM**

| Commit | Change |
|---|---|
| `9fb67e5b5` | `DeviceManager.isTransportStalled()` tracks the last packet from *any* device. `pruneStaleDevices` **holds** cadence while the pipeline is silent instead of zeroing it, and logs `device-manager.transport_stalled` / `transport_resumed` on both edges. The `inactive`/`remove` lifecycle is deliberately NOT gated on the stall. |
| `e646e8cbe` | The reader reports `transportStalled` on a **`connected: false`** reading; `CadenceFilter.hold()` advances the staleness clock without decaying; `_evaluateCycleChallenge` treats a stall exactly like a pause — no depletion, no progress, no ramp/init timeout, no lock. |

### Two design decisions worth not re-litigating

**`connected` stays `false` during a stall.** The obvious reading is that the sensor is fine so the reading is connected. That is wrong: `CycleGameContainer.jsx:1022` treats a connected reading as fresh truth and resets its gap counter, while its disconnected branch is a *deliberately bounded* hold (`rpmDuringGap` decays then zeroes) so "a sensor that never comes back can't ride forever at a frozen RPM and can still idle-DNF" (audit game-design #6). `rawRpm` feeds `controller.tick()` and accrues race distance — so `connected: true` would have banked ~8 s of phantom distance per stall with the anti-cheat bound bypassed. Same injustice as the bug being fixed, different hat.

**Both `hold()` and the SM gate are needed, for different reasons.** Mutation testing showed the gate alone prevents the lock, so `hold()` looked redundant — but `tick()` decays to a lost-signal 0 within 2 s, which is the `currentRpm: 0` symptom in this very report, and it zeroes the EMA so the first post-resume sample re-enters at `0.4 × rpm`. Conversely `hold()` alone prevents the lock in the manual-cycle path but lets **phase progress accrue on phantom held RPM** — credit for time not pedalled, the mirror image of the CycleGame problem. Each kills a mutation the other survives.

### Known residuals

**A stall past 60 s locks the video anyway, at a ~90 s horizon.** The `inactive`
lifecycle is deliberately not gated on the stall, so after 60 s every device goes
inactive *while still holding a live cadence value*. `ParticipantRoster.js:363`
skips inactive entries, so the active set empties, the `{ active: 'all' }` base
requirement fails globally, `grace_period_seconds: 30` runs, and the video locks —
the same user-visible failure this branch exists to prevent, 90 s out instead of 8 s.
Avatars vanish while their gauges still read a held RPM. This is **not** a
regression (`main` did the same, and zeroed the RPM as well), but the state is not
coherent, and it is the same failure as the hang below at a different timescale.

**The cadence filter decays for ~400 ms before the stall gate can fire.**
`CadenceFilter` starts linear decay at an 800 ms gap, but `transportStalled` cannot
be set until the gap exceeds `transportStallMs`. `GovernanceEngine.transportStall.test.js`
injects the flag from the first stall tick, so its `minReportedRpm === 80`
assertion is optimistic about the production path — the flag cannot appear that
early. The window is 400 ms once `transportStallMs` equals `rpmZero` (1200); it
closes entirely only if `transportStallMs` drops to 800.

**The in-memory state cache assumes this process is the only writer.**
`current.yml` lives under the Dropbox-synced data tree that the homeserver also
mounts. Before this branch every operation re-read from disk, so a foreign write
surfaced as a CAS mismatch and the caller retried; now it is invisible and the next
commit overwrites it. Low likelihood, unbounded blast radius.

**A permanent stall is a hang, not a free win.**

`isTransportStalled` is "no packet from *any* device for 1800 ms", and a single packet from any sensor clears it. If the whole ANT+/BLE bridge dies mid-challenge, the challenge now freezes indefinitely: it neither fails nor completes, and stays on screen. The video stays *unpaused*, so the failure mode favours the child, but it is a hang. Bounding it (abandon, not fail, after a maximum stall) is a design decision that was deliberately not made here.

### Verified

68 frontend fitness files / 432 tests; 9 state-gates files / 105 tests; school adapter+application 51 files / 964 tests; `CoursePackageV2` 6 tests; composition contracts 9/9. Every new test was mutation-verified — each was shown to fail against the specific wrong implementation it exists to prevent, then restored byte-identically.

Full `npm run test:isolated`: **24,048 passed**, 16 failed across 5 files — **every one pre-existing**, each blob-identical to `2248faade` and reproduced in a detached worktree at that commit:

| File | Tests | Why |
|---|---|---|
| `school/LanguageStudyService.test.mjs` | 1 | `expected "vi.fn()" to be called 1 times, got 0` |
| `tests/isolated/domain/fitness/legacy/fitness-timeline-pruning.unit.test.mjs` | 6 | Asserts `MAX_SERIES_LENGTH` 2000; main's `c9cef062a` raised it to 8640. Stale legacy duplicate — the live `FitnessTimeline.prune.test.js` passes. |
| `frontend/src/Apps/PianoApp.test.jsx` | 4 | `No "DaylightMediaPath" export is defined on the "../lib/api.mjs" mock` (SoundPanel.jsx:39) |
| `frontend/src/Apps/PianoApp.routing.test.jsx` | 5 | same mock gap |
| `tests/isolated/modules/Life/PlanCreate.test.jsx` | 1 | `Unable to find an element with the text: disk full` |

The fitness-timeline one is the trap: it is fitness-domain and looks like it could be ours. It is not — this branch never touched `FitnessTimeline.js`.

## Not fixed — carried forward

1. **`SchoolStateGatesProducer.mjs:70` has the identical `Promise.all` race.** Its `#enqueue` serialises per *learner*, not per household, so N learners still commit concurrently against one revision under the same 3-attempt cap — and school and fitness share the household (`app.mjs:3917`, `app.mjs:4914`). So `state-gates.fitness.publish-failed` should drop sharply but **will not reach zero**. The better fix is a per-household promise chain at the ingress, which would cover school-vs-fitness too; `SchoolStateGatesProducer.mjs:94` already has the pattern to lift.
2. **Split the journal out of `current.yml`** so a commit dumps only the ~100-line projection. Tasks 3–4 removed the urgency, not the shape.
3. **The garage bridge has no liveness watchdog or backpressure check** (`_extensions/fitness/src/server.mjs:173`): no `send()` error callback, no `bufferedAmount`, and it ignores the app-level `heartbeat` the backend already sends every 30 s. It cannot distinguish a wedged backend from a healthy one. This is why the starvation was invisible — data queued in the bridge's memory and flushed in a burst rather than erroring.
4. **`FitnessContext.jsx:1406`** returns *before* `session.ingestData(data)` once `reconnectCountRef > 3`, silently discarding every sensor packet until the socket gets 60 s of stability, with nothing logged. No evidence it fired on 2026-09-02.
5. **`WebSocketEventBus.mjs:~546`** logs every fitness relay message at `info` — 41,661 rows in 23 minutes.
6. **`LanguageStudyService.test.mjs` fails on `main`.** Unrelated to this work, but someone should look. Four more pre-existing failures were found in the same sweep — see the table above.
7. **`listBankIds()` has the same unfiltered shape** the bulk read just had: it maps `listYamlFiles` and `#v2BankEntries` ids with no `BANK_ID_RE` gate, so it can still name an id that `readBankRaw` rejects. One method away from the defect fixed in `c2334b8e4`, and it predates this branch.
8. **A legacy-named file inside a v2 course is double-counted by the bulk read.** For a v2 course the `quizzes/` directory is walked by both the legacy lister and `#v2BankRaws`' recursive walk, so such a bank appears twice in `readAllBankRaws` when its id passes `BANK_ID_RE`. Surfaced while testing the fix above (the rejected id leaked *twice*, not once). Pre-existing; the filter removes both copies of a rejected id but does not deduplicate an accepted one.
9. **A stall between 1200 ms and 800 ms cannot be closed** without lowering `transportStallMs` to `CadenceFilter`'s `STALE_THRESHOLD_MS`. See residuals.

## Live verification — next multi-rider session

Read-only. **Never start a second backend**; it is a live household controller.

```bash
# Loop health during the session — want p99 < 500ms, no 6-8s rows
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="system.event-loop.lag" AND _time:2h' -d 'limit=200'

# Blocker A gone: corrections should be a handful per session, not 10-13/min,
# and publish-failed sharply down (not zero — see carried-forward #1)
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=("state-gates.assertion.corrected" OR "state-gates.fitness.publish-failed") AND _time:2h | stats by (_msg) count()'

# Blocker B gone: prewarm rows no longer sit inside ~7.8s maxMs windows
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="school.banks.prewarmed" AND _time:24h' -d 'limit=50'

# The frontend guard: a stall is now NAMED, and must never coincide with a
# health_depleted lock at currentRpm 0
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=("device-manager.transport_stalled" OR "device-manager.transport_resumed" OR "governance.cycle.locked") AND _time:2h' -d 'limit=100'
```

The acceptance test is simple: **no `governance.cycle.locked` at `currentRpm: 0` while the rider's sensor is still reporting revolutions.**

## How to reproduce the analysis

```bash
# app-side: challenge transitions + pauses
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_time:[2026-09-03T03:09:50Z, 2026-09-03T03:12:00Z] AND ("playback.paused" OR "playback.resumed" OR "governance.cycle.state_transition")' \
  -d 'limit=100'

# backend health across the session
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_time:[2026-09-03T02:40:00Z, 2026-09-03T03:25:00Z] AND "system.event-loop.lag"' -d 'limit=60'

# sensor-side ground truth (note: container stamps UTC)
ssh garage 'docker logs --since 14h daylight-fitness' | grep bike-1
```
