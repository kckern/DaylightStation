# Postmortem — garage fitness session, 2026-09-28 morning

**Window:** 06:04–06:45 PDT (all times PDT; the log store's `_time` is real UTC, PDT = UTC−7).
**Surface:** garage fitness display (kiosk Firefox), garage sensor bridge (`daylight-fitness`), prod app container.
**Author:** Claude (session audit), written the same morning.
**Status:** two independent faults found. One of them, the network path, **was still failing when this was written**.

---

## Summary

**What the person saw.** Nothing worked. The workout video ("Max Built › Week 1 › Back 1") would not start, then started and froze, then threw errors. The workout music would not start, or started and stopped. The heart-rate reading on screen stopped updating, and the first workout session ended by itself after about two minutes. The play/pause buttons on the video and on the music player did nothing useful. The page was reloaded four times (06:20:05, 06:20:18, 06:34:43, 06:36:05). A second video ("10 Minute Speed Train › Week 3 Day 5") eventually played from 06:36:35, with further stalls.

**Why, in one paragraph.** Two unrelated infrastructure faults overlapped. The first is the bigger one and is still present: **the network path between the garage PC and the prod host is dropping 58–83% of packets.** Every other pair of hosts measured is clean. Everything the garage does travels that path:
- the kiosk's video and audio streams;
- the kiosk's WebSocket, which carries heart rate to the screen;
- the sensor bridge's WebSocket, which carries heart rate to the server.

So all of them starved at once. The second fault is that **the NAS behind Plex zeroed file modes (0000) across the Fitness share in a transient burst**. Plex answered `404` for the workout video it could not open ("Permission denied (13)"). On top of those two faults, three **app design flaws** turned degraded playback into "nothing responds":
1. The music player is slaved to the video's paused state, so a stuck video silences the music.
2. A play press on a loading video *pauses* it.
3. The video player treats a 404 as unrecoverable, so it does nothing for 15 seconds, then burns its recovery attempts reloading a file that cannot be read.

No deploy or container restart happened during the session. The container started at 21:01 the night before, on commit `1d62b500`.

---

## Timeline (PDT)

| Time | Event | Source |
|---|---|---|
| 21:01 (prev. night) | App container started; no restart during the session | `docker inspect`, `/build.txt` |
| 05:30–06:10 | Garage kiosk on the menu; menu music advancing normally every ~2 min | `menu-music.track-ended-continue` |
| 06:05:02–06:05:27 | **Backend event loop blocked 22 s** (`system.event-loop.lag maxMs=22096`) by the Strava harvester's `homeMatch` step. Before the workout; not causal, but it is a latent risk | backend logs |
| 06:12:59 | Server kills the kiosk's WebSocket: `eventbus.client_stale misses:3` (no pong for 60–90 s) | backend |
| 06:15:29 | Kiosk WebSocket killed as stale again | backend |
| 06:15:41 | HR strap `40475` seen, auto-assigned to the rider; session buffer fills | frontend |
| 06:15:43 | Video "Back 1" (`plex:696316`) loads | frontend |
| 06:15:45 | **Plex 404** on the video file. Plex log: `Error opening file … Permission denied (13)` | Plex log, `playback.playback-health media-error 404` |
| 06:15:45 | Fitness session `fs_20260928061545` starts | frontend |
| 06:15:58 / 06:16:13 / 06:16:28 | Recovery attempts 1–3 (`startup-deadline-exceeded`). Attempt 1's reload gets a second 404 at 06:16:00 | frontend, Plex log |
| 06:16:14, 06:16:28 | Plex *serves* the video for attempts 2–3, **943 MB and 1,095 MB**, streamed until 06:18:11 and 06:18:24 | Plex log (`Completed after connection close`) |
| 06:16:23 | **Last HR packet reaches the kiosk.** `device-manager.transport_stalled`, with no matching `resumed` on this page instance | frontend |
| 06:16:33 | Video finally starts (attempt 3) | `playback.started` |
| 06:17:46 | Roster empty: `heartRateDeviceCount:0` | `participant.roster.build` |
| **06:17:55** | **Session ends by itself after 130 s** (`fitness.tick_timer.stopped ranForMs=130040`; governance → `pending`, `activeParticipantCount:0`) | frontend |
| 06:17:59 / 06:18:06 | Server kills the **sensor bridge's** WebSocket as stale; the bridge logs "WebSocket connection lost". It is still reading the strap at ~47 readings/min (HR 94–106) | backend, garage container log |
| 06:17 | Server relays **0** `fitness` broadcasts that minute (68 the minute before) | `eventbus.broadcast` counts |
| 06:18:11, 06:18:24 | `proxy.timeout` (60 s) on both abandoned video streams | backend |
| 06:19:05 | Playing video stalls at 151 s | frontend |
| 06:19:37–39 | Music enabled by hand; "Thunder" mounts. Plex serves the whole file in 512 ms at 06:19:46, but the track **never starts** | frontend, Plex log |
| 06:20:05, 06:20:18 | **Kiosk page reloaded twice** | `frontend-start` |
| 06:20:26 | **Plex 404** again on "Back 1" | Plex log |
| 06:20:40 / 06:20:55 | Recovery attempts 1–2; the video starts at 06:20:57 | frontend |
| 06:21:03 | Seek to 114 s. Plex streams **530 MB** for it (until 06:22:21), but the kiosk never plays past it | frontend, Plex log |
| 06:21:10–36 | Music: "Ready To Go" mounts, stalls, and remounts on its startup deadline. Plex sees **no request for it until 06:21:27** and then serves it in 578 ms. "Space Jam" finally plays at 06:21:36 | frontend, Plex log |
| 06:21:17 / 06:21:29 | Video stall-jolt rungs 1–2 (URL refresh, then remount) | frontend |
| **06:22:05** | Jolt rung reload hits **Plex 404** (`Permission denied`). Video dead. HR transport stalls; **93 s without a packet** on the kiosk | Plex log, frontend |
| 06:22:05–06:24:39 | Garage bridge still reading the strap throughout (HR 75→86→66). The server relays 46, then 15, then 8 fitness broadcasts per minute | garage container log, backend |
| 06:23:29, 06:23:53 | More Plex 404s on "Back 1": three from this audit's own probe, one from the kiosk (06:23:53) | Plex log |
| 06:23:56 / 06:23:59 | Sensor bridge WebSocket lost / killed stale | garage log, backend |
| 06:24:29 | Kiosk WebSocket killed stale; reconnects; HR resumes 06:24:39 | backend, frontend |
| 06:24–06:25 | "Back 1" becomes readable again after a Plex `checkFiles` re-check (see media-source healing) | Plex log (206 from 06:25:58) |
| 06:24–06:32 | HR on the kiosk flaps stalled/resumed every 3–12 s (stalls up to 51 s) | `device-manager.transport_*` |
| 06:30:00, 06:34:00 | Kiosk WebSocket killed stale again | backend |
| 06:34:43, 06:36:05 | **Kiosk page reloaded twice more** | `frontend-start` |
| 06:36:07 | Video "Week 3 Day 5 - Lower Body" (`plex:674560`) loads; music "What's Up" starts 06:36:09 | frontend |
| 06:36:14 | **Music paused by the app** (`playback.paused source:controller`) the instant governance saw the still-loading video as "paused" | frontend |
| **06:36:22–06:36:25** | **Five play/pause taps in three seconds on the video, and every one is logged as a *pause*** (`source:controller-toggle`, `readyState:0`, `currentTime:0`) | frontend |
| 06:36:31–35 | Soft-reinit recovery; the video starts 06:36:35 and the music resumes the same millisecond | frontend |
| 06:35–06:39 | NAS burst peaks: ~6,616 Fitness files at mode 0000 by 06:35; all back to 777 by ~06:39 | host `find` during this audit |
| 06:39:25–06:40:07 | **No HTTP request from the garage reaches the backend for ~40 s.** The music remount's `fetch-media` resolves 36 s late | `http` middleware logs, frontend |
| 06:41:23–24 | Music finally starts at 170 s, then a user tap pauses it | frontend |
| 06:42:17–06:43:13 | Video stalls at 342 s and 374 s; jolt ladder remounts; resumes | frontend |
| 06:45 | Session winds down | — |

---

## Symptom 1 — heart rate stopped flowing

**Root cause: network loss between the garage PC and the prod host.** Confidence: **high** that this is the mechanism; **undetermined** which physical component is failing.

The strap and the sensor bridge were healthy:
- The garage container logged steady readings the whole time: ~47 per minute from 06:15 to 06:21, and still 13–34 per minute through the 06:22–06:24 stall, with values changing plausibly.
- The fingerprint reader's `overheated` rests are unrelated; they don't touch HR.

What failed was delivery, on **both** WebSocket legs that cross the garage ↔ prod link:
- **Bridge → server.** The server killed the bridge's socket as stale (no pong for 60–90 s) at 06:17:59 and 06:23:59. The bridge logged "WebSocket connection lost" at 06:18:06 and 06:23:56, with HR still being read. The server relayed **0** fitness broadcasts in the 06:17 minute, and 46, then 15, then 8 per minute during 06:22–06:24.
- **Server → kiosk.** The server killed the kiosk's socket as stale at 06:12:59, 06:15:29, 06:24:29, 06:30:00, 06:34:00 and 06:38:30. `device-manager.transport_stalled` (no packet for 1.2 s) fired 39 times, with gaps up to **93 s** (06:22:05–06:24:39) and 51 s (06:26:09–06:27:00).

**The first session ended because of this.** The last packet reached the kiosk at 06:16:23. `DeviceManager.pruneStaleDevices` then aged the strap out: `deviceCount:0` at 06:18:00, roster empty from 06:17:46. The session closed at 06:17:55 with `activeParticipantCount:0`. Its successor, `fs_20260928062054`, only started after the page reload.

**The link measured this morning** (06:40–06:55, after the session; ICMP and TCP):

| From → to | Loss |
|---|---|
| prod host → garage PC | **25% → 62.5% → 70%**, worsening over 30 minutes; flat across 1/s, 5/s and 20/s, so not rate limiting |
| garage PC → prod host | **45–74%** |
| garage PC → router / NAS / living-room Shield | **0%** |
| prod host → router / NAS / Shield / Portal | **0%** |
| garage PC → the two macvlan containers on the prod host's NIC | **82–83%** |
| TCP connect prod host → garage (40 tries) | 2 failed, 13 took >500 ms (SYN retransmits). Control hosts: 0 failed |

The ARP entries are stable on both sides, and each resolves to the other's correct MAC, so this is not a duplicate IP. Interface counters show no errors, and both links negotiate 1 Gb/s full duplex. Loss is equally bad to the macvlan addresses behind the prod host's physical port. So the fault lies in the **switch path between the garage's port and the prod host's port**, not in either machine's IP stack or firewall. Traffic from either host to the router is clean, so the lossy segment is one the router path does not cross.

**History:** server-side `eventbus.client_stale` kills per day were 5, 21, 25, 9, 22, 10 (Sep 21–26), then **40 on Sep 27 and 54 on Sep 28**. The link has been degrading for at least two days.

**Undetermined:** which cable, port or switch is failing. Deciding that needs the switch's port error counters and link-flap history, or swapping the garage's cable and port. That is hands-on work this audit cannot do.

## Symptom 2 — the videos failed

Two causes, stacked.

**2a. NAS mode-zeroing, which produced Plex 404s.** Confidence: **high.**
Plex's own log, for exactly the moments the kiosk saw `media-error 404: Not Found`:

```
06:15:45.225 ERROR - Error opening file '"…/Max Built - S01E03 - Back 1.mp4"' - Permission denied (13)
06:15:45.225 Completed: 404 GET /library/parts/762015/…/file.mp4
```

The same happened at 06:16:00, 06:20:26, 06:22:05 and 06:23:53. The file's mode read `0000` on the host at ~06:33, with its change time still Sep 1. A scan of the Fitness share found **6,616 files at 0000** at ~06:35, and **all back to 777** by ~06:39. This is a transient burst reported by the NAS, the same failure class as 2026-09-25 (see `reference_nas_mode000_files_plex_404`). The NAS itself is not reachable for its own logs, so what triggers the bursts is **undetermined**.

**2b. The garage link starving the streams that did open.** Confidence: **high.**
Plex's log shows it served every 206 request quickly. Whole music files arrived in 0.5–0.8 s, and video requests streamed at full speed. The kiosk still stalled:
- The first playback froze at 151 s (06:19:05).
- The seek to 114 s never played, even though Plex pushed 530 MB for it.
- The 06:42 stalls at 342 s and 374 s.

**2c. The player made both worse.** Confidence: **high** (code read plus logs).
- `usePlaybackHealth.js` `RECOVERABLE_MEDIA_ERROR_CODES = [2, 3]`. A 404 on a direct-play `src` arrives as **MediaError 4**, so the error was ignored. Nothing reacted until the 15 s startup deadline.
- Every recovery then reloaded the same unreadable file, spending the 5-attempt budget on something no reload could fix.
- **Abandoned streams were never cancelled upstream.** Each remount left its predecessor's request running: `ProxyService.#proxyWithRetry` pipes `proxyRes` to `res` and never listens for the client closing. Plex logged transfers of **943 MB, 1,095 MB, 530 MB, 272 MB and 50 MB** for requests the player had already abandoned, each ending in `proxy.timeout` 60 s after data stopped. The two largest end near 1 GiB. That is *consistent with* the reverse proxy's default response buffering spooling whole files; this audit did not inspect the proxy config. That is ~2.9 GB pulled from the NAS during an incident, competing with the streams that mattered.

## Symptom 3 — the music failed

**Root cause: the garage link, plus the video coupling. Not Plex and not the NAS.** Confidence: **high.**

- Every music file (Thunder, Ready To Go, Space Jam, Seven Nation Army, What's Up) was served by Plex in full in 0.5–0.8 s with a 206. None of them appears in the permission-denied errors, and the Music share had 0 zeroed files. So the files were fine.
- Requests left the kiosk and **did not reach the server in time**:
  - "Ready To Go" mounted at 06:21:10, but Plex saw its first request only at 06:21:27, from the remount after the startup deadline.
  - At 06:39:32 the music remounted, and **no HTTP request from the garage reached the backend from 06:39:25 to 06:40:07**. Its `fetch-media` resolved at 06:40:08 and playback started at 06:41:23.
- **The music is silenced whenever the video is not playing.** `FitnessMusicPlayer.jsx:126` pauses the audio when `videoPlayerPaused`. `governanceProgressEnforcer.js:29` writes `setVideoPlayerPaused(paused || locked)` from the element's own paused state on every tick. So a loading, stalled or remounting video counts as "paused" and takes the music down with it. The log shows exactly that: `playback.paused source:controller` on "What's Up" at 06:36:14, the same instant as `governance.timers_paused`, while the video was still loading, and `playback.resumed` at 06:36:35.013, the same moment the video started. During the 06:15–06:24 video failures, the music could not have played even with a healthy link.

## Symptom 4 — play/pause did nothing meaningful

**Root cause: the buttons toggle the element's raw paused flag, which during load and recovery is the wrong question. Both players also show a state that isn't true, and no press is logged.** Confidence: **high** for the video; **medium** for the music, where presses are not logged at all.

**Video footer** (`FitnessPlayerFooterControls.jsx:23-27` → `useCommonMediaController.js` `toggle`, ~line 1586):
- `toggle()` does `mediaEl.paused ? play() : pause()`. While a video is loading or reloading, the loader has already called `play()`. The element therefore reports `paused === false` even though no frame is showing. A press meant as "play" **pauses the loader**.
- The evidence: 06:36:22–06:36:25, **five taps, five `playback.paused source:controller-toggle`**, all at `readyState:0, currentTime:0`, and not one resume. Something re-issued `play()` between taps, because each tap again found the element un-paused. Candidates are the recovery reload's autoplay and the pause/resume effects in `FitnessPlayer.jsx` (~lines 570–682). Which one it was is **undetermined**: debug-level events are not shipped to the log store.
- The icon lies at the start: `useCommonMediaController.js:1615` reports `isPaused: !seconds ? false : …`. At position 0 the footer always shows **Pause**, so a video that never started looks like it is playing.
- While a video is recovering, its own recovery ladder reloads and re-plays on a timer, so any press is overridden within seconds.

**Music** (`FitnessMusicPlayer.jsx:377-388`, `handleTogglePlayPause`):
- It calls `toggle()` and then flips its local `isPlaying` **blindly** (`setIsPlaying(prev => !prev)`), whatever the element actually did. If the element was stalled or remounting, the displayed state and the real state diverge.
- The coupling effect (line 126) then pauses the music again on the next `videoPlayerPaused` transition. A press made while the video is stuck is undone the moment the video's state changes.
- **No press is logged.** Only the element-level `playback.paused/resumed` shows up (for example 06:41:24 `controller-toggle` on "What's Up"), so how many presses were ignored cannot be reconstructed.

This repeats the failure class of 2026-09-22 (`docs/_wip/plans/2026-09-22-fitness-play-means-play.md`, "41 play presses overruled"). That fix covered governance holding a stale lock. It did not cover loading, recovery or cross-player coupling.

## Shared and contributing factors

| Factor | Role | Confidence |
|---|---|---|
| Garage ↔ prod host packet loss (58–83%, worsening) | Common cause of the HR loss, stream starvation, WebSocket kills, late requests and music failure | High (mechanism); cause of the loss undetermined |
| NAS transient mode-0000 burst (~06:15–06:39) | Video 404s | High |
| Player ignores MediaError 4; retries an unreadable file | 15 s dead time per attempt; recovery budget wasted | High |
| Proxy does not cancel upstream on client disconnect | ~2.9 GB of wasted NAS/Plex reads mid-incident; 60 s `proxy.timeout`s | High (proxy code); medium (response-buffering explanation) |
| Music slaved to the video's paused state | No music while the video struggles | High |
| Toggle semantics during load; `isPaused` false at t=0 | Presses pause the loader; wrong icon | High |
| No logging of user presses (music or footer) | Unobservable; this audit could only infer | High |
| Strava harvester blocks the event loop for 22 s (06:05) | Not in the failure window; a real risk if it lands mid-workout | High (it happened); not causal today |
| Backend health | Event loop p99 ≤ 83 ms and max ≤ 0.7 s from 06:15 to 06:24; Plex metadata calls fast. **The backend was not the bottleneck** | High |
| Deploy/restart | None during the session | High |

## What is already being fixed (this session, media-source healing)

Built in the same session as this audit, for fault 2a:

- **Proxy.** A Plex 404 on `/library/parts/…/file.*` is retried briefly (3 × 500 ms). If the refusal persists, the proxy answers **503 `source-unreadable`** instead of 404.
- **`POST /api/v1/media-source/check`** (`MediaSourceHealer`). It asks Plex to re-check the file (`checkFiles=1`). It then asks the host, through a restricted forced-command SSH key, to inspect the file and restore `0777` on a zeroed file and its zeroed siblings. It re-checks with Plex. After 2 minutes unreadable, it sends one push alert. Every rung is logged (`media.source.heal.step`, `…resolved {resolvedBy}`).
- **Player "source unavailable" wait.** A refused source is waited out instead of reloaded. No recovery attempts are spent. The player polls with backoff (2 s, 4 s, 8 s, then every 15 s, for up to 30 minutes) and shows "Video file unavailable — retrying · m:ss". It resumes at the saved position the moment the file is readable.

That work addresses 2a and part of 2c. It does **not** address the network fault, the music coupling, or the controls.

## Remaining fixes needed

1. **The garage ↔ prod network path (urgent, physical).** Replace or reseat the garage PC's cable and switch port, and read the switch port error counters on both ends. Until this is fixed every garage workout will repeat today's symptoms, whatever the software does. Verify with `ping` from the garage to the prod host: loss should read 0%, as it does to the router today.
2. **Decouple the music from the video's transient states.** `FitnessMusicPlayer.jsx:120-141` should pause music only for an *intentional* video pause (a user press, a governance lock, a voice memo), not for loading, stalling or recovery. `governanceProgressEnforcer.js:29` feeds `videoPlayerPaused` from the raw element state; it needs a separate "user or governance paused" signal.
3. **Make play mean play during load and recovery.** In `FitnessPlayerFooterControls.jsx:23-27`, and in `useCommonMediaController.js` `toggle()`, base the decision on user intent, not `mediaEl.paused`. If the player is loading or recovering, a press should either be a no-op with feedback, or record the intent "play" so recovery honours it. Fix `isPaused: !seconds ? false` (`useCommonMediaController.js:1615`) so the icon reflects reality at t=0.
4. **Stop the music toggle from guessing.** In `FitnessMusicPlayer.jsx:385-387`, derive `isPlaying` from the element's `play`/`pause` events rather than flipping local state.
5. **Log every user press**, on both footer play/pause and music play/pause, with the element state at press time: `fitness.control.press {control, intent, elPaused, readyState, status}`. Today the presses are invisible.
6. **Cancel upstream on client disconnect.** In `ProxyService.#proxyWithRetry`, destroy `proxyReq` when `req`/`res` emit `close` before the response ends. Also consider disabling response buffering on the reverse proxy for `/api/v1/proxy/plex/library/parts/` so abandoned media requests do not spool up to 1 GB each.
7. **Don't let a harvester stall the event loop.** The Strava `homeMatch` step (06:05, 22 s) should yield, or run off the main loop.
8. **Alert on WebSocket stale kills.** The server already logs `eventbus.client_stale`. A daily count jumping from ~15 to 54 was a two-day warning of today that nobody saw.

## Queries used

```bash
# All events in the window (UTC)
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_time:[2026-09-28T12:30:00Z, 2026-09-28T14:10:00Z] | sort by (_time)' -d limit=200000

# WebSocket server-side kills
curl -s {env.log_store_url}/select/logsql/query -d 'query=_msg:"eventbus.client_stale" AND _time:7d | stats by (_time:1d) count() as n'

# HR delivery on the kiosk
curl -s {env.log_store_url}/select/logsql/query -d 'query=_msg:~"device-manager.transport_" AND _time:[…]'

# Plex's own view of the video part (Plex log, local time)
grep "library/parts/762015/" "Plex Media Server.log" | grep -E "Request:|Completed|Permission denied"

# Link loss (run from the garage PC)
ping -c 100 -i 0.1 -q <prod-host>   # vs <router>, <nas>
```
