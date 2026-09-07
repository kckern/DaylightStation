# Player Media Resilience Delta (MediaResilliancy vs. main)

_Last updated: November 23, 2025_

This document captures every change made under `frontend/src/modules/Player/**` on the `MediaResilliancy` branch relative to `main`, along with the purpose, intended benefit, and remaining risks or open questions. Use it as the authoritative review log before merging.

## High-Level Themes

1. **Media resilience architecture** – `Player.jsx` now orchestrates its own recovery flow (remounts, hard resets, telemetry) via the new `useMediaResilience` hook, entry GUID bookkeeping, and resilience overlays.
2. **Operational overlays** – `PlayerOverlayLoading` and `PlayerOverlayPaused` replace the old generic loading overlay with richer diagnostics, manual recovery affordances, and pause-state UX.
3. **Instrumentation** – `playbackLog` emits detailed breadcrumbs for remounts, overlay visibility, and timers, intended to aid postmortems.
4. **Styling alignment** – `Player.scss` adds layout support and debug-strip styling for the new overlays.

---

## File-by-File Detail

### `frontend/src/modules/Player/Player.jsx`

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Expanded React stack** – imports now include `useState`, `useEffect`, `useMemo`, plus new helpers (`useMediaResilience`, `mergeMediaResilienceConfig`, `guid`, `playbackLog`, overlay components). | Provide the hooks/utilities needed for stateful resilience orchestration and telemetry. | Enables the Player to keep local copies of meta, accessors, and playback metrics instead of depending on child components. | File now has significantly more responsibilities; violates SRP and increases cognitive load for future contributors.
| **Entry GUID normalization (`ensureEntryGuid` + `entryGuidCache`)** | Ensure every active source has a stable `guid` for wait-keys, remount keys, and logging even when upstream items omit it. | Prevents remount storms triggered by key churn and improves log readability. | WeakMap fallback allocates GUIDs per object; if upstream reuses plain objects, GUID churn still possible. Consider pushing GUID generation upstream to avoid silent coupling.
| **Default state factories (`createDefaultMediaAccess`, `createDefaultPlaybackMetrics`)** | Provide safe, memoized defaults when the player mounts or switches items. | Eliminates `undefined` checks around consumer callbacks and keeps resilience hook inputs stable. | Factories return new object references; repeated resets may trigger unnecessary re-renders. Consider `useMemo` or constants for truly static defaults.
| **Stateful tracking (`resolvedMeta`, `mediaAccess`, `playbackMetrics`, `pendingSeekSeconds`, `remountState`)** | Mirror the SinglePlayer’s resolved metadata and playback telemetry inside the parent so resilience routines have synchronous access. | Parent can trigger reloads, overlays, and health checks without querying deep children. | Adds multiple layers of derived state that can drift from actual playback if callbacks fail. Requires rigorous effect ordering to avoid stale metrics.
| **`activeSource` / `singlePlayerProps` memoization with fallback GUID injection** | Decouple queue vs. single item selection logic and guarantee stable props for `SinglePlayer`. | Reduces repeated object spreads and ensures React keys include resiliency nonce. | Extensive memo chains make it harder to reason about when `SinglePlayer` actually re-renders; debugging key mismatches might be tricky.
| **`forceSinglePlayerRemount` + remount diagnostics** | Provide a central way (used by resilience hook or manual triggers) to restart the `SinglePlayer`, optionally seeking back to an intent time, and capture a diagnostic context. | Gives resilience flows deterministic control over remount cadence and surfaces telemetry via `playbackLog`. | Remount is now the hammer for many situations; risk of hiding root causes behind automatic retries. Repeated remounts can leak timers or break analytics if not throttled.
| **`handleResilienceReload` pipeline** | Interpret `useMediaResilience` reload requests (document reloads, hard resets, remounts) and choose the least-destructive action. | Allows granular fallbacks before forcing a full page reload and keeps the playback UI alive. | Coupling to `mediaAccess.hardReset` relies on SinglePlayer wiring; if the child stops registering handlers, resilience silently degrades. Needs tests around each branch.
| **Media access registration (`handleRegisterMediaAccess`)** | Let SinglePlayer hand back imperative helpers (`getMediaEl`, `hardReset`, `fetchVideoInfo`) so overlays/resilience can operate without querying DOM directly. | Centralizes native element access, enabling overlays to display live ready/network state. | API surface is implicit; no typing enforces the shape, so regressions are likely if SinglePlayer evolves. Consider TS typedefs or PropType validation.
| **Playback metrics + overlays** | SinglePlayer now reports `seconds`, `isPaused`, `isSeeking` to the parent, which feeds `useMediaResilience` and overlays. | Overlays can show accurate timers, and resilience logic can differentiate pause vs. stall cases. | Metric updates rely on frequency heuristics; flooding `setPlaybackMetrics` could cause renders each frame. Need throttling if data spikes.
| **`withTransport` helper + ref exposure rewrite** | Wrap imperative calls to prefer controller transports (if provided) before falling back to DOM element APIs. | Abstracts over audio/video implementations and avoids direct DOM mutation when transport objects expose richer methods. | Swallows errors silently and returns `null`, which can hide broken controller implementations. Add logging or throw in development to avoid silent failures.
| **Player props expansion** – `SinglePlayer` now receives callbacks: `onResolvedMeta`, `onPlaybackMetrics`, `onRegisterMediaAccess`, `seekToIntentSeconds`, `onSeekRequestConsumed`, `remountDiagnostics`, `wrapWithContainer=false`. | Give SinglePlayer the hooks it needs to report into the new parent-level resilience system. | Keeps resilience logic centralized in one place while leaving rendering to SinglePlayer. | Backwards compatibility risk: existing SinglePlayer implementations must implement all new callbacks and semantics, but no prop gating/checks exist.
| **New overlay composition** – wraps SinglePlayer with `PlayerOverlayLoading` and `PlayerOverlayPaused`, and provides idle fallback overlays when no item is active. | Surface buffering/paused feedback consistently and keep resilience telemetry alive even when no media is active. | Improves UX (clear status, manual recovery tap target) and observability (debug strip). | Overlay visibility tied to `overlayProps` from `useMediaResilience`; if that hook misbehaves the player may render empty. Consider default props or guards.
| **Export surface change** – re-export `PlayerOverlayLoading`/`Paused` instead of the removed `LoadingOverlay`. | Keep external modules aligned with new overlay components. | Prevents downstream imports from breaking when `LoadingOverlay` disappears. | Consumers still referencing `LoadingOverlay` will break; no compatibility shim provided.

### `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` (new)

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Dedicated loading overlay component** with stateful timers, media element inspection, manual reset triggers, and logging hooks. | Replace the minimal overlay with one that can act as a resilience control plane. | Operators can see ready/network states, intent seek position, and trigger hard resets via spinner interactions; telemetry logs capture every second of the stall. | Component is 300+ lines with many responsibilities (timers, logging, DOM inspection). Lacks unit tests and can easily drift from Player expectations. Needs decomposition or hooks.
| **Failsafe timer (`hardResetDeadlineMs`)** | Automatically request a hard reset if buffering exceeds a configured deadline. | Reduces cases where playback stays stuck indefinitely without user action. | Without backoff, repeated hard resets may lead to thrash, especially on poor networks. Add exponential backoff or cap tries.
| **`getMediaEl` polling for diagnostics** | Sample DOM media element properties once per second to render into debug strip. | Provides precise insight into HTMLMediaElement state (readyState/networkState). | Polling may keep the main thread busy on low-power devices; consider requestAnimationFrame or event-based updates. Swallowing errors with `console.warn` may spam logs.
| **Extensive logging via `playbackLog`** for overlay summaries and visibility transitions. | Provide structured breadcrumbs for DevOps dashboards. | Makes it easier to correlate user reports with telemetry. | Logging every second could generate high-volume logs. Consider gating behind debug flag or sampling.
| **User interactions mapped to `emitHardReset`** | Provide touch/click/double-click handlers that request a hard reset. | Gives power users a recovery lever without reloading the page. | Without UI affordance explaining the gesture, accidental taps could trigger disruptive resets.

### `frontend/src/modules/Player/components/PlayerOverlayPaused.jsx` (new)

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Pause-specific overlay** that reuses loading overlay styles but shows a pause glyph and timecode. | Differentiate “healthy pause” from “stalled buffering” states, matching user expectations. | Cleaner UX; avoids showing spinner when user simply paused. | Relies on `pauseOverlayActive` flag managed elsewhere; if state desyncs, pause overlay might appear while stalled. No resilience logging here—consider parity with loading overlay.
| **Fullscreen gesture blocking** | Prevent overlays from interfering with platform fullscreen toggles. | Stops inadvertent fullscreen exits/enters when interacting with overlay controls. | Adds duplicated logic from loading overlay; consider extracting shared hook.

### `frontend/src/modules/Player/Player.scss`

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Commented out `cursor: none` on `.player`** | Restore cursor visibility (possibly for desktop debugging). | Developers regain a cursor while testing overlays and resilience flows. | TV app behaviour may regress if cursor should stay hidden. Confirm platform-specific styling before shipping.
| **`.loading-overlay` layout tweaks** – padding, box sizing, center alignment moved to flex column wrapper. | Support richer overlay content (debug strip, timers) with better spacing. | Keeps overlay responsive and ensures spinner stays centered regardless of viewport. | Extra padding could intersect with existing video letterboxing; test across themes.
| **`.loading-overlay__inner` container** | Provide structural wrapper for spinner vs. debug strip. | Simplifies aligning timer vs. log sections. | Adds another DOM level; ensure accessibility tree remains reasonable.
| **Pointer cursor on `.loading-spinner`** | Communicate that spinner is now clickable (manual hard reset). | UX hint for manual recovery interactions. | On TV devices without pointer, cursor style has no effect; consider conditional styling to avoid confusing remote users.
| **`.loading-debug-strip` styles** | ~~Visualize telemetry text appended by `PlayerOverlayLoading`.~~ **Gone.** The strip was removed from the markup; only the styles remain in `Player.scss`, and the 1Hz diagnostics poll that fed it was deleted on 2026-08-16 (Task 4.9) — no caller ever supplied the `getMediaEl` it was gated on, and its readings went into state nothing rendered. Buffer runway and dropped frames come from `usePlaybackHealth` instead. | — | — |

---

## Residual Risks & Recommendations

1. **Complexity creep** – `Player.jsx` now mixes queue management, resilience orchestration, overlay layout, and imperative APIs in one file. Refactor into composable hooks or context providers to keep future features manageable.
2. **Implicit contracts** – Handshake between `SinglePlayer` and parent (`onResolvedMeta`, `onRegisterMediaAccess`, transport API) is undocumented. Add TypeScript types or at least a shared JSDoc contract to reduce accidental breakages.
3. **Logging volume** – Overlay logging emits every second when visible. Validate that `playbackLog` backend can handle the traffic, or throttle to warning scenarios.
4. **User-facing debug strip** – Consider hiding the debug strip for production viewers or behind a `debug` feature flag to avoid confusing non-technical users.
5. ~~**Remount storm safeguards** – Add metrics/guardrails to avoid infinite remount loops (e.g., limit to N remounts per minute, escalate to full page reload after threshold).~~ **Done 2026-08-16** — see [Remount storm brake](#remount-storm-brake) below. (The escalate-to-page-reload half was deliberately not built: freezing the key already stops the damage and keeps the viewer's page, and a reload on a kiosk is a worse outcome than a frozen player.)

---

## Stale Transcode Session Recovery

When a Plex transcode session dies during startup, the MPD manifest cached
by dash.js still points at the dead session UUID and segment fetches 404
forever. The recovery pipeline handles this with three coordinated pieces:

1. **Fast detection** — `lib/staleSessionWatchdog.js` factory counts
   `dash.error` code-28 events in a 10s sliding window. At 3 errors, it
   fires `stale-session-detected` into the resilience state machine,
   escalating *before* the 15s startup deadline would have fired.

2. **URL refresh on reload** — when `useMediaResilience.triggerRecovery`
   is called with a reason for which `shouldRefreshUrlForReason(reason)`
   returns true (startup-deadline variants + `stale-session-detected`),
   the `refreshUrl:true` flag propagates through:

   `useMediaResilience.onReload` → `Player.handleResilienceReload` →
   `mediaAccess.hardReset({ seekToSeconds, refreshUrl:true })` →
   `VideoPlayer.hardReset` appends `?_refresh=<Date.now()>` to the
   `<dash-video>` `src` attribute → dash.js re-fetches MPD → backend
   proxy mints a fresh Plex transcode session.

3. **Exhaustion surface** — after `maxAttempts` recovery cycles
   (default 5), the state machine enters `exhausted` and
   `PlayerOverlayLoading` renders a retry button wired to
   `retryFromExhausted`, which resets the shared recovery ledger and
   restarts the pipeline.

### Observability events

| Event | Level | When |
|---|---|---|
| `playback.stale-session-detected` | warn | Watchdog crossed its threshold |
| `playback.stream-url-refreshed` | info | `src` was cache-busted and load() called; payload has `previousSrc`, `nextSrc` |
| `playback.stream-url-refresh-skipped` | warn | No `src` attribute was available to refresh |
| `playback.stream-url-refresh-failed` | warn | `setAttribute` threw; payload has `previousSrc`, error `message` |
| `resilience-recovery-exhausted` | info | All attempts consumed; payload includes `urlRefreshesAttempted` |

See `docs/runbooks/fitness-player-recovery.md` for operator-facing
troubleshooting.

---

## Fatal Media-Error Recovery

A dead pipeline is not a stall. When the HTTP body behind `mediaUrl` goes away
mid-playback — the app container that serves the Plex stream proxy being
recreated by a deploy, say — Chromium raises `PIPELINE_ERROR_READ`, sets
`MediaError.code = 2`, fires `error` and `pause`, and fires **nothing else**. No
`waiting`. No `stalled`. The buffer can still report hundreds of seconds cached
ahead, because the bytes already fetched are still sitting there; what died is
the connection that would have fetched the next ones.

That made the failure invisible to `isStuck`, whose other three causes
(`isStalled`, `isBuffering`, `effectiveSeeking`) are all **starvation** signals —
each means "the element wants more data and is waiting for it". A dead pipeline
is not waiting for anything. On 2026-09-03 a container redeploy killed the proxy
17 minutes into an audiobook; playback stayed dead for five minutes with 284.92s
still buffered, until a person re-dispatched the item by hand. The backend had
been back after 9 seconds.

### The signal

`usePlaybackHealth` now listens for `error` and reads the state off the
**element**, not off the event — that is where the spec puts `MediaError`, and it
is what the browser leaves behind after a mid-playback pipeline death. Two
element signals are recorded, and they latch together:

- `errorCode` — `MediaError.code` from the last `error` event, or `null`.
- `errorWhilePlaying` — whether that error *interrupted* playback, as opposed to
  landing on an element somebody had already parked.

They surface as two derived flags of deliberately different width. Do not
substitute one for the other:

| Flag | Means | Consumed by |
|---|---|---|
| `hasMediaError` | a recoverable code is latched — the pipeline is dead | the fourth cause in `isStuck` |
| `mediaErrorStoppedPlayback` | recoverable code **and** it stopped playback | the user-intent classification, and nothing else |

Only codes 2 (`NETWORK`) and 3 (`DECODE`) count as recoverable
(`RECOVERABLE_MEDIA_ERROR_CODES`). Code 1 (`ABORTED`) is raised by our *own*
`load()` — which is precisely what `hardReset` calls — so arming on it would feed
the recovery back into itself. Code 4 (`SRC_NOT_SUPPORTED`) means the media is
unplayable and a fresh URL cannot change that; jolting it only spends the ledger.
The filter is pinned end to end: `usePlaybackHealth.mediaError.test.jsx` pins the
per-code truth table at the source, and `useMediaResilience.mediaError.test.jsx`
pins that a code-4 element never reaches `onReload`.

### Where the term sits in `isStuck`, and why the placement is the whole trick

```js
const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing && !atEnd
  && (isStalled || isBuffering || effectiveSeeking || hasMediaError);
```

`hasMediaError` is a fourth **disjunct inside** the `!clockAdvancing` conjunct. It
must stay there. The code is latched, and nothing in the ladder clears it —
clearing is the element's job, at `playing` or at a re-seed. The `!clockAdvancing`
guard is what makes a still-latched code harmless in the meantime: once playback
resumes the clock advances, and `isStuck` falls to false whether or not the code
has cleared yet.

Hoisting `hasMediaError` out to the top level as its own term is an inviting
"simplification", since it reads like an independent reason to be stuck. Leave it
where it is — but know exactly what that buys. A mutation pass found this the one
change to the feature that the suite does not catch: hoist it and all 589 tests
still pass. The reason appears to be that the bad state is unreachable rather than
untested. `clockAdvancing` needs the advance poll to see `currentTime` move on a
non-paused element, which needs playback to have resumed, which fires `playing` —
and `playing` clears the code in the same listener effect on the same element. One
event settles both conditions, so there is no window in which the code is latched
while the clock advances.

Treat the placement as defence in depth: it costs nothing and it keeps the
predicate honest about what "stuck" means. Do not write a test for it — that would
mean constructing a state the system cannot enter.

### An errored element is not a paused element

`useMediaResilience` classifies user intent from the reported `isPaused`, and a
`paused` intent hard-returns the whole monitoring effect — the ladder never arms.
An error that stops playback also pauses the element, so without a guard the fix
disarms itself on exactly the failure it exists for. The guard is narrow on
purpose:

```js
} else if (isPaused && pauseIntent !== 'system' && !mediaErrorStoppedPlayback) {
```

`mediaErrorStoppedPlayback`, not `hasMediaError`. A track the *user* paused,
which then errors, must never be self-resumed: rung 0 on the audio path falls
through to a remount of `<audio autoPlay>`, so overriding there would restart a
deliberately-paused bedtime story every time a deploy killed the stream.

The classification is by the pause's **age**, not by event order:

```js
const parkedForMs = pausedAtMs === null ? null : monotonicNowMs() - pausedAtMs;
const errorWhilePlaying = mediaEl.paused !== true
  || (parkedForMs !== null && parkedForMs <= ERROR_PAUSE_COINCIDENCE_MS);
```

Order was rejected because the browser dispatch order of `error` versus `pause`
is **unverified** across the fleet, and the spec does not require a `pause`
alongside an `error` at all. An order-based check would work on one browser and
invert the entire fix on a pause-first one, with no test failure and no log line
to say so: the ladder would never arm again. The 500ms window absorbs event-task
scheduling (the real gap is ~0ms), not human reaction time, so it sits far below
any plausible interval between a person pressing pause and a server dying.

The age is measured on a **monotonic** clock (`performance.now()`). With
`Date.now()`, an NTP step backwards makes the elapsed time negative, negative
satisfies the window, and a long-parked element gets classified as
error-stopped — resuming a paused track by itself, which is the exact regression
the narrowing exists to prevent.

### Clearing, and one deliberate asymmetry

A latched `hasMediaError` that never cleared would hold `isStuck` true forever,
burn both rungs plus the ledger cap, and park the player in `exhausted`. It
clears three ways:

1. **On `playing`** — the pipeline is alive again.
2. **On re-seeding against a new element** — the seed adopts *that* element's
   `mediaEl.error?.code`, so a remount that actually fixed playback stops looking
   broken, and a new element that really is broken still reports as such.
3. **On a `waitKey` change** — a new load cycle resets all element signals to
   their defaults.

The asymmetry: a re-seed **adopts a pre-existing `errorCode` but never sets
`errorWhilePlaying`**. We never observed that element playing, so we cannot claim
anything interrupted it. The element reads as "dead pipeline" (which can arm the
ladder) but not as "the error stopped playback" (which could override a pause).

### Rung 0 forks by media type, and neither branch subsumes the other

Ladder rung 0 (`stall-jolt-refresh-url`, `forceRemount: false`) takes a different
road per renderer, and each road is closed by a different one of the clearing
mechanisms above. This is why both had to ship.

- **Video / dash** takes the in-place branch. `VideoPlayer` registers a
  `hardReset`, so `Player.handleResilienceReload` finds one, and the
  `hardResetInvoked && !forceRemount` short-circuit returns before any React
  remount — deliberately, because remounting through a `setTimeout` breaks the
  gesture chain and Firefox starts blocking autoplay after three or four cycles.
  Same element, same `waitKey`, no element-generation bump, therefore **no
  re-seed**. Only the `playing` clearing catches this path. `playing` is
  guaranteed on success: `hardReset` calls `load()` unconditionally, which forces
  `readyState` back to `HAVE_NOTHING`, so any resumption has to climb back
  through `HAVE_FUTURE_DATA` and queue a `playing`.
- **Audio never takes it.** `AudioPlayer` registers only `getMediaEl` and
  `fetchVideoInfo` — no `hardReset` — so rung 0 falls through to a real remount,
  the element generation bumps, and the **re-seed** is what clears the code.

Worth remembering: the incident's own media type does not take the in-place path
at all.

The one case where `playing` never arrives is `play()` rejecting with
`NotAllowedError` — a kiosk autoplay gate. There the code stays latched, but
playback did not in fact resume, so an armed ladder is correct rather than a
defect.

### Termination

What terminates this is the ladder's rung count, and it binds long before the
ledger's cap. `STALL_JOLT_LADDER` has two rungs, so a code that never clears
reaches "no third plan" after `STALL_JOLT_GRACE_MS` (9.5s) plus two
`STALL_JOLT_STEP_MS` (6s each) — about 21.5s — and declares exhaustion. The
shared ledger's 5-attempt session cap is looser by a wide margin: its backoff
(4s, 12s, 36s, 108s between attempts) needs roughly 160s of continuous stuck time
to spend.

Do **not** add a test asserting "rung 1 never fires". Between rung 0's `load()`
and the `playing` that clears the code, `hasMediaError` is true while
`clockAdvancing` is false, so escalating is legitimate if the fresh transcode
takes longer than a step to start — identical to `isBuffering`, which also only
clears at `playing`. The invariant worth pinning is that it **stops**, and that
is what the exhaustion test asserts.

### Observability

| Event | Level | When |
|---|---|---|
| `playback.playback-health`, `data.event = media-error` | warn | The element raised `error`. Payload: `errorCode`, `errorMessage`, `errorWhilePlaying`, `parkedForMs`, `currentTime`, `readyState`, `networkState`. |

Health events all ship under the single `_msg` of `playback.playback-health`; the
discriminator is `data.event`, so query on that rather than expecting a
`playback.media-error` message. `readyState`/`networkState` separate a transient
network death from `NETWORK_NO_SOURCE`, which is the distinction the response
turns on. `parkedForMs` is `null` when the element was not parked at all, and
otherwise says how the pause was classified: at or under
`ERROR_PAUSE_COINCIDENCE_MS` it was the error's, above it was somebody's.

### What this does NOT cover

Three real gaps. Nobody should read the section above as coverage they have.

**1. `useMediaErrorReporter` is still inert.** It is the only `'error'` listener
in `Player.jsx`, and it returns before attaching unless an `onError` prop is
supplied. The only caller that supplies one is `DancePartyWidget` (for both of
its Players); every other surface, including `ScreenPlayer`, leaves it dead.
Wiring it through would be **wrong** as things stand: `onError` feeds
`useQueueController`, where it means "this content is unplayable, give up" — the
`empty-queue` branch calls `clear()`. Firing that on a transient proxy blip would
abandon the item rather than resume it, which is strictly worse than the silence
it replaces. Telemetry comes from the health hook's `media-error` event instead.

**2. The audio path does not recover from pause-then-error.** If the user pauses
and *then* the stream dies, the item does not recover until it is re-dispatched.
For audio and video, `isPaused` reaches the resilience hook only through
`SinglePlayer.handleProgress` ← `onProgress` ← `onTimeUpdate` — its sole emit
site; the controller's `play`/`pause` listeners are pure telemetry. A dead
pipeline cannot fire `timeupdate`, so `isPaused` freezes at `true` and pressing
play cannot unfreeze it, because unfreezing needs the playback that is broken.
`userIntent` stays `paused`, the monitoring effect hard-returns, the ladder never
arms. This is the status quo for that narrow case rather than something the guard
broke, and it is the deliberate cost of not self-resuming a paused track — but it
is still broken there, and it does not deserve to be filed as "recovery merely
deferred". It does **not** affect `ContentScroller`, where `useMediaReporter`
emits metrics from the element's own `play`/`pause` listeners, so `isPaused`
flips back to false on play and the latched error arms the ladder then.

**3. The DASH path is open.** Whether dash.js sets `el.error` on a segment 404
was never measured, and no DASH assertion shipped — writing one would only
restate our assumptions about a library we did not observe. What *is*
established: the shared `recoveryLedger` serialises every actor through one
cooldown and one session cap, and a denied request re-checks the same rung rather
than advancing it, so a concurrent stale-transcode recovery and a media-error
jolt would queue rather than double-fire. That bounds the blast radius; it does
not prove the trigger never doubles.

### The named follow-up

Gap 2 and the pause-age heuristic are the same piece of work. The repo already
holds the non-inferential signal: `lib/playbackToggleSource.js`'s
`readAndClearPauseSource(el)` tags pause provenance, and
`useCommonMediaController` already consumes it for `playback.paused` telemetry. A
pause our own transport initiated is *knowable*, with no window and no clock.
Plumbing that into `usePlaybackHealth` would retire `ERROR_PAUSE_COINCIDENCE_MS`
entirely **and** close the audio-path gap at the same time, because a play
*intent* is observable even when the playback it asks for cannot start. It
touches `useCommonMediaController` and `SinglePlayer`, which is why it was out of
scope here.

---

## Invariants — do not break these

A 2026-07-10 production soak found three defects in the merged resilience refactor,
all of the same shape: the code trusted a bare event instead of checking for genuine
forward motion. Two invariants and one ownership boundary keep them fixed. Full
writeup: `docs/_wip/bugs/2026-07-10-player-resilience-soak-findings.md`.

1. **`recordSuccess` requires strictly-forward playhead motion.** A progress event at
   a frozen position is NOT recovery. `usePlaybackHealth` bumps `progressToken` on any
   progress event — including the `playing` a jolt's own remount fires at the frozen
   playhead — without comparing seconds. The `useMediaResilience` effect gates
   `recordSuccess` on `evaluatePlayheadProgress` against a per-session
   `lastSuccessPosRef` baseline. Breaking this re-defeats the ledger's attempt cap and
   cooldown, and the jolt ladder loops at rung 1 forever (`f96a60a23`).

2. **`STALL_JOLT_GRACE_MS` must stay greater than `HARD_STALL_MS`.** Both ladders arm
   off the same soft-stall boundary; the expensive jolt (a fresh Plex transcode
   session) must not preempt the cheap controller nudge. When the grace was below the
   nudge deadline, nine hours of production logged zero `recovery-nudge` events.
   `stallJolt.test.js` pins the ordering (`b4aa2e6fd`).

3. **Ownership boundary: the jolt ladder does not handle end-of-content.** When a dash
   trailing fragment is zero-byte the element parks at `duration` with `ended === false`;
   jolting it re-seeks to the end and re-stalls. `useMediaResilience`'s `isStuck` has an
   `atEnd` guard (via the shared `isNearEnd` predicate in `lib/nearEnd.js`) that
   deliberately excludes this state from recovery. Advancing the queue at EOF belongs to
   `useEndOfContentWatchdog`, which is mounted in **both** `ContentScroller` and the dash
   `VideoPlayer` path — do not let it regress to one renderer only (that scoping is what
   caused the 2026-07-10 regression of a bug first fixed on 2026-05-23).

---

## Remount storm brake

On 2026-08-16 a piano kiosk opened **495 Plex transcode sessions in four minutes**
on one lecture. The video never played, and two overlapping sessions streamed the
same audio, which is what the family heard as an echo. Only three of roughly three
hundred teardowns went through `forceSinglePlayerRemount`; the rest were React
reconciliation reacting to a `singlePlayerKey` that would not hold still. The brake
therefore sits on the **key**, in `Player.jsx`, not on the explicit remount path.

### The cap

`REMOUNT_STORM_MAX_MOUNTS = 10` distinct keys per `REMOUNT_STORM_WINDOW_MS = 30000`
(`lib/remountStormGuard.js` holds the arithmetic; `Player.jsx` holds the wiring).

The cap has to clear the legitimate worst case: one initial mount plus the
five-attempt recovery ladder is six key changes inside about eight seconds, and a
viewer who then picks something else must not be turned away. Ten in thirty seconds
leaves that headroom while capping a runaway at 20 remounts per minute — the storm
ran about 124.

When the cap is exceeded the memo returns the **last admitted key**, so the media
element is not rebuilt. Content still swaps in place behind the frozen key.
`plexClientSession` is derived from the admitted key too, so the freeze also stops
SinglePlayer's metadata refetch (that effect depends on the session value); before
that was wired the brake stopped new transcode sessions but left roughly 124
`/api/v1/play/<id>` calls a minute running.

The one reachable false trip is **rapid manual skipping** — eleven "next" presses in
thirty seconds, which a child with a remote can produce. The consequence is mild:
content still swaps, and the recovery ledger's `mountId` is `resolvedWaitKey`, which
the brake does not gate, so per-item recovery budgets still reset per item.

### Re-arm

A tripped guard re-arms **one window after the trip**, evaluated lazily inside the
key memo — there is no timer, so nothing to leak or to fire after unmount. If no
render happens the guard simply stays tripped until one does, which is the correct
behaviour: nothing is being rebuilt in the meantime.

A tripped guard is deliberately **not** re-armed by a content change, tempting as
that is. In the storm the guid changed on every pass, so forgiving content changes
would clear the counter before it could ever count past one. Waiting out the window
means the brake holds while churn is in flight and lets go once it stops, so a
viewer who picks something else is never stranded for longer than one window.

### Reading `player-remount-storm`

| Event | Level | Meaning |
|---|---|---|
| `playback.player-remount-storm` | **error** | The cap was exceeded; the player key is frozen. Logged **once per trip**, not per rejected key. |
| `playback.player-remount-storm-rearmed` | warn | A window elapsed with the churn stopped; the next key will be admitted. |

Payload carries `frozenKey`, `rejectedKey`, `guid`, `playerType`, `waitKey`,
`waitKeyHash`, `isQueue`, `maxMounts`, `windowMs`. On a multi-surface fleet
`playerType` is what tells you whether the piano kiosk or the garage display
stormed.

### Reading `playback.identity-churn`

| Event | Level | Meaning |
|---|---|---|
| `playback.identity-churn` | warn | More than 10 distinct `waitKey` or `guid` values were seen by one mounted Player inside a rolling minute. |

Emitted **once per episode**, not once per value — a detector that fires 480
times is a second storm. The episode closes only when every dimension has
receded below the threshold, so a second line means a second burst.

`churningDimensions` is the field to read first: `guid` means content identity
is moving (something upstream is re-minting it, e.g. a caller re-creating a
`play` literal every render), `waitKey` alone means the nonce is climbing (a
recovery loop). On 2026-08-16 it was both. `distinct` carries the counts and
`samples` the three most recent values per dimension.

The counter is scoped to the **Player instance**, not to the media item.
Bucketing per guid is the natural reading of "per item", and in this incident it
would have counted nothing — the guid was itself what churned, so every bucket
would have held exactly one value.

> A legitimate `refreshUrl` recovery also changes identity, because
> `resolveMediaIdentity` falls through to `meta.mediaUrl`. It cannot reach this
> threshold on its own: the recovery ledger caps a session at 5 attempts with a
> 4s/12s/36s backoff. If you see a churn line whose `samples.guid` are near-
> identical signed URLs, read it as URL refreshes, not as content churn.

### Reading `waitKey` and `waitKeyHash`

Every player line carries the wait key twice, and the two names never swap
meanings:

| Field | Value | Use it for |
|---|---|---|
| `waitKey` | The key raw — `<identity>:<nonce>`, e.g. `IIni70e01E:7` | Grepping a line back to an item, and reading the nonce ordinal. A climbing `:N` **is** a remount loop. |
| `waitKeyHash` | 10 hex chars, FNV-1a of the same key | Joining to lines written before 2026-08-16, when `waitKey` in `useMediaResilience` / `usePlaybackHealth` WAS the hash. |

Two absences are named rather than merged: `(absent)` means no key was supplied,
`(empty)` means one was and it was blank. Before 2026-08-16 both — and `''` —
came out as `0000000000`, so every keyless player in the fleet shared one
apparent identity.

**Treat any occurrence as a real defect, not as the brake doing its job.** Tasks 1–4
of the 2026-08-16 work (stable `play` prop, content-derived media identity, this
brake, per-generation dash cleanup) should have driven the rate to zero. Seeing this
event means something upstream is still churning identity — a caller re-creating a
`play` literal every render, or a new field leaking into the identity derivation.
Start from `frozenKey` vs. `rejectedKey`: what differs between them is what is
churning.

### Why the dash cleanup fix is a prerequisite, not a sibling

Task 4 (`VideoPlayer` cleaning up **every** `<dash-video>` generation, not just the
first) has to land **before or with** the brake, never after.

A frozen key means new content arrives by **prop change** rather than by remount. So
`mediaUrl` moves, the `<dash-video>` element's own React key changes, and the element
is replaced **without `VideoPlayer` unmounting** — precisely the case Task 4 fixes.
With the old `[]`-deps cleanup effect, the freeze would have been actively harmful:
every frozen-key content swap would strand a live dash.js `MediaPlayer` still fetching
segments, with no `disconnectedCallback` to reap it. That is the same leak that
produced the doubled audio in the incident, and the brake would have manufactured
more of it.

---

Please update this README as further adjustments land so reviewers can continue to trace intent, benefits, and remaining concerns.
