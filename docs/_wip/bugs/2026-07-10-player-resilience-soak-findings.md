# Player Resilience Soak Findings — 2026-07-10

**Scope:** three defects a production soak found in the merged Player resilience
refactor (the consolidation landed on `refactor/player-resilience-consolidation`,
Phases 0–1, and merged to main). Fixes landed on `fix/player-resilience-soak-defects`.
**Related:**
- `docs/_wip/audits/2026-07-09-player-module-sedimentary-fixes-audit.md` — the audit that
  motivated the consolidation these defects came out of.
- `docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md` — the
  *same* stuck-at-duration failure, fixed once before for `ContentScroller` only.

---

## Soak evidence

Source: ~9h of production `docker logs` on 2026-07-10.

| Event | Count |
|---|---|
| `playback.stalled` | 6 |
| `playback.resilience-stall-jolt` | 5 |
| `recovery-nudge` | **0** |
| remounts | 0 |
| exhausted | 0 |
| cooldown-denied | 0 |

All five jolts were a single incident (`plex:674553`, first jolt `13:22:16Z`), and
**every one logged `rung=1 attempt=1`** — the attempt counter never climbed and the
cheap nudge rung never fired once in nine hours.

> **Counting note:** grepping `stall-jolt-refresh-url` double-counts — each jolt emits
> both a `playback.resilience-stall-jolt` event AND a `playback.player-remount` carrying
> the same `reason`. Count `"event":"playback.resilience-stall-jolt"`.

---

## The three defects share one root

The system could not tell **"the playhead moved forward"** from **"an event fired."**
Each defect is that same confusion at a different site. All three fixes teach the code
to check for genuine forward motion (or genuine end-of-content) rather than trusting a
bare event.

---

## Defect 1 — Ledger attempt cap defeated by phantom progress

**Evidence:** the five consecutive jolts all logged `rung=1 attempt=1`; the session cap
and cooldown never engaged.

**Root cause:** `useMediaResilience.js` called `getRecoveryLedger().recordSuccess()` on
any `playbackHealth.progressToken > 0`. `recordProgress` (`usePlaybackHealth.js`) bumps
that token on *any* progress event — including the `playing` event a jolt's own remount
fires at the frozen playhead — **without comparing seconds**. `recordSuccess` zeroed both
`count` and `lastAt`, wiping the attempt cap *and* the cooldown. So every jolt reset the
ledger it was supposed to be counting against, and the ladder looped at rung 1 forever.

Note the sibling call site `useCommonMediaController.js` (`markProgress`) was already
correct — it sits downstream of `evaluatePlayheadProgress`, so it only fires on real
forward motion. Only the resilience-hook call site was broken.

**Fix (`f96a60a23`):** gate `recordSuccess` on strictly-forward motion. The effect now
evaluates the observed position against a per-session `lastSuccessPosRef` baseline via
`evaluatePlayheadProgress`; the ledger is cleared only when the clock actually advanced.
A bare progress event at a frozen position is no longer treated as recovery.

---

## Defect 2 — End-of-file treated as a stall → unbounded jolt loop

**Incident timeline (`plex:674553`, 2026-07-10):**
- Asset duration `677.4s`.
- Stall began at `659.5s` — mid-stream, ~18s of content remaining.
- The dash element reached end-of-file **without firing `ended`** (Plex zero-byte
  transcode tail; dash.js never calls `endOfStream()`), parking at `duration` with
  `ended === false`.
- The jolt ladder captured `joltIntentRef = currentTime` (== `duration`) and re-seeked to
  EOF. It "resumed" at EOF and re-stalled — five times, first jolt `13:22:16Z`.

Because Defect 1 was also live, the session cap that should have bounded this loop was
being wiped on every jolt, so the loop was *unbounded* rather than merely capped-at-5.

**Root cause:** `useMediaResilience`'s `isStuck` predicate had no end-of-content guard.
`useCommonMediaController` has disengaged stall detection near the end since the
2026-05-23 audit (`currentTime >= duration - 0.5`), but the jolt ladder never learned the
same exemption, so it chased a playhead parked at `duration`.

**Fixes:**
- `00be158e5` — extract a shared `isNearEnd(currentTime, duration)` predicate to
  `lib/nearEnd.js` (the `>= duration - 0.5` threshold was previously copied in
  `endOfContentWatchdog.js` and `atDurationStuck.js`; this became the third consumer).
- `1d4e3a86e` — `isStuck` gains an `atEnd` guard so the jolt ladder never fires at
  end-of-content. The ladder deliberately does **not** own this state; advancing the queue
  at EOF is the watchdog's job (see Defect 2b).

### Defect 2b — the queue-advance watchdog didn't cover the dash path

Suppressing the EOF jolt alone would have traded an infinite jolt loop for a dead screen —
nothing would advance the queue at EOF. Two more fixes close that:
- `5dfbef266` — `endOfContentWatchdog` now fires on a **frozen** element (parked at
  duration, clock not moving for the idle window), not only a `paused` one. The
  2026-07-10 incident sat at duration with `paused === false`, so the paused-only
  condition never triggered.
- `ffd7281af` — the watchdog is now wired into the dash `VideoPlayer` path. It was
  previously mounted **only in `ContentScroller`**.

---

## Defect 3 — Nudge/jolt escalation inverted

**Evidence:** nine hours of production logged **zero** `recovery-nudge` events.

**Root cause:** both ladders arm off roughly the same soft-stall boundary, but
`STALL_JOLT_GRACE_MS` was `4500` while the controller's `HARD_STALL_MS` (the nudge
deadline) was `8000`. The expensive jolt (which mints a fresh Plex transcode session)
always preempted the cheap controller nudge, so the nudge rung was dead code.

**Fix (`b4aa2e6fd`):** raise `STALL_JOLT_GRACE_MS` to `9500` (> `HARD_STALL_MS`, now
exported from `useCommonMediaController.js`) so the nudge gets its turn first. An
invariant test in `stallJolt.test.js` pins `STALL_JOLT_GRACE_MS > HARD_STALL_MS` so the
ordering cannot silently invert again. (The consolidation audit's Phase-1 behavior-change
register flagged this exact inversion as a **SOAK WATCH** item — see §Defect-3 note in
the 2026-07-09 audit; the soak confirmed it.)

---

## The lesson worth keeping: a fix that isn't generalized regresses

The stuck-at-duration failure in Defect 2 is not new. The **2026-05-23 living-room audit**
diagnosed the identical mechanism (seek-to-duration → zero-byte tail fragment → `ended`
never fires → player parks at duration) and shipped a fix: the end-of-content watchdog
(`endOfContentWatchdog.js` + `useEndOfContentWatchdog.js`). But that fix was wired **only
into `ContentScroller`** (2026-05-23 audit, resolution note "D — wired into
`ContentScroller.jsx`"). The dash `VideoPlayer` path — the renderer that actually hit the
2026-07-10 incident — got only telemetry (`atDurationStuck`), no advancing recovery. The
2026-07-09 sedimentary audit had already flagged this exact gap (§2.1: "the main
VideoPlayer path still has no advancing recovery for stuck-at-duration").

So the same class of bug was fixed once, correctly, in one renderer, and then re-surfaced
in the sibling renderer six weeks later because the fix was never generalized. This is the
module's recurring meta-pattern (2026-07-09 audit §1.5): **layers each individually
correct but not composed; a fix scoped to the site that happened to fail, never lifted to
cover the shape.** The 2026-07-10 remediation deliberately breaks the cycle: `isNearEnd`
is one shared predicate with three consumers, and the watchdog is mounted in *both*
`ContentScroller` and `VideoPlayer`. Future editors: when you fix an EOF or forward-motion
bug in one player path, fix the predicate, not the site.

---

## Verification

Live-verified 2026-07-10: a real dash video mounted and played with zero Player-origin JS
errors; the EOF path suppressed the jolt and advanced the queue without throwing. The full
stall → nudge → exhaustion ladder was covered by unit tests (which provably fail against
the pre-fix code) plus code review, not driven live.

**What success looks like in the next soak window:** `recovery-nudge` > 0 (the cheap rung
is alive); jolt `attempt` values that climb rather than pinning at 1; and
`end-of-content-advance` appearing at the end of an asset instead of a jolt.
