# Player — Lessons Learned & Gotchas

A distilled knowledge base of the recurring failure modes, breakthroughs, and
non-obvious traps in the video/audio Player subsystem and the Plex transcode
pipeline. Mined from ~30 audits, bug reports, and plans (Jan–Jun 2026) plus git
history. Read this before changing anything in `frontend/src/modules/Player/`,
`frontend/src/lib/Player/`, or `backend/src/1_adapters/content/media/plex/` — most
of these were paid for twice.

Each entry: the trap, the root cause, the fix, and the source. Themes are ordered
from the deepest cross-cutting patterns down to specific gotchas.

---

## 1. The cross-cutting patterns (what keeps breaking)

These five patterns recur across many incidents. If a Player bug feels familiar,
it is almost certainly one of these.

### Closure stale-state in intervals and watchdogs
Effects with deliberately sparse dependency arrays (to avoid re-creating timers on
every render) capture **stale closure values**. An interval reads the `seconds`
from when the effect last ran, not the live value — e.g. `playback.fps_stats`
reported `currentTime: 107` for an entire 5.5-minute session while playback
advanced to 441s. The fix is always the same: keep a parallel `latestDataRef`
(updated on every relevant event) and read from `ref.current` *inside* the
closure, never the destructured prop. Same trap for watchdog callbacks captured at
first render against a `resilienceBridge` whose identity changes every render —
track it in a ref. *(2026-05-23; commits a7b82e15e, f0300b394)*

### Recovery feedback loops (recovery actions look like progress)
Recovery logic verifies success by watching `currentTime` / buffer growth — but
its own micro-seeks and buffer pokes **fire `timeupdate` events indistinguishable
from real playback**. `markProgress()` then resets the escalation counter, so the
pipeline can never climb past its first strategy. Result: a `nudge` that fires
every ~7s forever while the playhead drifts *backward* ~1ms per cycle. Fix: gate
progress detection on **real forward motion past an epsilon (~0.05s) beyond the
stall playhead**, and never let a recovery-initiated seek write `lastProgressTs`
(suppress with a short-lived flag). *(2026-04-19, 2026-05-23; commits 2450f829d, 450d30072)*

### Plex transcode session lifecycle (stale / idle-reaped sessions)
Plex idle-reaps a transcode session after ~5–10 min of inactivity (or a long
pause). The cached MPD still points at the dead session UUID, so segment fetches
404 forever — and an in-place `<dash-video>` reload re-reads the *same cached MPD*
and fails again. The only cure is a **fresh session**: cache-bust the MPD URL with
a timestamped `_refresh` param so the backend proxy mints a new session. Detection
is a sliding window (3× `dash.error` code-28 in 10s) plus direct routing of
dash.error 27/28 → `hardReset({ refreshUrl: true })`, capped at 3 attempts/mount.
*(2026-02-28, 2026-05-23; commits 145f57e49, ea9e6fdd8, 049c567ab, 9544248ee)*

### Layered watchdogs that are each correct but don't compose
Several incidents had *every* resilience layer working as designed in isolation,
yet the system still hung — because no layer owned the gap between them. The
canonical case: a seek to `duration` lands on a zero-byte trailing fragment;
`seeking` stays `true` forever, the stall watchdog **exempts near-end playheads**
(correctly, to avoid recovering a natural end), dash.js never calls
`endOfStream()` for a zero-byte fragment, and queue-advance is wired only to the
HTML5 `ended` event which never fires. Lesson: near-end and edge states need an
explicit **end-of-content watchdog** (`paused && currentTime ≥ duration−0.5 &&
no-progress for 3s → onAdvance()`), not just "the other layer will catch it."
*(2026-05-23; commit bcc284228)*

### Global mutable state on the hook function object
`useCommonMediaController` carries dictionaries on the *function object*
(`__appliedStartByKey`, `__lastPosByKey`, `__lastSeekByKey`) to survive remounts.
Two failure modes: (a) keys never evict → unbounded growth across 500+ track
sessions (use a bounded LRU or GUID-scoped keys); (b) a boolean "start applied"
flag set on the original mount **blocks the resume seek on a resilience remount**,
so video plays from t=0 for ~2 min. Fix the latter with a per-mount Symbol:
`__appliedStartByKey[assetId] === mountIdRef.current`, so every mount gets exactly
one chance regardless of which remount path it took. *(2026-02-08, 2026-03-10; commit
documented in video-resume-resilience-remount-fix)*

### DOM-order selector hazards
Recovery and keyboard code reaches for the media element via
`querySelector('audio, video, dash-video')`. After the ambient-music layer was
hoisted above the renderer, that selector started returning the **ambient
`<audio>`** (first in DOM), silently stalling rate-change and recovery on the wrong
element. Tag non-primary media (`data-role="ambient"`) and exclude it; prefer the
controller's `getMediaEl()` (shadow-DOM-aware) over raw selectors. *(commit fa2b643fd)*

---

## 2. Transcode & encoding

The encoding decision is the single biggest lever on whether video plays smoothly.
See `playback-encoding-resilience.md` for the full pipeline; these are the lessons.

### Caps disqualify the COPY path, not just direct-play (the 60fps breakthrough)
A frame-rate / bitrate / resolution cap is a Plex *profile limitation*: it
disqualifies stream **copy**, forcing a full re-encode. Sending a 30fps cap on a
60fps h264 source (whose only real mismatch was opus audio) forced libx264 to
re-encode the whole video at half-realtime → sustained buffer starvation. Fix:
gate all caps on `allowDirectStream` (video codec is h264/hevc), **not**
`allowDirectPlay`. Copyable video then streams at native framerate/bitrate; only
audio transcodes and the container remuxes. *(2026-06-16; commit 8ab41199b)*

### `Number(null) === 0` → "uncapped" → CRF-quality 20 Mbit encodes
Passing `null`/`0` for a bitrate cap reaches Plex as `maxVideoBitrate=0`, which
Plex reads as **uncapped** and encodes at CRF-16 visually-lossless (~20 Mbit), CPU-
brutal even at `veryfast`. Caps must be **ceilings, never amplifiers**: only a
positive finite value lowers the ceiling; null/0 resolves to the default (8 Mbit /
1080p / 30fps). *(2026-05-18; commits a3af4cea7, f809cbff8)*

### Advertising AV1/VP9 was tried and reverted — MSE can't append them
A fix once advertised `av1,vp9` to Plex so it would DirectStream modern codecs for
the browser to decode natively. It was **superseded**: dash.js/MSE rejects AV1/VP9
fMP4 appends to a SourceBuffer, so those streams must be transcoded to h264/hevc
anyway. The current advertisement is **h264,hevc only** — which also doubles as the
guard that makes `directStream=1` safe (Plex won't copy a codec the client didn't
advertise). Don't re-add av1/vp9 without solving the MSE append problem first.
*(2026-05-18; commit c62839c1b advertised them, later reverted)*

### Forcing re-encode to fix GOP misalignment was tried and reverted
Irregular-GOP sources direct-streamed (`-codec copy`) produce DASH segments that
don't align to MPD slot boundaries; dash.js GapController jumps the holes (81 jumps
/ 7 stalls over a 2h14m film). The fix `force re-encode by default` was **reverted**
(e54e13a55) because re-encoding everything is the exact CPU trap that causes the
encode-bound stall. The accepted trade-off is the copy path plus gap recovery, not
blanket re-encode. *(2026-05-26; commits 9f7cea71f then e54e13a55)*

### Idle-reaped session leaves a cache hole on resume
Pause a transcode → Plex pre-rolls a few segments, goes idle, kills the ffmpeg
producer after ~5 min. The session dir survives with stale cached segments but no
producer, so resume gets 78-byte empty bodies and cascades into multiple cold-start
sessions. Mitigation: tear down on pause + rebuild on resume (cheaper than the
cache-hole failure), or send periodic keepalive pings. *(2026-05-18)*

### 0-byte 200s are "transcode warming", not errors
While Plex spins up an encoder (especially deep seeks into long videos) it returns
**HTTP 200 with empty bodies** for 60–90s. The 404-handler doesn't catch these, so
the buffer "loads" nothing and recovery exhausts (~45s) before the transcoder is
ready. Detect ≥4–6 consecutive 0-byte fragments → emit `transcode-warming`, keep
the loading overlay up, back off patiently, and extend the startup deadline.
*(2026-03-11)*

### Recovery must back off, not cold-start-storm
On sustained slow transcode, every recovery attempt that spawns a *new* session
piles CPU on the still-running old ones (4 sessions in 20 min, 17 stalls in one
minute). Use exponential backoff (4→12→36→108s, maxAttempts 5 → ~160s window) and
retry the *same* session on `error 27` before cold-starting; only mint fresh on a
manifest 404. *(2026-03-11, 2026-05-18)*

### Differentiate permanent vs transient load failures
`loadMediaUrl` returns a `{ url, reason }` union — `metadata-missing`,
`non-playable-type`, `audio-key-missing` (permanent: short-circuit) vs `transient`
(network/timeout: retry). Treating transient as permanent triggered doomed FKB
fallbacks. *(commits ae1747174, fdbf04264)*

---

## 3. Stall detection, recovery & remount

### Don't trust `timeupdate` cadence for stall detection
`timeupdate` fires at ~4Hz with no regularity guarantee; a busy event loop pauses
it 1.5–2.5s while playback is fine, producing false stalls that "resolve" in ≤10ms.
Verify against `mediaEl.currentTime` advancement directly — this filtered ~91% of
false positives. *(2026-05-23; commit 450d30072)*

### Direct-play bypass reuses the broken session during recovery
SinglePlayer skips the `/play` API when a queue item already has `mediaUrl+format`
(a normal-playback optimization). On a recovery remount this bypass returns the
*same dead* transcode URL, so recovery fails repeatedly. Skip the bypass whenever
`remountDiagnostics` is set, forcing a fresh `/play` that mints a new session.
*(2026-02-28)*

### Remount is the hammer — don't swing it at slow-but-progressing DASH
A 15s startup deadline remounted the player 3× while DASH was *actually* streaming
fragments after a deep seek; each remount tore down DASH and restarted fragment
loading from scratch, defeating the buffering that was about to succeed. Distinguish
truly-stuck (no fragment activity) from slow-but-progressing (buffer/fragments
growing) and extend the deadline when there's activity. *(2026-03-10)*

### Check `buffered` before nudging; escalate on duration loss
Nudging `currentTime -= 0.001` when the position is outside all buffered ranges
never helps — it just re-loops. Check `mediaEl.buffered` first; if outside, skip to
seekback/reload. And if `duration` goes `null` the source is broken: jump straight
to softReinit instead of wasting nudge/seekback cycles. *(2026-03-07)*

### Seek forward past a stall, not backward to the same frame
A DASH recovery loop did 200+ seeks in 20 min, all backward to the same starved
position, invisibly burning CPU/battery with a frozen frame and no UI. Cap retries
(3–5), seek **forward** past the stall, and surface a "Skip / Retry" overlay after
the cap. *(2026-03-05)*

---

## 4. Seek, resume & position

### DASH needs a client-side seek even when the URL has `?offset=`
Plex declares the **full timeline** in the MPD regardless of `?offset=N`; segments
before the offset are 0-byte. The client must seek to the offset itself. A past
optimization that skipped the seek "because Plex already offset it" played the
wrong content audibly for ~88s and lost the resume position. Always seek; add
`initialStart` to the recovery-seek fallback chain. *(2026-03-07; commit 15aae5278)*

### Clear seek intent only after `seeked` confirms it
Reload recovery cleared `lastSeekIntentRef` immediately after assigning
`currentTime`, but DASH can silently ignore the assignment — the next cycle then
has no safety net. Clear only on the `seeked` event, with a ~5s timeout fallback
that preserves the intent. Validate the landing too: a recovery seek can snap to a
segment boundary far from target (observed 4813s → 9533s); a 2s post-recovery
watchdog should check `|currentTime − expected| < tolerance`. *(2026-03-07)*

### Reset zoom on the `playing` transition, not when seek "pending" clears
Zoom reset keyed off `isSeekPending` going false — which happens when `currentTime`
reaches target, *before* playback resumes — so zoom snapped back mid-buffer with the
spinner still up. Track a full seek lifecycle (idle → seeking → buffering → playing)
and reset only on `playing`. *(2026-02-02, 2026-02-10)*

### A 600ms seek grace period kills spinner-on-quick-bump
Any seek triggered the overlay, so a 200ms ffwd bump flashed a spinner. Suppress
overlay triggers during a 600ms grace window; only show if the seek actually stalls
past it. Keep a sticky ref of the last valid intent-position display so the overlay
doesn't flash the *current* position when `targetTimeSeconds` is nulled early.
*(2026-02-10)*

---

## 5. Overlays, autoplay & loading states

### Autoplay block: `autoplay` attribute is not enough
The `autoplay` attribute silently fails in some WebViews/Firefox without throwing,
and Firefox won't fire `canplay` when blocked (readyState stuck at 1). Poll the
inner `<video>` after ~3s; if still paused, call `play()` to surface
`NotAllowedError`, then show a click-to-play overlay that resumes from a user
gesture. *(2026-03-08)*

### One owner for autoplay; tear down the prior Player first
Two components both parsed URL autoplay params and each mounted a Player ~500ms
apart — the second's spinner sat forever atop real playback. And a second
`play-now` mounted a new Player without tearing down the first, leaving a
"Starting…" overlay up for *2h14m*. Single-owner the autoplay path (ActionBus), and
always dismiss/tear-down prior Player overlays before mounting a new one. *(2026-03-22, 2026-05-26)*

### Always give the loading overlay an exit
A "Starting…" / "Loading…" state with no timeout strands the user (music player
stuck forever; fullscreen spinner with no tap-to-exit). Add a startup timeout
(~30s) that auto-dismisses or surfaces "unavailable — tap to retry", validate the
queue has ≥1 resolvable item before showing the overlay, and ensure the fullscreen
toggle out-ranks the spinner (`pointer-events: none` on the spinner). *(2026-02-04, 2026-03-22, 2026-05-01)*

### Suppress per-second overlay logging when playing
`PlayerOverlayLoading` emitted `playback.overlay-summary` every second
unconditionally (~60 lines/min of noise that buried real diagnostics). Only emit
when the overlay is visible or status isn't "playing". *(2026-03-22)*

### The spinner must never sit over visibly-playing video — advancement is the authority
A `waiting`/`buffering` flag can get stuck `true` when its matching `playing` event
is missed — most commonly because a resilience recovery swapped the `<video>` element
out from under the listeners. The overlay then shows a buffering spinner on top of
video that is plainly advancing. Fix: sample the media clock directly (a self-contained
poll that keeps working when the metrics bridge goes quiet during a stall) and expose
an `isAdvancing` signal — `currentTime` moved forward past an epsilon between samples
while not paused/ended. Gate the buffering state on it: `isBuffering = (isWaiting ||
isStalledEvent) && !isAdvancing`. Forward motion overrides any stale waiting flag.
*(confirmed in code: `usePlaybackHealth` `isAdvancing` + the `useMediaResilience`
`isBuffering` gate; tested in `usePlaybackHealth.test.jsx`)*

### Re-attach element listeners when the element identity changes
The health hook's event listeners and frame poll capture the element at setup time. A
`softReinit` bumps React's key → a brand-new `<video>`/`<audio>` element, and listeners
left bound to the dead element silently report stale state — the exact failure that
strands a spinner after a mid-playback recovery. Bump an `elementGeneration` counter
when the live element identity changes (detected by the advancement poll) so the
listener and frame-poll effects re-bind to the new element. *(confirmed in code:
`usePlaybackHealth` `elementGeneration`)*

### Hide the loading overlay when paused at duration
After a seek to duration on a zero-byte tail, `mediaEl.seeking` stays `true`
forever and the overlay spammed "Seeking…" for 87s. Detect paused-within-0.5s-of-
duration and render "Ended" (or nothing) instead. *(2026-05-23; commit bcc284228)*

---

## 6. Render performance

### Roster/cache rebuilds cascade into render storms
A single "removed → idle" status oscillation drove FitnessChart to 12–15
renders/sec for 2.5+ min: new object references each tick → `useMemo` recompute →
cache `useEffect` → new objects → re-render. Shallow-compare before
`setParticipantCache` (only create a new object when data actually changed) and
remove contradictory status corrections. *(2026-03-13)*

### Don't put volatile state in media-event-listener effect deps
Including `isStalled` in the effect that attaches `timeupdate`/`ended`/`playing`/…
listeners tore down and re-attached them on every stall flip. Read such values from
a ref and keep them out of the dependency array; remove old listeners before adding
new ones (named refs or `{ once: true }`) to stop accumulation across reloads.
*(2026-02-08)*

### Guard FPS deltas across element reloads
A recovery reload resets `totalVideoFrames` to 0 while `lastFpsCheck` keeps the old
(~658k) value → huge negative FPS. Guard `if (total < lastCheck) { reset; skip }`.
*(2026-03-13)*

---

## 7. Diagnostics (so the next incident is debuggable)

- **Validate recovery *outcomes*, not just attempts.** Position corruption went
  undetected because nothing checked whether the seek landed. Add a post-recovery
  position watchdog + drift logging. *(2026-03-07)*
- **Structured logging beats `DEBUG_MEDIA` console output** (which is off in prod).
  Instrument start-time decision, intent-vs-actual, seek phases, which recovery
  strategy ran and whether it worked, duration-loss escalation, and every mutation
  of the global position dicts. *(2026-03-07)*
- **Emit telemetry when a watchdog bails.** The near-end stall exemption silently
  did nothing; `playback.at-duration-stuck` (+ a seek stack trace) makes the
  stuck-at-duration class diagnosable. *(commits 79d532424, 49321969c)*
- The renderer's `dash.*` events (fragment bytes, buffer level, error codes) plus
  `playback.*` are the first thing to read on any stall — see the README's
  diagnostics table.

---

## Breakthrough commits (fixed whole classes)

| Commit | What it fixed |
|--------|---------------|
| `8ab41199b` | Direct-stream h264/hevc → native-60fps copy instead of forced re-encode |
| `145f57e49` + `ea9e6fdd8` + `049c567ab` | Stale-session watchdog + dash-error 27/28 → fresh-session URL refresh |
| `450d30072` | Soft-stall detection reads `currentTime` directly — killed ~91% of false stalls |
| `a7b82e15e` | `latestDataRef` pattern — fixed the stale-closure class across subsystems |
| `723e810ea` | Queue engine rebuilt from spec by item identity (19 fixes in one pass) |
| `bcc284228` | End-of-content handling for zero-byte trailing fragments |

---

## Related docs

- `docs/reference/player/README.md` — subsystem architecture & resilience layers
- `docs/reference/player/playback-encoding-resilience.md` — the transcode decision pipeline
- `docs/reference/media/dash-video-resilience.md` — stall/seek troubleshooting runbook
- `docs/runbooks/fitness-player-recovery.md` — operator-facing recovery
- Source incidents live under `docs/_wip/audits/`, `docs/_wip/bugs/`, and `docs/plans/` (dates cited inline above)
