# Fitness Governance — Four-Issue Audit (2026-06-26)

Audit of four reported issues in the fitness governance / cycle-game UX. Each was
researched against current `main`. **All four are legitimate** and have a clear
path forward. Findings below cite concrete `file:line` evidence; recommendations
are scoped so each can ship independently.

| # | Issue | Verdict | Effort | Risk |
|---|-------|---------|--------|------|
| 1 | Challenge success ring turns green (confused with HR "active" zone) | ✅ Real | S | Low |
| 2 | Distance race never ends / no mercy-kill | ✅ Real (button exists, auto-timeout doesn't) | M | Low–Med |
| 3 | Success toast lacks a zone-colored pill | ✅ Real | S | Low |
| 4 | Governance keeps running while video is paused | ✅ Real (the big one) | M | Med |

---

## Issue 1 — Success ceremony green ring collides with the "active" zone color

### What happens today
When an **HR challenge** (e.g. "get 5 people to warm") is satisfied, the entire
circular progress ring flips to green and a ✅ emoji is shown in the center.

`frontend/src/modules/Fitness/player/overlays/ChallengeOverlay.jsx`:
- `SUCCESS_RING_COLOR = '#22c55e'` (line 12)
- On success the ring stroke becomes that green: `ringColor: isDonePhase ? SUCCESS_RING_COLOR : zoneInfo.color` (line 332), consumed at `resolvedRingColor` (line 379) and `strokeOffset = isSuccess ? 0 : …` (full ring) (lines 367–371)
- Center glyph swaps to ✅: `{isSuccess ? '✅' : normalizedTime}` (line 454)

The collision: **green `#22c55e` is also the "active" HR zone color**
(`DEFAULT_ZONE_COLORS.active = '#22c55e'`, ChallengeOverlay.jsx line 22; mirrored
in `_zones.scss`). So a completed *warm* (yellow) challenge briefly renders as a
green ring — reading as "active zone," exactly the wrong signal.

### The reference pattern already exists (cycle overlay)
The **cycle** challenge overlay solves this correctly — it keeps the target
visualization and overlays a *small green check badge* in the avatar corner
instead of recoloring the whole indicator.

`frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` (lines ~402–404):
```jsx
{done && (
  <span className="cycle-challenge-overlay__done-check" aria-hidden="true">✓</span>
)}
```
`CycleChallengeOverlay.scss` `&__done-check`: a 30px absolutely-positioned
(`top:-6px; right:-6px`) green circle with white ✓, `cycle-overlay-done-check-pop`
animation. The same badge idiom is reused in `UnlockPrompt.scss` (avatar-corner
verified badge).

### Recommended path
In `ChallengeOverlay.jsx`, on success:
1. **Keep `ringColor = zoneInfo.color`** (persist the target/zone hue) — drop the
   `isDonePhase ? SUCCESS_RING_COLOR` branch at line 332. Keep the ring fully
   swept (`strokeOffset = 0`) so it reads as "complete."
2. **Replace the center ✅** with a small green check badge element styled like
   `cycle-challenge-overlay__done-check` (extract the SCSS into a shared mixin or
   copy the `challenge-overlay__done-check` class into `ChallengeOverlay.scss`).
3. Center can show the zone label or a static "Done" instead of the emoji.

Net effect: ring stays warm/orange/etc., a green ✓ badge signals success — no
"active zone" confusion. Self-contained to one overlay + its SCSS.

---

## Issue 2 — Distance races run forever; need a mercy-kill (auto + manual)

### What happens today
Races are configured by `winCondition: 'distance' | 'time'`
(`frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js` ctor, lines 10–18).

- **Time races have a hard cap:** `this.elapsedS >= this.timeCapS` (CycleRaceEngine.js line 151).
- **Distance races end ONLY when every rider finishes or is DNF'd:**
  - Engine: `winCondition === 'distance' ? [...riders].every(r => r.finishTimeS != null) : …` (CycleRaceEngine.js lines 149–151)
  - Controller: `_isFinished()` → `every(r => r.finishTimeS != null || this.dnf.has(r.userId))` (`CycleRaceController.js` lines 148–154)

So a distance race waits indefinitely for the slowest rider. The only escape
hatches:
- **DNF on idle** (0 RPM): `raceIdleDnfS` (~20s after moving) / `raceStartGraceS`
  (~30s before first move) — `CycleRaceController.js` lines 115–123. This only
  fires if a rider *stops pedaling*; a slow-but-steady rider never DNFs.
- **Manual "Finish race" button already exists:** `onFinishRace` →
  `controller.finishNow()` (`CycleGameContainer.jsx` lines 1194–1203, rendered at
  ~1411 with `data-testid="cycle-game-finish"`). `finishNow()` marks unfinished
  non-ghost riders DNF and jumps to results (`CycleRaceController.js` lines 137–146).

**Verdict:** The manual kill exists but (a) may be visually buried, and (b) there
is **no automatic mercy-kill** once a winner crosses — the user's core complaint.

### Recommended path (config-driven, as requested)
Add a distance-race mercy timeout in `CycleRaceController` / `CycleRaceEngine`,
driven by config keys alongside the existing `distance_goal_default_m`,
`time_cap_default_s`, `race_idle_dnf_s` (read in `CycleGameContainer.jsx` lines 68–73).
Support whichever trigger(s) we want — recommend offering both:

- `race_mercy_after_winner_s` (e.g. 45) — once the **first** rider finishes,
  start a clock; end the race when it elapses. (Simple, predictable — recommended default.)
- `race_mercy_lag_pct` (e.g. 0.5) — alternatively/additionally, DNF a rider whose
  `cumulativeDistanceM` is < `goalM * (1 - lag_pct)` *after* the winner finishes.

Implementation notes:
- The winner-finish timestamp is available: `rider.finishTimeS` is set the tick a
  rider reaches `goalM` (CycleRaceEngine.js lines 122–125). Track
  `firstFinishElapsedS = min(finishTimeS)` and compare against `elapsedS`.
- On mercy expiry, reuse the existing `finishNow()` path (DNF the stragglers →
  results) so placement/recording logic is unchanged (`raceRecord.js` writes
  `final_distance_m`, `final_time_s: null` for DNF — lines 8–19).
- Make the manual **"Finish race"** button more prominent / always-visible during
  racing so an operator can "put everyone out of their misery" on demand.

This is additive and low-risk: time races and the all-finish path are untouched;
only distance races gain an upper bound.

---

## Issue 3 — Success toast should show the zone in a colored pill

### What happens today
The challenge-success toast is built by
`frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js`:
- HR success: `{ icon: '🏆', title: 'Challenge complete!', subtitle, variant: 'success' }`
  where `subtitle` = `"${actualCount} of ${requiredCount} people reached ${zoneLabel}"`
  (lines 46–49).
- It has `c.zoneLabel` (line 16) **but not the zone color** — the producer only
  receives the governance challenge snapshot, not zone metadata.

Rendered by `FitnessToast.jsx` (title/subtitle/contributors only; no zone pill).
Pushed from `FitnessContext.jsx` (~line 2313) via `pushFitnessToast(buildChallengeToast(...))`.

The toast carries zone *text* but gives no color signal — exactly the missing
"colored pill" the user wants (warm/hot/fire badge).

### The pill component already exists
`GovernanceStateOverlay.scss` has a production zone-pill system:
`.governance-lock__pill.zone-{cool|active|warm|hot|fire}` driven by the
`$lock-zone-hues` SCSS map (subtle bg + colored border per zone). This is the same
idiom to reuse in the toast.

### Recommended path
1. **Thread zone color into the toast.** Zone metadata is already available in
   `FitnessContext.jsx` as `zoneMetadata` (built by `buildZoneMetadata(zoneConfig)`,
   ~line 1559). At the `pushFitnessToast(buildChallengeToast(...))` callsite, pass a
   resolver (like the existing `resolveUserName`) so `buildChallengeToast` can add
   `zone: { id, label, color }` to the toast payload (mirror the cycle/HR branches).
2. **Render a pill in `FitnessToast.jsx`.** When `toast.zone` is present, render a
   rounded pill near the title using the zone color (reuse the `zone-{id}` class
   convention or inline `borderColor/background` from `toast.zone.color`).
3. Add the `zone` field to `fitnessToastSlot.js` `normalizeToast` passthrough and
   to `FitnessToast` propTypes.

Self-contained; no governance-engine changes.

---

## Issue 4 — Governance keeps running while the video is paused (the important one)

### What happens today
The engine **has** pause infrastructure but **only wires it to buffering stalls,
not user/voice-memo pauses**, and even the pause gate doesn't cover cycle challenges.

**(a) Pause is only triggered by stalls, never by an actual pause.**
`GovernanceEngine._setupPlaybackSubscription` subscribes to exactly two events
(`GovernanceEngine.js` lines 1538–1555):
```js
subscribeToAppEvent('playback:stalled',    () => this._pauseTimers());
subscribeToAppEvent('playback:recovered',  () => this._resumeTimers());
```
There is **no** `playback:pause` / `playback:play` subscription. And the player
only *emits* `playback:stalled/recovered` from buffer-resilience state — it never
emits a pause event when `isPaused` flips (`FitnessPlayer.jsx` stall effect,
~lines 413–451; `isPaused` is tracked at ~line 153 / set in `handlePlayerProgress`
~1536–1586 but only forwarded to the music player via `setVideoPlayerPaused`,
never to governance).

**(b) The `evaluate()` pause-gate doesn't cover cycle challenges.**
`evaluate()` early-returns when `_timersPaused` (GovernanceEngine.js lines 1982–1986),
which would stop HR-zone evaluation — *if* it were ever set on pause. But
`_evaluateCycleChallenge()` accumulates `initElapsedMs` / `rampElapsedMs` /
`phaseProgressMs` and depletes `cycleHealthMs` with **no `_timersPaused` guard**, so
a cycle challenge would keep ticking even if the gate fired.

**(c) Voice memo pauses video but not governance.**
`FitnessContext` voice-memo openers call `setVideoPlayerPaused(true)` +
`musicPlayerRef.pause()` (e.g. `openVoiceMemoReview` ~lines 966–1013) but never
`setGovernanceSuspended(true)`. `GovernanceAudioPlayer` is ducked via its `paused`
prop (cosmetic audio only), so the *engine* keeps scheduling pulses, starting
challenges, and evaluating the base-requirement lock behind the memo overlay.

**(d) The correct mechanism already exists and is proven.**
`setSuspended(true)` makes `evaluate()` go fully dormant via `_resetToIdle()` and
return (GovernanceEngine.js lines 1207–1216 and the suspend check at lines 2186–2197).
It's already used for the CycleGame race takeover
(`FitnessContext.setGovernanceSuspended`, ~lines 1170–1175). This is exactly the
"suspend all governance, including the always-on minimum threshold" behavior the
user describes — it just isn't wired to pause.

### Recommended path
Drive the existing **suspend** path from pause state (preferred over the
half-built `_timersPaused`/stall path, because suspend already silences the base
"always-on" lock and clears active challenges — matching "no governance events
while paused"):

1. **Single source of pause truth.** In `FitnessContext`, whenever the video is
   paused — user pause **and** voice-memo open (the existing `setVideoPlayerPaused(true)`
   callsites) — also call `setGovernanceSuspended(true)`; on resume, `setGovernanceSuspended(false)`.
   Centralize so every pause origin (memo review/list/capture, manual pause) is covered.
2. **Cover programmatic pause too.** Ensure `FitnessPlayer`'s `isPaused` transitions
   feed the same suspend toggle (so a remote/keyboard pause that doesn't go through
   the voice-memo path also suspends governance).
3. **(Defense in depth)** Add a `_timersPaused`/`_suspended` guard inside
   `_evaluateCycleChallenge()` so cycle timers can't advance even if some future
   pause path bypasses the top-level suspend check.
4. On resume, `setSuspended(false)` already calls `_triggerPulse()` → clean
   re-engagement on the same `this.media` (media is preserved while suspended).

Caveat to confirm during implementation: suspend currently **clears the active
challenge** (`_resetToIdle`). For a brief pause we likely want the in-flight
challenge to *resume*, not restart. If preserving mid-challenge state matters,
either (a) extend `setSuspended` with a "freeze, don't reset" variant, or
(b) wire pause to `_pauseTimers()` + add the cycle-challenge guard from step 3
and the missing `playback:pause`/`play` emissions. **Recommend deciding
freeze-vs-reset semantics before building** — it's the one open product question.

---

## Suggested sequencing
1. **Issue 4** first (correctness — stops phantom challenge completions; highest user impact).
2. **Issues 1 & 3** together (both are overlay/toast color-signal polish, low risk, share zone-color plumbing).
3. **Issue 2** (additive config + a more prominent manual button).

## Decisions (locked 2026-06-26)
- **Issue 2:** Mercy-kill is **configurable**, with **seconds-after-winner** as the
  default trigger (`race_mercy_after_winner_s`). Lag-percent may be added later but
  is not required for v1.
- **Issue 4:** On pause, the in-flight challenge must **freeze and resume** — preserve
  progress, do NOT reset. This means a new "freeze" suspend variant is needed (the
  existing `setSuspended` resets via `_resetToIdle`), OR drive pause through
  `_pauseTimers()` + add the missing cycle-challenge guard and `playback:pause/play`
  emissions. Freeze semantics are the requirement.
