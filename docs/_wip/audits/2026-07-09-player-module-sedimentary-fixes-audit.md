# Player Module Sedimentary-Fixes Audit

**Date:** 2026-07-09
**Scope:** `frontend/src/lib/Player/`, `frontend/src/modules/Player/` (with focus on `hooks/useMediaResilience.js` and the resilience cluster), `docs/reference/player/`, all player-related docs in `docs/_wip/bugs/` and `docs/_wip/audits/`, and git history 2026-01 → present (336 commits).
**Method:** Four parallel research passes (lib/Player inventory + consumer greps; resilience-cluster code deep-dive; docs/incident timeline; git churn/era analysis), followed by direct verification of the dead-code claims via import greps.
**Review:** An independent adversarial pass verified ~40 claims against HEAD source and git (dead-code list confirmed 10/10; git narrative confirmed to the line count). Its corrections are folded in below — most notably §3.3 (the controller's auto-escalation pipeline is effectively one-shot) and §3.4 (the stall bridge is starved during stalls), which sharpen rather than weaken the thesis.

---

## Executive summary

The suspicion that prompted this audit is confirmed, and it is worse in structure than in volume. The Player is not full of dead files — it is full of **live, overlapping mechanisms that each solved one incident and were never reconciled with each other**.

The five headline facts:

1. **Recovery actuation is fragmented across uncoordinated actors sharing no ledger.** Two stall-recovery state machines are armed concurrently against the same media element for every dash video — `useCommonMediaController`'s strategy pipeline and `useMediaResilience`'s deadlines + jolt ladder — on different clocks (8s vs 4.5s) with **four disjoint attempt/cooldown ledgers**, plus direct-fire actuators (dashErrorRecovery, Fitness `forceReload`) that bypass all of them. Concrete double-fire windows exist today (§3.1). The twist (§3.3): the controller's declared pipeline barely fires — it gets one nudge per stall episode and its reload/terminal rungs are unreachable in auto mode — which is precisely *why* the jolt ladder was built on top of it.

2. **The "gutted" hook has regrown 2.5×.** `useMediaResilience.js` was built to 2,283 lines by Dec 2025, cut to 277 in the Jan-09 gutting (`3fe3184a9`, "backend bug fix made the advanced logic unnecessary"), and has since regrown to 707 lines plus new satellites (`stallJolt.js`, `recoverySeek.js`, `decideWarmupRecovery.js`) that recreate the deleted policy/recovery layer under new names. The header comment "Gutted after backend bug fix to provide only basic stall recovery" (`useMediaResilience.js:76-78`) is a fossil.

3. **`useCommonMediaController.js` is the single-file risk:** 673 → 1,816 lines over 8 months, 50 commits, ~14 responsibilities, no consolidation pass ever. It absorbed every mechanism deleted elsewhere.

4. **~1,000+ lines are dead or unreachable** and can be deleted with near-zero risk: the entire Shaka-era buffer-resilience subsystem, the no-op startup-signal plumbing threaded through four layers, the unreachable quality/ABR engine and `stallConfig` strategy machinery, ghost props, and a mostly-vestigial reducer (§4). The one-shot-pipeline finding (§3.3) adds the controller's reload/seekback/terminal escalation machinery and its production-callerless `recoveryApi` to the same column.

5. **State has no single owner.** ~13 concurrent answers to "is it playing/stalled?", ~14 trackers for "where should the playhead be?", four different epsilon constants for "moved forward". Nearly every historical fix added another tracker instead of consolidating one (§5).

The path forward (§8) is deliberately **not** another gut-and-rebuild — the January gutting is the single most expensive mistake in this module's history, and the incident record shows every surviving detection mechanism was earned by a real production failure. The recommendation is: delete the provably dead code, then unify the *decision/actuation* layer behind one ledger and one escalation ladder while keeping all the detection eyes open.

---

## 1. How we got here (git + incident history)

### 1.1 Eras

| Era | Period | What happened |
|---|---|---|
| 0. Resilience v1 buildup | Nov–Dec 2025 | `MediaResilliancy` branch merged (`806a99cf3`); hook grows to 2,283 lines + 4 satellite hooks (policy/transport/presentation split, `635fdfc81`). The merge-review log (`README.media-resilience.md`) flags remount storms, implicit contracts, and missing remount guardrails — all later became filed incidents. |
| 1. The Gutting | Jan 9, 2026 | `3fe3184a9` deletes `useResiliencePolicy`, `useResiliencePresentation`, `useOverlayPresentation`, `useResilienceRecovery` (net **−3,106 lines**) on the theory a backend fix made them unnecessary. |
| 2. Re-bridging | Jan 12–31 | Within 3 days: dash-video web component swap (`0555884db`, memory-leak fix that left recovery code pointed at the wrong element — root of most Feb–Mar failures); stall state re-bridged from controller into resilience (`365e37d85`); recovery strategies re-added one at a time. |
| 3. Taxonomy + recovery-remount fixes | Feb | Renderer reorg; Feb-27 Firefox DASH death-loop postmortem (5 interacting bugs); six recovery fixes in one day. |
| 4. DASH seek/resume saga | Mar | Client-seek vs server-offset flip-flopped ≥3 times (three commits on 03-05 alone); resume-position loss fixed twice (03-07, 03-10); transcode-warmup mechanism born (`5c83bdaa5`); phantom-queue-entry cluster. |
| 5. refreshUrl / stale-session | Apr | Six-commit chain building URL-refresh recovery, including a fix (`59a7ccd29` cache-bust) that broke URL fragments and needed its own fix (`53f555d6c`) same-day. |
| 6. Stall-watchdog blitz | May 22–23 | **23 commits in 48 hours**: stallVerdict, dashErrorRecovery, end-of-content watchdog, stale-closure fixes, three overlay-visibility fixes, and a fully TDD'd stall-exhausted banner (7 commits). |
| 7. Jolt ladder + queue rebuild | Jun | Queue engine **rebuilt from spec** (`723e810ea` — "the ported one encoded its own bugs in its tests"); content-filter subsystem lands; June-30 seek-stall thread ships the jolt ladder and **deletes the entire May stall-exhausted overlay** (`3e74baaf8`), 5 weeks after it shipped. |

### 1.2 Size trajectories

| Date | `useMediaResilience.js` | `useCommonMediaController.js` |
|---|---|---|
| 2025-11-01 | — | 673 |
| 2025-12-15 | **2,283** (peak) | 850 |
| 2026-01-20 | **277** (post-gut) | 1,330 (absorbed the gutted responsibilities) |
| 2026-03-31 | 513 | 1,648 |
| 2026-05-31 | 552 | 1,800 |
| HEAD | **707** | **1,816** |

### 1.3 Churn ranking (commits since 2026-01-01)

`Player.jsx` 56 · `useCommonMediaController.js` 50 · `SinglePlayer.jsx` 36 · `useQueueController.js` 33 · `useMediaResilience.js` 33 · `VideoPlayer.jsx` 22 (+16 at its pre-Feb location) · `api.js` 16 · `ContentScroller.jsx` 14 · `PlayerOverlayLoading.jsx` 11.

### 1.4 Whack-a-mole signatures

- **Stall-detection ownership moved three times** (controller → resilience → gutted → controller-with-bridge), and the false-positive class was fixed twice in the same week (`2450f829d` 05-20, `450d30072` 05-23).
- **DASH resume seek:** five approaches in six weeks; still being patched 06-30 (`f4b093828`, transcode re-mint at seek target).
- **refreshUrl / stream re-mint:** three generations (Apr 20 chain → May 23 dash-error extension → Jun 30 "fast" variant).
- **Spinner visibility:** ~15 commits deciding when a spinner shows, Jan → Jun.
- **Built-then-deleted architectures:** composite-player system (31-day lifespan, 01-31 → 03-03); stall-exhausted overlay (05-22 → 06-30); resilience policy layer (Nov → Jan).
- **Fix-the-fix pairs:** `bf4e80765`→`5b0dacd0b` (decoder_reset leak), `59a7ccd29`→`53f555d6c` (cache-bust broke fragments), `145f57e49`→`f0300b394` (watchdog stale closure), `a1b60bb98`→03-10 (start-key clear missed the remount path), `c62839c1b`→`f7f86efe7` (AV1 advertisement backfired within days of the 05-22 incident; removed 06-02 by a follow-on fix, not a git revert).

### 1.5 The meta-pattern

Named in `docs/reference/player/lessons-and-gotchas.md` §1 and visible in four separate postmortems (02-27, 05-22, 05-23 living-room, 06-30): **layers that are each individually correct but don't compose.** A mechanism is deleted or simplified on the belief the root cause is fixed elsewhere; each subsequent incident re-adds a narrower version of the deleted logic under a new name; nobody revisits whether the original consolidated design was right. The January gutting is the type specimen: everything deleted on 01-09 has been rebuilt piecemeal across ~60 commits, minus the coordination the original design had.

---

## 2. Current-state mechanism map

### 2.1 Detection mechanisms (9 live, 1 dead, +helpers)

| # | Mechanism | Location | Detects | Fires |
|---|---|---|---|---|
| A | Startup deadline | `useMediaResilience.js:296-303` | no progress in startup/recovering (15s) | `triggerRecovery('startup-deadline-exceeded')` → refreshUrl |
| B | Transcode-warming deadline | `useMediaResilience.js:315-370` + `VideoPlayer.jsx:536-561` (6× 0-byte fragments → DOM CustomEvent) + `decideWarmupRecovery.js` | cold-start warmup (60s) vs seek-past-head (5s) | `triggerRecovery` → refreshUrl |
| C | Soft/hard stall pipeline | `useCommonMediaController.js:836-997` + `stallVerdict.js` | progress stale 1.2s (flag) / 8s (recover) | declared ladder nudge → reload → softReinit, but **effectively one nudge per stall episode in auto mode** (§3.3) |
| D | Jolt ladder (`isStuck`) | `useMediaResilience.js:509-582` + `stallJolt.js` | mid-playback, clock frozen, stalled/buffering/stuck-seek (grace 4.5s, step 6s) | onReload refreshUrl → refreshUrl+forceRemount → exhausted |
| E | Stale-session watchdog | `VideoPlayer.jsx:132-159` + `staleSessionWatchdog.js` | 3× dash code-28 in 10s | `requestRecovery('stale-session-detected')` |
| F | Dash error recovery | `VideoPlayer.jsx:597-628` + `dashErrorRecovery.js` | every dash 27/28 (cap 3/mount) | **direct** `hardReset({refreshUrl:true})` — bypasses the resilience tracker |
| G | End-of-content watchdog | `useEndOfContentWatchdog.js` — **mounted only in ContentScroller** | paused-at-duration, `ended` never fired | queue advance |
| H | At-duration-stuck | `useCommonMediaController.js:883-891` + `atDurationStuck.js` | same failure as G, from the controller | **telemetry only** |
| I | Buffer resilience | `useBufferResilience.js` + `BufferResilienceManager.js` | Shaka-era 404/0-byte | **DEAD — zero importers** (verified) |
| J | Media-load timeout | `useMediaErrorReporter.js:55-75` | no canplay in N ms | host `onError` only |
| K | Position-drift watchdog | `useCommonMediaController.js:724-749` | post-recovery drift >30s | corrective seek |
| L | No-source timeout | `Player.jsx:196-207` | no playable source in 30s | `clear()` |
| M | Playback-health signals | `usePlaybackHealth.js` | is-the-clock-moving (3 independent polls/listeners) | feeds D + overlay |
| N | Autoplay-block probe | `VideoPlayer.jsx:644-657` | paused 3s after mount + NotAllowedError | gesture overlay |

Notable composition gap carried over from the 05-23 living-room incident: the **main VideoPlayer path still has no advancing recovery for stuck-at-duration** — G (which advances) is wired only into ContentScroller; VideoPlayer gets telemetry-only H.

### 2.2 Recovery paths (13) and their four disjoint ledgers

Recovery actuators: in-place `hardReset` (three separate implementations: `VideoPlayer.jsx:315-381`, `useMediaReporter.js:306-324`, controller `reload`), controller nudge/seekback/reload/softReinit, `scheduleSinglePlayerRemount` (exponential backoff, `Player.jsx:279-285`), jolt rungs, `retryFromExhausted`, dashErrorRecovery direct resets, manual overlay reset, manual controller API, exhaustion auto-advance/clear, end-of-content advance, and a vestigial `forceDocumentReload` branch no caller can reach (`Player.jsx:663-666`).

| Ledger | Scope | Gates | Blind to |
|---|---|---|---|
| `_recoveryTracker` module Map (`useMediaResilience.js:43-64`) | per session key, survives remounts | `triggerRecovery` cooldown (4s×3ⁿ) + maxAttempts(5); jolt rungs share the attempt cap but **skip the cooldown** (`fireRung` never reads `lastAt`) | dashErrorRecovery, controller pipeline, manual API |
| `stallStateRef.recoveryAttempt` (`useCommonMediaController.js:116-139`) | per mount | controller pipeline | everything in resilience |
| `dashErrorRefreshAttemptsRef` (`VideoPlayer.jsx:130`) | per mount | direct dash-error resets | everything else |
| Remount backoff (`Player.jsx:279-285`) | per nonce | remount scheduling | in-place resets |

---

## 3. Findings — P0 (correctness / active harm)

### 3.1 Uncoordinated recovery actuators on one element

For a single mid-playback dash stall, both C and D arm on different clocks:

- t+1.2s — controller flags `isStalled` internally. (It does NOT reliably flow up at this point — see §3.4; `isStuck` in practice arms via `usePlaybackHealth`'s element-direct `waiting`/`buffering` signals.)
- t+4.5s — jolt rung 0 fires `hardReset({refreshUrl:true, seek→intent})`.
- t+8s — controller's hard timer fires `nudge` (seeks `currentTime − 0.001`) against whatever state the jolt's refreshUrl reset left mid-warmup. (In auto mode the controller escalates no further — §3.3.)
- t+10.5s — jolt rung 1 forces a React remount while the controller's `loadedmetadata`/`seeked` handlers (with their own 5s timeouts, `useCommonMediaController.js:540-547, 586-593`) may still be pending on the orphaned element.

The two layers also encode opposite seek-restore *policies* (`recoverySeek.js` nudges forward past poisoned segments after repeated same-position failures; controller `reload`/`seekback` seek back 2–5s) — though the back-seek rungs are nearly unreachable in auto mode (§3.3), so the live conflict is policy-level, not a per-stall tug-of-war. The only shared "stop" signal between the machines is the clock starting to advance.

A second concrete window: every dash code-28 error feeds **both** `staleSessionWatchdog.recordError` and `decideDashErrorRecovery` (`VideoPlayer.jsx:605-627`). Errors 1–2 each trigger a direct hardReset; error 3 fires both the third direct reset AND the watchdog escalation to `triggerRecovery` — and because the direct resets were never recorded in `_recoveryTracker`, the cooldown is open: **up to four resets in quick succession**, each potentially minting a fresh Plex transcode session (server-side cost).

The clearest concrete harm: after a resilience hardReset, the controller's sticky-resume logic (`useCommonMediaController.js:1199-1219`) can interpret the reset's `loadedmetadata` as unexpected and re-seek to `__lastPosByKey − 1`, directly fighting the resilience layer's `seekToIntentMs`. And when the jolt ladder puts status into `recovering`, the 15s startup deadline re-arms (`useMediaResilience.js:296-303`) and can fire a refreshUrl recovery on top of an in-flight reinit.

No incident doc shows a literal logged double-fire causing user-visible harm; what is proven is that the windows are real and ungated, refreshUrl recoveries take multi-second transcode warmups (exactly long enough for the second machine to fire), and the 02-27 / 05-23 postmortems establish that this composition class is what bites in production.

### 3.2 The "one ledger" premise of `_recoveryTracker` is already false

The tracker was added (02-18, `49f2008a2`) specifically to bound recovery attempts globally. Today: jolt rungs consume the attempt cap but bypass the cooldown — and asymmetrically, `_recordRecovery` *writes* `lastAt` (`useMediaResilience.js:52`), so jolt activity refreshes the cooldown and starves `triggerRecovery`-path recoveries. dashErrorRecovery and the controller pipeline bypass the tracker entirely. The remount backoff is separate again. And a **fifth bypass has live production callers**: `controllerRef.forceReload` routes straight to `onReload` with no cooldown, no attempt record, no status transition — called from `FitnessPlayerFooterControls.jsx:108-109` and `useSeekState.js:134-135`.

The historical result of this shape is on record — the 02-18 cap converted an infinite loop into a terminal stuck state (02-27 postmortem), which then needed a retry surface, which then needed forceRemount because in-place retry didn't work (`9544248ee`). Every patch is a symptom of ledger fragmentation.

### 3.3 The controller's auto-escalation pipeline is a fiction (one nudge per stall)

`scheduleStallDetection` early-returns while `stallStateRef.isStalled` is true (`useCommonMediaController.js:847-850`). The hard timer is armed exactly once, inside the soft timer's stalled verdict (:948), and after `attemptRecovery()` the re-arm call at :983 no-ops through the same gate — as do all other re-arm sites (:901, :921, :994, :1049, :1365, :1434, :1439, :1461). `recoveryAttempt` resets to 0 on any resolve (:1036). Net effect: **in auto mode the controller fires at most one `nudge` per stall episode; `reload`, `seekback`, terminal failure, and `terminalAction` are unreachable** (the only escalation shortcut is the duration-lost → softReinit branch at :965-976). The escalation test suite passes only by driving the ladder manually (`stallEscalation.test.jsx:71-72` calls `attemptNext()` directly), and the exported `recovery.trigger/attemptNext/softReinit` API has zero production call sites.

This reframes the module's history: the jolt ladder (06-30) exists because mid-playback stalls hung forever — which they did *because the controller ladder was never actually climbing*. It also moves the controller's reload/seekback/terminal machinery and `recoveryApi` into the effectively-dead column of §4, and it means any consolidation (§8 Phase 2) is less a merge of two working ladders than the completion of a takeover the jolt ladder already started.

### 3.4 The stall bridge is starved by the stalls it reports

`stalled: isStalled` reaches Player only inside the controller's `onTimeUpdate` payload (`useCommonMediaController.js:1082-1100`). During a hard stall, `timeupdate` stops firing — so `externalStalled` arrives late (typically delivered by the nudge's own seek-induced timeupdate at ~t+8s) or never. The resilience layer's `isStuck` predicate works today mainly because `usePlaybackHealth` listens to the element's `waiting`/`stalled` events directly. The prop bridge that §5 catalogs as one of ~13 stall-state projections is, during the exact state it exists to report, dead air. (`useMediaReporter`'s 100ms poll would not starve, but it is mounted only in the ContentScroller path.) This connects directly to open item 9 (§7): `timeupdate` starvation has been flagged twice as a stall amplifier and never investigated.

---

## 4. Findings — P1 (dead code, unreachable machinery, ghost plumbing)

All verified by grep on 2026-07-09.

1. **`useBufferResilience.js` (266) + `BufferResilienceManager.js` (~190) are fully dead.** Zero importers anywhere in `frontend/src` (the only mention is a comment in `seekTrace.js`). Shaka-era (all events `shaka-*`), carries mid-refactor scaffolding comments ("Phase 2/3 transition"), contains a while-true 404 retry loop. **Delete.** Note: this duplicates the *live* 0-byte detector in `VideoPlayer.jsx:536-561` at a different threshold (4 vs 6) — the dead copy is a trap for anyone greping "0-byte".
2. **`onStartupSignal` is a no-op threaded through four layers.** `useMediaResilience` returns a frozen NOOP (`:37, :698`); Player → SinglePlayer → resilienceBridge → `useMediaReporter` constructs and emits `media-el-attached`/`loadedmetadata`/`playing`/`progress-tick` payloads (`useMediaReporter.js:181-197, 265-269, 456-468`), every one discarded. ImageFrame and TitleCardRenderer also call it (`ImageFrame.jsx:530-531`, `TitleCardRenderer.jsx:36-43`). Corpse of the pre-gutting signal-driven startup detector. **Remove the plumbing end to end.**
3. **Ghost props into `useMediaResilience`:** `Player.jsx:760-793` passes `maxVideoBitrate`, `playbackDiagnostics`, `fetchVideoInfo`, `nudgePlayback`, `diagnosticsProvider`, `externalPauseActive` — none exist in the hook's signature. Conversely the hook accepts but never reads `externalStallState`, `externalPauseReason`, `explicitStartProvided` (signature-only grep hits).
4. **Quality sampling + ABR engine (~150 lines) unreachable:** `showQuality` gates the sampling effect (`useCommonMediaController.js:1560-1615`), the bitrate-adaptation engine (:1617-1696), and the manual-reset key handler (:1698-1711); no caller anywhere passes it. Likewise **no producer passes `stallConfig`** (VideoPlayer accepts/forwards the prop; nobody sets it), so the strategy-override machinery (:203-260), the declared 4-step `DEFAULT_STRATEGY_PIPELINE` (:29-34), the `seekback` strategy, `terminalAction:'autoClear'`, and `mode:'manual'` are all unreachable; the live pipeline is always the hardcoded `['nudge','reload']` (:180). This was already flagged as a discrepancy in the 04-19 nudge-loop bug doc.
5. **`nudgePlayback`/`getTroubleDiagnostics` never registered** by any renderer (`Player.jsx:420-421` accepts them; VideoPlayer registers only `{getMediaEl, hardReset, fetchVideoInfo, autoplayBlocked, onAutoplayResolved}`), so `transportAdapter.nudge` guards a no-op and `readDiagnostics` always takes the fallback branch.
6. **`useResilienceState` reducer ~60% vestigial:** only `setStatus`/`reset` are dispatched; `progressTick`/`stallDetected`/`recoveryTriggered` actions and `lastStallToken`/`recoveryGuardToken`/`recoveryAttempts`/`carryRecovery` fields (`useResilienceState.js:49-80`) have zero call sites; `stalling`/`idle` statuses never entered.
7. **Dead config keys with conflicting defaults:** `useResilienceConfig` computes `stallDetectionThresholdMs` (5000) and `hardRecoverAfterStalledForMs` (2000) that nothing consumes — real stall thresholds are the controller's hardcoded softMs=1200/hardMs=8000. `maxAttempts` has two defaults (5 in config, 3 as coerce fallback, `useResilienceConfig.js:90`). The `overlay.*`/`debug.*` config blocks are returned but unused.
8. **`lib/Player/mediaTransportAdapter.js` upstream-controller path is dead** — both call sites of `useMediaKeyboardHandler` omit `controller`, so all `upstream.*` branches (lines 101-160) are unreachable; only the raw-element fallback runs. Its name also collides with the unrelated `modules/Player/hooks/transport/useMediaTransportAdapter.js` (resilience-facing, different shape) — a naming trap for anyone extending transport.
9. **`forceDocumentReload`/`forceFullReload` branch** (`Player.jsx:663-666`): no live producer.
10. **Dead export:** `subscribePlayerKeyboard` (`playerKeyboardOwnership.js:55`) consumed only by tests.
11. **Controller escalation machinery is effectively dead in auto mode** (per §3.3): the `reload`/`seekback` strategies past rung 0, terminal-failure handling, `terminalAction`, and the exported `recovery.trigger/attemptNext/softReinit` API (zero production call sites; exercised only by `stallEscalation.test.jsx` driving it manually). Not blindly deletable — §3.3 argues the *detection* half and the actuators themselves should survive into the unified ladder — but the auto-orchestration around them is not doing what its shape claims.

Deleting items 1, 2, 4, 6, 7, 9 alone removes on the order of 1,000 lines while changing zero runtime behavior (item 4 requires rewriting the escalation tests — see Phase 0 notes).

---

## 5. Findings — P1 (SSoT and state duplication)

**"Is it playing/advancing/stalled?" — ~13 concurrent answers:** `usePlaybackHealth` alone maintains three (400ms advancing poll :218-247, progress token :193-205, frame poll :365-420) plus element-signal flags; the controller keeps `stallStateRef`, an `isStalled` React state, and a published `stallState` snapshot; Player re-projects into `playbackMetrics`; resilience keeps `status`, `userIntent`, `hasEverPlayedRef`; pause intent is classified in two places (`useMediaReporter.classifyPauseIntent` :394-428 and the pause arbiter).

**Four epsilon constants for "moved forward":** `playheadProgress.js:4` (0.05), `stallVerdict.js:29` (0.05), `usePlaybackHealth.js:222` (0.05), and config `progressEpsilonSeconds` 0.25 halved/clamped to 0.01–0.05 (`usePlaybackHealth.js:112-115`).

**Playhead/seek-intent — ~10 position-bearing trackers** (plus adjacent timestamps/display refs that a reader must still disambiguate): `targetTimeSeconds` (module session store), controller `lastSeekIntentRef` + `lastPlaybackPosRef` (:90) + function statics `__appliedStartByKey`/`__lastPosByKey`/`__lastSeekByKey` (:72-74), `recoverySnapshotRef`, resilience `joltIntentRef`/`recoverySeekTrackerRef`, `pendingSeekSecondsRef` (`useMediaReporter.js:167`), plus the `seekToIntentMs` prop chain, and the display/timing satellites (`stickyIntentDisplayRef`, `lastSeekAtRef`, `seekStartedAtRef`, `_recoveryTracker` counts). On an unexpected `loadedmetadata` the controller resolves resume position by racing four of these (`useCommonMediaController.js:1199-1216`) — a priority list that exists precisely because there is no owner. The March resume-loss saga (03-07, 03-10) was caused by exactly this fragmentation and was fixed by adding more trackers.

**Unbounded module-level containers on a kiosk-lifetime tab:** `usePlaybackSession`'s `sessionStore` Map (`usePlaybackSession.js:4`) never pruned; controller function statics keyed by assetId never pruned (only softReinit deletes one key); `_recoveryTracker`'s final session entry survives unmount; `useQueueController`'s `_signatureCache` (`useQueueController.js:11`, explicitly modeled on `_recoveryTracker` per its own comment) pruned only on one error path (:332). The 02-08 audit flagged the bounded-LRU need; it remains advice, not a fix.

---

## 6. Findings — P1/P2 (separation of concerns, hygiene, docs)

### 6.1 Mixed concerns

- **`useMediaResilience` mixes three roles:** recovery engine (:39-370, 509-582), overlay view-model (~70-line `overlayProps` memo :607-676 — formatTime strings, `showPauseOverlay` toggle, `showDebug`, sticky intent display), and seek-UX timing (bump-seek grace :455-490, loop-flash suppression :584-595).
- **`useCommonMediaController` carries ~14 responsibilities** (element access, rate ×2 paths, volume ×2 paths, backend progress logging, keyboard, progress-bar seek, stall detection, 4 recovery strategies, terminal failure, drift watchdog, resume policy incl. DASH `offset=`, loop policy, quality/ABR, telemetry, clip segments, transport export). Its element-setup effect spans :1054-1531 with a 21-item dep array.
- **`useMediaKeyboardHandler` fires network calls from a key handler** (`play/log`, `harvest/watchlist` at :152-153) and rebuilds its transport adapter every render (:37, unmemoized). It is also marked `@deprecated` (:13) while being the sole keyboard path for VideoPlayer/AudioPlayer/ContentScroller.

### 6.2 React-correctness hazards

- Render-phase DOM reads and ref writes in `useMediaResilience` (`mediaElSnapshot` IIFE :402-413, `isLoopTransition` :586-595, sticky-intent capture :436-453, `joltLatestRef` :515-518) — each annotated as a deliberate flash fix, but collectively they make the hook non-idempotent under StrictMode/concurrent double-render.
- Side-effect-in-`useMemo` for the controllerRef assignment (:679-688).
- Controller media-events effect deps include `meta` (object identity) and `isStalled` — full listener detach/reattach on any meta rebuild or stall flip (`useCommonMediaController.js:1531`), re-arming timers each time.
- `overlayProps` memo depends on the whole `playbackHealth` object — new identity every progress tick, so the 30-key memo recomputes continuously (:668).
- Jolt effect suppresses exhaustive-deps and reads via a render-snapshot ref (:581) — workable, fragile.
- **Accumulating anonymous listeners:** every `loadedmetadata` — including each in-place `hardReset` (`target.load()` on the same element) — adds `play`/`seeked` listeners that are never removed (`useCommonMediaController.js:1328-1333`; effect teardown removes only the named handlers). Functionally idempotent (they re-assign `playbackRate`) but unbounded on a kiosk tab with repeated recoveries; same pattern for the `applySeek` listeners at :1284-1285 when a seek never resolves.
- Render-phase DOM read in the controller's own return value (`isPaused: !seconds ? false : getMediaEl()?.paused`, :1801); duplicate `segStart` in `handleProgressClick` deps (:427).
- The transcode-warming signal travels VideoPlayer → DOM CustomEvent → resilience climbing the tree with `closest('dash-video')` (:320-322) — a DOM back-channel between two React layers that already share a props bridge; `closest` cannot escape shadow DOM, which was exactly the 06-30 bug.

### 6.3 `lib/Player/` placement drift

Apparent intent of the split: `lib/Player/` = Player-adjacent code importable outside the module tree (CLI, Menu, ArtMode, Piano). That intent is real for exactly four files: `contentFilter.js` + `filterDebug.js` (imported by `cli/player-review.cli.mjs:42-43`), `playlist.js` (Piano), `playerKeyboardOwnership.js` (Menu). **9 of the other 10 are consumed only by `modules/Player`** (`reviewParams`, `skipCardState`, `useContentFilter`, `useFilterData`, `useCenterByWidest`, `useDynamicDimensions`, `useMediaKeyboardHandler`, `mediaTransportAdapter`, plus `filterEffects` — consumed only via `useContentFilter` and mirrored by `FilterDebugHud`'s hand-synced icon map), and `useBackgroundMusic` is ArtMode-only. No README documents the split. No file is fully dead; the filter stack (pure core → registry → DOM hook → components) is the healthiest architecture in the audit scope.

Hygiene nits in lib/Player: stale comment at `filterEffects.js:80-82` describing skip-card expansion that the resolver explicitly does NOT do (`contentFilter.js:144-150` — actively misleading); raw `console.debug` at `useCenterByWidest.js:32` (logging-rule violation, though gated behind a `debug` option); `useFilterData.js:19` uses raw `fetch()` where siblings use `DaylightAPI`; stale JSDoc at `useBackgroundMusic.js:20` (documents 3 of 5 returned fields); `filterDebug.activeCueAt` re-implements `contentFilter.cuesActiveAt` semantics; `FilterDebugHud`'s `EFFECT_ICON` map must be hand-synced with the effect registry; `/filter-poc` POC route still mounted in `main.jsx:21,167`.

### 6.4 Docs vs reality

- `frontend/src/modules/Player/README.md` is frozen at the Oct-2025 refactor: references `Player.jsx.backup` and `CompositePlayer.jsx` (both deleted), lists renderers under `components/`, says nothing about resilience at all.
- `hooks/README.md` claims `useCommonMediaController` invokes `useMediaResilience`; in reality they never call each other — they communicate only via the `onProgress → handleProgress → playbackMetrics` re-projection through SinglePlayer (`SinglePlayer.jsx:152-189`).
- `README.media-resilience.md` is a Nov-2025 branch-review log; its stale-session section is still accurate, but it describes overlay mechanics that no longer exist and documents none of the mechanisms added since (jolt ladder, warmup classifier, dashErrorRecovery, controller pipeline).
- `docs/reference/player/` (README, lessons-and-gotchas, playback-encoding-resilience) is accurate and current — it was mined from the incident docs and is the only trustworthy architecture description. The in-tree READMEs should defer to it or be rewritten from it.
- The "Gutted after backend bug fix" header comment (`useMediaResilience.js:76-78`) should be deleted as part of any touch.

---

## 7. Open items inherited from prior docs (never closed)

1. Last queue track loops instead of stopping (`bugs/2026-03-31…` — status Open).
2. Music-player "Loading…" upstream root cause — three chases (02-03, 05-01, 05-23); instrumentation landed, cause still unknown; queue-endpoint discrepancy and signature-dedupe race explicitly deferred.
3. Phantom `player-idle` Player overlay leak (05-22 §3, 05-23 — 28% of log volume); fix `9de00c9b5` unconfirmed for the `effectiveMeta=null` variant.
4. `player-no-source-timeout` with `queueLength:0, hasPlay:true` internal inconsistency (05-23, out of scope then).
5. End-of-duration seek trigger identity (05-23 living-room "only residual uncertainty"); seek-trace was added to answer it, no follow-up recorded. Related: VideoPlayer path still telemetry-only for stuck-at-duration (§2.1).
6. AV1-on-underpowered-client has no adaptive path (05-22 R7 capability probe never built; resolution was reverting the codec advertisement).
7. Shield audio autoplay fix deployed but never verified on device (03-08).
8. `stream:` source hardening (06-19): producer audit, loud decoder failure, proxy/manifest logging — proposed, no landing recorded.
9. Render-thrash as a stall amplifier (`timeupdate` starvation) — flagged 03-13, re-flagged 05-22/05-23, never separately investigated.
10. Feb-08 latent items without recorded fixes: unbounded `__lastPosByKey`/`__lastSeekByKey` growth (still true, §5), FragmentController log spam, `moment` in `formatTime`, watchedDuration localStorage growth.

---

## 8. Recommended path forward

Guiding principle: **the January gutting must not be repeated.** Every detection mechanism in §2.1 maps to a real production incident (the mechanism→incident table in the docs history confirms each one earned its keep). The problem is not that there are too many eyes — it is that there are five hands on the steering wheel. Consolidate decision and actuation; keep detection.

### Phase 0 — Delete the provably dead (~1 session) — **DONE 2026-07-09**

> Landed on `refactor/player-resilience-consolidation` as commits `e2667d206`, `8c8bf456d`, `a9c0d1764`, `3e0a31e1c`, `015f19944`, `39a6c0094`, `83da8d031` — 27 files, +345/−1,432 (net −1,087). Also picked up: FitnessPlayer's ghost `pauseDecision` prop, AudioPlayer's ghost hook params, `fpsStatsPayload` dead quality fields, orphaned quality-HUD CSS. Escalation tests rewritten against the real one-nudge auto surface (mutation-verified).

- Remove `useBufferResilience.js` + `BufferResilienceManager.js`.
- Remove the `onStartupSignal` plumbing end to end (hook return, Player, SinglePlayer, resilienceBridge, useMediaReporter emit sites, ImageFrame/TitleCardRenderer calls, **PlayableAppShell.jsx:17,30 and usePlayableLifecycle.js:31,40**).
- Remove ghost props both directions on `useMediaResilience` (§4.3).
- Remove the unreachable quality/ABR + `stallConfig` machinery from `useCommonMediaController` **or** wire `stallConfig` from config if the override capability is wanted — decide, don't keep the limbo. (Recommend removal; the declared 4-step pipeline vs actual 2-step has already misled one investigation, 04-19.) Blast radius to include: the quality HUD at `VideoPlayer.jsx:801` + PropTypes, and **`stallEscalation.test.jsx` must be rewritten against the surviving surface** — it drives the ladder via `recoveryStrategies`/`mode:'manual'`/`attemptNext()`, all of which go away.
- Prune `useResilienceState` to `setStatus`/`reset`; delete dead config keys and unify the `maxAttempts` default.
- Delete the `forceDocumentReload` branch, the `nudgePlayback`/`getTroubleDiagnostics` acceptance, the "Gutted" comment, `subscribePlayerKeyboard`.
- Fix the `filterEffects.js:80` stale comment and the `console.debug` violation.
- Guard: existing resilience/controller suites pass unchanged EXCEPT the escalation tests, which are rewritten (not deleted) to cover the surviving behavior.

### Phase 1 — One recovery ledger + retire the controller's auto-recovery (small, high leverage) — **DONE 2026-07-09**

> Landed on `refactor/player-resilience-consolidation` as commits `659204e53`, `003c9d0b2`, `163982344`, `1f4e07c57`, `644f04014`, `8b8e84146`, `610c1a48d`, plus the Task 13 verification/docs commit. Scope grew to include the **controller demotion** (detection + nudge/duration-lost softReinit only), pulled forward from Phase 2 per the adversarial review's sequencing advice. Live-verified against a real Plex DASH stream with CDP network-loss injection (stall → jolt rung 1 → softReinit → jolt rung 2 → clean resume, no recovery storm, ledger reset on progress). The live verify also caught a Phase-0 regression the unit suites could not: `3e0a31e1c` deleted the `isAdapting`/`adaptMessage` state but left `setIsAdapting`/`setAdaptMessage` calls in VideoPlayer's dash `ready` handler, so every dash ready event threw and skipped the `playback.video-ready` telemetry — fixed in the Task 13 commit.
>
> **Behavior-change register (Milestone B):**
> (a) jolt rungs now respect the shared cooldown (a denied rung reschedules at `waitMs`);
> (b) cooldown ladder re-anchored — first retry waits 4s not 12s; exhaustion floor drops from ~480s to ~160s;
> (c) dash-error resets count toward the session cap (closes the quad-reset window); the mediaUrl-change budget re-grant was removed (near-unreachable);
> (d) user forceReload records ledger attempts — reload-hammering reaches the exhausted overlay (which still offers retry) instead of looping raw reloads;
> (e) controller nudge is ledger-gated — when the jolt ladder fires first, the nudge is often cooldown-denied (escalation-order inversion: the heavy refresh-url at ~6s preempts the cheap nudge at ~8.3s — **SOAK WATCH**: if stalls that a bare nudge used to fix now take a jolt, tune `HARD_STALL_MS` below the jolt grace or give the nudge `bypassCooldown`);
> (f) duration-lost softReinit is ledger-gated (`bypassCooldown`, cap-bounded at 5 — a plan deviation, justified: it bounds a reinit loop that was previously unbounded).
>
> **Soak resolution (2026-07-10) — item (e) SOAK WATCH RESOLVED.** A ~9h production
> soak confirmed the escalation-order inversion was real and worse than "often
> cooldown-denied": the jolt grace (4500ms) fired *before* `HARD_STALL_MS` (8000ms), so
> the nudge never fired at all — 0 `recovery-nudge` events in 9h. The soak also surfaced
> two further defects on the same root (phantom-progress defeating the ledger cap; the
> EOF jolt loop). Fixed on `fix/player-resilience-soak-defects`: `STALL_JOLT_GRACE_MS`
> raised to 9500 > `HARD_STALL_MS` with an invariant test (`b4aa2e6fd`) — the chosen
> lever was "tune the grace above the nudge deadline", NOT `bypassCooldown` (the nudge
> was never reaching cooldown). Full writeup:
> `docs/_wip/bugs/2026-07-10-player-resilience-soak-findings.md`.

Create a single `RecoveryLedger` that ALL actuators must pass through: `triggerRecovery`, jolt rungs, dashErrorRecovery, stale-session watchdog, remount scheduling, and `controllerRef.forceReload` (live Fitness callers: `FitnessPlayerFooterControls.jsx:108-109`, `useSeekState.js:134-135`). **Scope-aware, not flat:** the current ledgers encode deliberate semantics — dashErrorRecovery's budget is per-mount so a remount earns a fresh budget; the remount backoff is per-nonce. The ledger needs a session-scoped total cap with mount-scoped sub-budgets, or it will recreate the Feb-27 terminal-stuck failure at a different layer. One exhaustion event; pruned on session end.

In the same phase, **demote the controller to detection-only** by deleting its auto-recovery orchestration. Per §3.3 this is nearly a no-op at runtime (it only ever fires one nudge; a nudge rung in the unified ladder replaces it), and it removes one of the two "state machines" for the price of a deletion rather than a redesign. This kills the §3 double-fire windows without touching any detection logic.

### Phase 2 — One escalation ladder (the real consolidation)

Collapse the resilience deadlines + jolt ladder + the surviving actuators into a single ordered ladder. Ownership recommendation, refined by the adversarial review: the ladder itself should be a **pure module** (as `stallJolt.js` already is — decision tables in plain functions, unit-testable), invoked from exactly one orchestration point, with the ledger arbitrating. Do NOT relocate decision authority into `useMediaResilience`'s render path — it has the worst React hygiene in this audit (§6.2), and every actuation from the hook crosses the render-unstable `resilienceBridge` (see the ref workaround at `VideoPlayer.jsx:113-120`).

- **Controller = senses + hands.** It owns the element: stall verdicts, progress signals, dash errors, warmup events flow OUT as typed events; `nudge`/`reload`/`softReinit`/`hardReset` remain exposed as actuators.
- **Ladder = pure module.** Roughly: nudge → in-place reload → refreshUrl hardReset → forceRemount → exhausted, with the warmup classifier and end-of-content handling as reason-specific entry points. Seek-intent restore must stay reason-aware: forward-nudge for poisoned segments (per `recoverySeek.js`), back-seek where buffered-range re-entry is the goal.
- Fix the starved bridge (§3.4): stall state must reach the orchestrator via a channel that doesn't depend on `timeupdate` (element-direct events or a poll), not the current onTimeUpdate payload.
- Replace the DOM CustomEvent back-channel for `transcodewarming` with the existing props bridge.
- Wire the end-of-content watchdog into the main VideoPlayer path (closes the §2.1 gap and inherited item 5).

### Phase 3 — Seek-intent and playback-state SSoT

- One `SeekIntent` store per session key (owner of: target, source, appliedAt, consumedAt). Migrate the ~14 trackers onto it incrementally, starting with the ones the resume-race reads (`useCommonMediaController.js:1199-1216`).
- One epsilon constant exported from one module.
- Bound or prune all module-level Maps (kiosk tabs live for weeks).
- Extract the overlay view-model out of `useMediaResilience` into a `usePlayerOverlayModel` hook that consumes resilience state + playbackHealth; move the render-phase DOM reads behind `useSyncExternalStore` or accept them as documented exceptions in ONE place.

### Phase 4 — Structural hygiene (opportunistic)

- Split `useCommonMediaController` along its natural seams: transport (element/rate/volume/seek), telemetry (progress logging, playback events), policy (resume/loop/clip). Do it by extraction, not rewrite.
- Move the 8 module-only files from `lib/Player/` into `modules/Player/`; leave the 4 shared files and write a 5-line README stating the rule ("in lib/Player only if imported from outside modules/Player").
- Resolve the transport-adapter name collision: strip `lib/Player/mediaTransportAdapter.js` to its live element-fallback core or delete it into `useMediaKeyboardHandler`.
- Un-deprecate or actually migrate `useMediaKeyboardHandler`; move its network side effects out of the key handler.
- Rewrite `modules/Player/README.md` + `hooks/README.md` from `docs/reference/player/README.md`; retire `README.media-resilience.md` to `docs/_archive/` (it is a historical review log, not documentation).

### Sequencing and risk notes

- Phases 0–1 are low-risk and independently shippable; do them first and soak.
- Phase 2 is the only risky one. Do it behind the existing test harness plus one new integration test per historical incident class (startup deadline, warmup cold/seek, mid-playback stall, code-28 storm, stuck-at-duration, resume-position) — the incident docs give exact reproduction conditions for each.
- Do NOT delete detection mechanisms during phase 2 even where they overlap; overlap in detection is cheap, overlap in actuation is what bites.
- Each phase should update `docs/reference/player/README.md` in the same change (per repo docs policy).

---

## Appendix A — Mechanism → originating incident

| Mechanism | Born from |
|---|---|
| Remount hammer + resilience state machine + overlays | Nov-2025 MediaResilliancy branch |
| `_recoveryTracker` cap / exhausted + retry | Feb-18 infinite remount loop → Feb-27 terminal-state postmortem |
| Fresh-`/play`-on-recovery (skip direct-play bypass) | 02-28 stale-session bug |
| Per-mount start-time flag; clear-intent-on-`seeked` | 03-07 + 03-10 resume-loss pair |
| Transcode-warmup detection (0-byte 200s) + backoff + preserve-intent-on-retry | 03-11 deep-seek "Tap to Retry" trap |
| Phantom-entry suppression + single-owner autoplay + overlay-log suppression | 03-17 / 03-22 / 03-24 chain |
| Progress-epsilon gating of markProgress | 04-19 nudge false-resolve loop |
| `stallVerdict` direct currentTime read (kills 91% false stalls) | 05-23 watchdog noise |
| `staleSessionWatchdog` + `dashErrorRecovery` (27/28 → refreshUrl) | 05-23 fitness stall |
| End-of-content watchdog + paused-at-duration overlay suppression + seekTrace | 05-23 living-room stuck-seeking |
| `isAdvancing` overlay authority | 05-22 sticky-stalled blank-screen regression |
| Caps gated on `allowDirectStream`; ceilings-never-amplifiers; h264/hevc-only | 05-18 → 05-22 → 06-16 encoding arc |
| `decideWarmupRecovery` + jolt ladder | 06-30 seek-past-transcoder-head |
| queue engine v2 | 06-10 rebuild from spec |

## Appendix B — Fixes later superseded, reverted, or layered over

1. AV1/VP9 advertisement (`c62839c1b`, 05-18 audit's primary fix) → backfired at the 05-22 incident (client couldn't decode) → removed 06-02 by `f7f86efe7` (a fix commit, not a git revert).
2. Force re-encode for irregular GOP (`9f7cea71f`) → reverted (`e54e13a55`); accepted trade-off is copy + gap recovery.
3. `_recoveryTracker` cap → created the terminal state → retry surface → forceRemount retry.
4. `__appliedStartByKey` softReinit clear (`a1b60bb98`) → missed the remount path (03-10) → per-mount Symbol.
5. 03-17 phantom fixes → different vector 03-24; phantom overlay resurfaced twice more (05-22, 05-23).
6. Recovery-exit tightening (`bc72ed611`, `2450f829d`) → sticky `stalled` → 05-22 overlay regressions → `isAdvancing` gate.
7. Nudge strategy: buffered-range guard (03-07) → shown insufficient (04-19) → bypassed by epsilon gating → effectively superseded by jolt ladder (06-30) yet still the first (and in auto mode, only reachable — §3.3) rung of the controller pipeline today.
8. Near-end stall exemption → do-nothing gap (05-23) → end-of-content watchdog (ContentScroller only).
9. Queue source-routing interim patch (02-11) → branch collapse (`e1ca7f567`) → contributed to 02-27 re-dispatch cascade → rebuilt from spec (06-10).
10. Stall-exhausted overlay: 7 TDD commits (05-22) → Retry didn't work (`9544248ee`) → deleted entirely (`3e74baaf8`, 06-30).

## Appendix C — Where each live mechanism lives (quick reference)

Detection: `useMediaResilience.js` (A startup deadline :296, B warmup :315, D jolt :509), `useCommonMediaController.js` (C pipeline :836, H at-duration :883, K drift :724), `VideoPlayer.jsx` (0-byte emitter :536, E stale-session :132, F dash-error :597, N autoplay :644), `usePlaybackHealth.js` (M), `useMediaErrorReporter.js` (J), `Player.jsx` (L no-source :196), `useEndOfContentWatchdog.js` (G, ContentScroller only).
Ledgers: `useMediaResilience.js:43` (module Map), `useCommonMediaController.js:116` (stallStateRef), `VideoPlayer.jsx:130` (dash attempts), `Player.jsx:279` (remount backoff).
