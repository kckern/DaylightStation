# Player Resilience Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute Phases 0–1 of the 2026-07-09 Player audit — delete ~1,000 lines of dead/unreachable machinery, then unify all recovery actuators behind a single scope-aware ledger and retire the controller's vestigial auto-recovery — leaving Phases 2–4 to a follow-up plan after soak.

**Architecture:** The Player currently has two stall-recovery state machines plus three ledger-bypassing direct actuators, coordinated by four disjoint attempt/cooldown ledgers. This plan (a) removes code proven dead by grep (Milestone A), then (b) introduces `recoveryLedger.js` — a pure module with a session-scoped attempt cap, backoff cooldown, and per-mount sub-budgets — and routes every actuator through it, demoting `useCommonMediaController` to detection + minimal actuators (Milestone B). Detection mechanisms are NOT deleted: each one maps to a real production incident. The consolidation of decision-making into one pure-module ladder is Phase 2, deliberately deferred (Milestone C).

**Tech Stack:** React 18 hooks, dash.js via `dash-video-element`, vitest (run from repo root: `npx vitest run <path>` — root `vitest.config.mjs` handles frontend colocated tests), structured logging via `playbackLog`/`getLogger`.

**Spec:** `docs/_wip/audits/2026-07-09-player-module-sedimentary-fixes-audit.md` (read it first — section references below like "§3.3" point there). Line numbers in this plan were verified 2026-07-09 at commit `14a03a565`; **always grep for the anchor text before editing** in case of drift.

**Commit policy:** All work on a feature branch in a worktree (per-task commits are fine there). No merge to main without the user.

---

## Task 0: Worktree + branch setup

**Step 1:** Create a worktree (REQUIRED SUB-SKILL: superpowers:using-git-worktrees) on branch `refactor/player-resilience-consolidation` from `main`.

**Step 2:** Verify the baseline test state so pre-existing failures aren't attributed to this work:

```bash
npx vitest run frontend/src/modules/Player frontend/src/lib/Player --reporter=basic 2>&1 | tail -20
```

Record the pass/fail counts in the task notes. Expected: all pass (if any fail, note them as pre-existing and do NOT try to fix them here).

**Step 3:** Commit nothing yet; proceed.

---

# Milestone A — Phase 0: Delete the provably dead

Every task in this milestone follows the same discipline: **grep to confirm the code is still dead → delete → run the focused tests → commit.** If a "confirm dead" grep returns unexpected live consumers, STOP and re-check against the audit rather than deleting.

## Task 1: Delete the Shaka-era buffer-resilience subsystem

**Files:**
- Delete: `frontend/src/modules/Player/hooks/useBufferResilience.js`
- Delete: `frontend/src/modules/Player/lib/BufferResilienceManager.js`
- Modify: `frontend/src/modules/Player/lib/seekTrace.js` (stale comment, ~line 8)

**Step 1: Confirm still dead**

```bash
grep -rn "useBufferResilience\|BufferResilienceManager" frontend/src --include="*.js*" | grep -v "hooks/useBufferResilience.js" | grep -v "lib/BufferResilienceManager.js"
```

Expected: exactly one hit — the comment in `seekTrace.js`. Anything else = STOP.

**Step 2: Delete both files**

```bash
git rm frontend/src/modules/Player/hooks/useBufferResilience.js frontend/src/modules/Player/lib/BufferResilienceManager.js
```

(If `git rm` is permission-blocked, `mv` to `_deleteme/` per repo rules and `git add -A`.)

**Step 3: Fix the seekTrace comment**

In `seekTrace.js`, the header comment lists "BufferResilienceManager" among known seek-emitting paths. Remove that name from the list (keep the rest of the comment).

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Player --reporter=basic 2>&1 | tail -5
```

Expected: same pass count as baseline (the deleted files had no tests importing them — `seekTrace.test.js` tests behavior, not the comment).

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(player): delete dead Shaka-era buffer-resilience subsystem

useBufferResilience + BufferResilienceManager had zero importers (audit
2026-07-09 §4.1); the live 0-byte detector is in VideoPlayer.jsx."
```

## Task 2: Remove the no-op `onStartupSignal` plumbing end to end

**Files (all Modify):**
- `frontend/src/modules/Player/hooks/useMediaResilience.js` (NOOP const ~:37, return ~:698)
- `frontend/src/modules/Player/Player.jsx` (destructure ~:760, playerProps ~:1099)
- `frontend/src/modules/Player/components/SinglePlayer.jsx` (prop ~:25, resilienceBridge ~:377)
- `frontend/src/modules/Player/hooks/useMediaReporter.js` (emit sites ~:181-197, :265-269, :456-468)
- `frontend/src/modules/Player/renderers/ImageFrame.jsx` (~:530-531, PropTypes ~:658)
- `frontend/src/modules/Player/renderers/TitleCardRenderer.jsx` (~:36-43)
- `frontend/src/modules/Player/renderers/AudioPlayer.jsx` (PropTypes ~:317)
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx` (PropTypes ~:859)
- `frontend/src/modules/Player/components/PlayableAppShell.jsx` (:17, :30)
- `frontend/src/modules/Player/hooks/usePlayableLifecycle.js` (:31, :40)

**Step 1: Map every touchpoint**

```bash
grep -rn "onStartupSignal\|startupSignal" frontend/src --include="*.js*"
```

Expected: hits only in the files listed above. Extra files = add them to this task, same treatment.

**Step 2: Remove producer** — in `useMediaResilience.js`, delete the `NOOP` const (`const NOOP = () => {};` with its comment) and the `onStartupSignal: NOOP,` line in the return object.

**Step 3: Remove all consumers** — delete the prop threading, the bridge field, every `onStartupSignal?.(...)`/`typeof ... === 'function'` call block, the PropTypes entries, and in `useMediaReporter.js` the code that *builds payloads solely to pass to it*. Careful in useMediaReporter: only remove the signal-emit calls and any payload construction used exclusively by them — the same functions also do live work (progress metrics). After each file, `grep -n onStartupSignal <file>` must return nothing.

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Player --reporter=basic 2>&1 | tail -5
```

Expected: baseline pass count. `useMediaReporter` has tests (`useMediaErrorReporter.test.js` is separate; check for `useMediaReporter` coverage) — if a test asserted signal emission, delete that assertion with the feature.

**Step 5: Commit** — `git commit -m "refactor(player): remove no-op onStartupSignal plumbing (audit §4.2)"`

## Task 3: Remove ghost props in both directions on `useMediaResilience`

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx` (the `useMediaResilience({...})` call, ~:760-793)
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (signature ~:79-106)

**Step 1: Confirm** — in `useMediaResilience.js`, grep each name; expected exactly 1 hit (the signature) for: `externalStallState`, `externalPauseReason`, `explicitStartProvided`. In the hook file grep for `maxVideoBitrate|playbackDiagnostics|fetchVideoInfo|nudgePlayback|diagnosticsProvider|externalPauseActive` — expected 0 hits (they're passed but not even accepted).

**Step 2: Edit the Player.jsx call** — remove these six argument lines (and their comments): `maxVideoBitrate: ...` (4-line expression), `playbackDiagnostics: ...`, `fetchVideoInfo: mediaAccess.fetchVideoInfo`, `nudgePlayback: transportAdapter.nudge`, `diagnosticsProvider: transportAdapter.readDiagnostics`, `externalPauseActive: pauseDecision?.paused`. Also remove `explicitStartProvided,` and `externalPauseReason: pauseDecision?.reason,` and `externalStallState: effectiveMeta ? playbackMetrics.stallState : null,` (keep `externalStalled` — it IS read).

**Step 3: Edit the hook signature** — remove `explicitStartProvided = false`, `externalPauseReason = null`, `externalStallState = null` from the destructured params (and their comments).

**Step 4:** Check whether removing `maxVideoBitrate` from the call leaves `singlePlayerProps?.maxVideoBitrate`/`maxVideoBitrate` unused in Player.jsx scope — `grep -n maxVideoBitrate frontend/src/modules/Player/Player.jsx`. Only remove other occurrences if they become unused; otherwise leave them.

**Step 5: Run tests + commit**

```bash
npx vitest run frontend/src/modules/Player --reporter=basic 2>&1 | tail -5
git add -A && git commit -m "refactor(player): drop ghost props on useMediaResilience (audit §4.3)"
```

## Task 4: Remove unreachable quality/ABR + stallConfig machinery; rewrite the escalation test

This is the one Phase-0 task with real test churn — budget accordingly.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx` (props :95/:200, PropTypes :851, quality HUD ~:801)
- Rewrite: `frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx`

**Step 1: Confirm no producers**

```bash
grep -rn "showQuality\|stallConfig" frontend/src --include="*.js*" | grep -vE "useCommonMediaController|VideoPlayer.jsx"
```

Expected: no hits. (Test files don't count as producers but note them.)

**Step 2: Read the escalation test first** (`stallEscalation.test.jsx`). It drives the ladder via `stallConfig`'s `recoveryStrategies` + `mode:'manual'` + `recovery.attemptNext()`. Decide per-assertion: behavior that survives (soft/hard stall detection, `stalled` flag, duration-lost → softReinit) gets a rewritten test; behavior that is being deleted (manual strategy override, seekback, terminal `autoClear`) gets its test deleted.

**Step 3: Delete from the controller** (grep for each anchor first):
- `stallConfig` param + the normalization block (~:203-260: strategy-step normalization, `mode`, `terminalAction` resolution).
- `DEFAULT_STRATEGY_PIPELINE` (~:29-34) — replace the pipeline resolution with the literal that is live today: `const strategySteps = [{ name: 'nudge', maxAttempts: 1, options: {} }, { name: 'reload', maxAttempts: 1, options: {} }];` (Milestone B Task 12 shrinks this further — do NOT change runtime behavior in this task).
- `seekbackRecovery` and its entry in `recoveryMethods` (~:700) — unreachable rung.
- `terminalAction === 'autoClear'` branch in `handleTerminalFailure` (~:717-719) — keep the terminal log + snapshot.
- `showQuality` param, the quality-sampling effect (~:1560-1615), the ABR engine (~:1617-1696), and the manual-reset key handler (~:1698-1711).
- The exported `recovery` API object (`recoveryApi.trigger/attemptNext/softReinit/reset`, ~:1736-1741) — zero production callers (§3.3). Grep `onController` consumers first: `grep -rn "\.recovery\." frontend/src --include="*.jsx"` filtered to controller consumers; expected none outside tests.

**Step 4: Delete from VideoPlayer** — `showQuality`/`stallConfig` props, forwarding, PropTypes, and the quality HUD JSX block (~:801).

**Step 5: Rewrite the escalation test** to cover the surviving surface without `stallConfig`: (a) soft stall flags `isStalled` after `softMs` of no progress; (b) hard timer fires exactly one auto `nudge` (assert via the media element's currentTime nudge or the `playback.recovery-strategy` log); (c) duration-lost escalates to softReinit; (d) progress resume clears stalled state and resets counters. Reuse the existing test's harness/mock setup — only the driving mechanism changes.

**Step 6: Run + commit**

```bash
npx vitest run frontend/src/modules/Player/hooks --reporter=basic 2>&1 | tail -5
git add -A && git commit -m "refactor(player): remove unreachable ABR/stallConfig/seekback/recoveryApi machinery (audit §4.4, §3.3)

No producer passes showQuality or stallConfig; the auto pipeline is the
hardcoded [nudge, reload]. Escalation tests rewritten against the real
surface instead of the manual-drive API."
```

## Task 5: Prune `useResilienceState` + dead config keys

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useResilienceState.js`
- Modify: `frontend/src/modules/Player/hooks/useResilienceConfig.js`

**Step 1: Confirm** — `grep -rn "progressTick\|stallDetected\|recoveryTriggered\|carryRecovery\|lastStallToken\|recoveryGuardToken" frontend/src --include="*.js*" | grep -v useResilienceState.js` → expected: no production hits. Same for `stallDetectionThresholdMs|hardRecoverAfterStalledForMs` outside useResilienceConfig.

**Step 2: Rewrite `useResilienceState.js`** — keep `RESILIENCE_STATUS` (all statuses; `exhausted`/`paused`/etc. are used) but reduce state to `{ status }`, actions to `setStatus`/`reset`, delete `RESILIENCE_ACTIONS.PROGRESS_TICK/STALL_DETECTED/RECOVERY_TRIGGERED` and the `lastStallToken`/`recoveryGuardToken`/`recoveryAttempts`/`carryRecovery` fields. Check `useMediaResilience.js` usage: it consumes `state`, `status`, `statusRef`, `actions.setStatus`, `actions.reset` — all preserved. Note `resilienceState` flows out via `onStateChange` and `controllerRef.getState()`; grep consumers of those for the deleted fields first: `grep -rn "recoveryAttempts\|carryRecovery" frontend/src --include="*.jsx"`.

**Step 3: In `useResilienceConfig.js`** — delete `stallDetectionThresholdMs` and `hardRecoverAfterStalledForMs` (both the DEFAULT entries :11-12 and monitorSettings :80-81); change the `maxAttempts` fallback at :90 from `3` to `5` so the coerce default matches `DEFAULT_MEDIA_RESILIENCE_CONFIG.recovery.maxAttempts` (one source of truth).

**Step 4: Run + commit**

```bash
npx vitest run frontend/src/modules/Player --reporter=basic 2>&1 | tail -5
git add -A && git commit -m "refactor(player): prune vestigial resilience reducer + dead config keys (audit §4.6-4.7)"
```

## Task 6: Small deletions and hygiene batch

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx` (`forceDocumentReload` branch ~:663-666 + `reloadDocument` if now unused; `nudgePlayback`/`getTroubleDiagnostics` acceptance in `handleRegisterMediaAccess` ~:420-421; `transportAdapter.nudge`/`readDiagnostics` if now unused — check `hooks/transport/useMediaTransportAdapter.js`)
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (delete the "Simplified Media Resilience Hook / Gutted after backend bug fix" comment ~:75-78; replace with one line: `/** Media resilience: recovery orchestration + overlay state for the Player. */`)
- Modify: `frontend/src/lib/Player/playerKeyboardOwnership.js` (delete `subscribePlayerKeyboard` export ~:55; delete its test cases in `playerKeyboardOwnership.test.js`)
- Modify: `frontend/src/lib/Player/filterEffects.js` (fix stale skip-card comment :80-82 to state the resolver keeps skip-card as ONE cue — see `contentFilter.js:144-150`)
- Modify: `frontend/src/lib/Player/useCenterByWidest.js` (:32 — replace `console.debug` with the structured logger; module-level lazy pattern per CLAUDE.md Logging section)

**Steps:** For each: grep the anchor → edit → `npx vitest run frontend/src/lib/Player frontend/src/modules/Player --reporter=basic` → one commit:

```bash
git commit -m "chore(player): remove vestigial branches, stale comments, dead export; logging-rule fix (audit §4.9-4.10, §6.3)"
```

Note on `forceDocumentReload`: confirm no producer first — `grep -rn "forceDocumentReload\|forceFullReload" frontend/src --include="*.js*"` → expected hits only inside `handleResilienceReload` itself.

## Task 7: Milestone A wrap — full sweep + docs

**Step 1:** Full test sweep, compare to Task 0 baseline:

```bash
npx vitest run frontend/src frontend/src/lib/Player --reporter=basic 2>&1 | tail -10
```

**Step 2:** Line-count the win: `git diff --shortstat main...HEAD`. Expected: net deletion around −1,000 lines.

**Step 3:** Update `docs/reference/player/README.md`: remove/annotate any mention of the deleted mechanisms (buffer resilience, quality HUD, stallConfig overrides). Update the audit doc's §8 Phase 0 with a "DONE <date>" note.

**Step 4:** Commit: `git commit -m "docs(player): reflect Phase 0 deletions in reference docs"`

**CHECKPOINT: request code review** (REQUIRED SUB-SKILL: superpowers:requesting-code-review) before starting Milestone B.

---

# Milestone B — Phase 1: One recovery ledger + retire controller auto-recovery

## Task 8: TDD the `recoveryLedger` pure module

**Files:**
- Create: `frontend/src/modules/Player/lib/recoveryLedger.js`
- Create: `frontend/src/modules/Player/lib/recoveryLedger.test.js`

Design (from audit §8 Phase 1): session-scoped total cap + cooldown-with-backoff, per-mount sub-budgets keyed by actor, injectable clock, explicit pruning. This REPLACES: `_recoveryTracker` (useMediaResilience), `dashErrorRefreshAttemptsRef` (VideoPlayer), and gates the controller's nudge. Remount backoff in Player.jsx stays as-is for now (it schedules, doesn't decide).

> **2026-07-09:** the reference implementation below had a cooldown-exponent defect (used prior-attempt count; the spec'd 4s/12s/36s ladder needs count−1). The committed module is authoritative — do NOT "fix" the ledger back to this code.

**Step 1: Write the failing test**

```js
// frontend/src/modules/Player/lib/recoveryLedger.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createRecoveryLedger } from './recoveryLedger.js';

const SESSION = 'player-item:abc';

describe('recoveryLedger', () => {
  let now, ledger;
  beforeEach(() => {
    now = 1_000_000;
    ledger = createRecoveryLedger({
      maxAttempts: 5,
      cooldownMs: 4000,
      cooldownBackoffMultiplier: 3,
      mountBudgets: { 'dash-error': 3 },
      now: () => now
    });
  });

  it('allows the first request and records the attempt', () => {
    const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'startup-deadline-exceeded' });
    expect(r).toMatchObject({ allowed: true, attempt: 1, exhausted: false });
  });

  it('denies inside the cooldown window, allows after it', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'x' });
    now += 1000;
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'x' }).allowed).toBe(false);
    now += 4000; // past 4s cooldown for attempt 1
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'resilience', reason: 'x' }).allowed).toBe(true);
  });

  it('backs off exponentially: 4s, 12s, 36s', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }); // attempt 1
    now += 4001;
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }); // attempt 2
    now += 4001;
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }).allowed).toBe(false); // needs 12s now
    now += 8000;
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }).allowed).toBe(true);
  });

  it('exhausts at the session cap regardless of actor', () => {
    for (let i = 0; i < 5; i++) {
      const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: `actor-${i}`, reason: 'x', bypassCooldown: true });
      expect(r.allowed).toBe(true);
    }
    const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'late', reason: 'x', bypassCooldown: true });
    expect(r).toMatchObject({ allowed: false, exhausted: true });
  });

  it('enforces per-mount sub-budget for a configured actor without consuming the session cap prematurely', () => {
    for (let i = 0; i < 3; i++) {
      expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true }).allowed).toBe(true);
    }
    // 4th dash-error on the SAME mount: denied by sub-budget (not session exhaustion)
    const denied = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true });
    expect(denied).toMatchObject({ allowed: false, exhausted: false });
    // New mount = fresh sub-budget (session cap still applies: 3 used + this = 4 of 5)
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm2', actor: 'dash-error', reason: 'dash-28', bypassCooldown: true }).allowed).toBe(true);
  });

  it('recordSuccess clears attempts and cooldown for the session', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    ledger.recordSuccess(SESSION);
    const r = ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    expect(r).toMatchObject({ allowed: true, attempt: 1 });
  });

  it('userReset clears everything including exhaustion (retry-from-exhausted)', () => {
    for (let i = 0; i < 5; i++) ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', bypassCooldown: true });
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', bypassCooldown: true }).exhausted).toBe(true);
    ledger.userReset(SESSION);
    expect(ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' }).allowed).toBe(true);
  });

  it('releaseSession prunes state (no unbounded growth)', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x' });
    ledger.releaseSession(SESSION);
    expect(ledger.snapshot(SESSION)).toBeNull();
  });

  it('urlRefresh counting survives for telemetry', () => {
    ledger.request({ sessionKey: SESSION, mountId: 'm1', actor: 'a', reason: 'x', isUrlRefresh: true });
    expect(ledger.snapshot(SESSION).urlRefreshCount).toBe(1);
  });
});
```

**Step 2: Run to verify it fails** — `npx vitest run frontend/src/modules/Player/lib/recoveryLedger.test.js` → FAIL ("Cannot find module './recoveryLedger.js'").

**Step 3: Implement**

```js
// frontend/src/modules/Player/lib/recoveryLedger.js
// Single source of truth for playback-recovery attempt accounting.
// Replaces: useMediaResilience's module _recoveryTracker, VideoPlayer's
// dashErrorRefreshAttemptsRef, and gates useCommonMediaController's nudge.
// Scope model (audit 2026-07-09 §8 Phase 1): one session-scoped total cap +
// cooldown-with-backoff, plus per-mount sub-budgets for actors that earn a
// fresh budget on remount (a remount mints a new Plex session, so a dead-URL
// actor's cap must not leak across mounts).

const DEFAULTS = {
  maxAttempts: 5,
  cooldownMs: 4000,
  cooldownBackoffMultiplier: 3,
  mountBudgets: { 'dash-error': 3 },
  now: () => Date.now()
};

export function createRecoveryLedger(options = {}) {
  const cfg = { ...DEFAULTS, ...options, mountBudgets: { ...DEFAULTS.mountBudgets, ...(options.mountBudgets || {}) } };
  const sessions = new Map(); // sessionKey -> { count, lastAt, urlRefreshCount, exhausted, mounts: Map<mountId, Map<actor, n>> }

  const getSession = (key) => {
    let s = sessions.get(key);
    if (!s) {
      s = { count: 0, lastAt: 0, urlRefreshCount: 0, exhausted: false, mounts: new Map() };
      sessions.set(key, s);
    }
    return s;
  };

  return {
    /**
     * Ask permission to fire a recovery. Records the attempt when allowed.
     * @returns {{allowed:boolean, attempt:number, waitMs:number, exhausted:boolean, deniedBy:null|'cooldown'|'mount-budget'|'session-cap'}}
     */
    request({ sessionKey, mountId, actor, reason, bypassCooldown = false, isUrlRefresh = false }) {
      if (!sessionKey) return { allowed: true, attempt: 0, waitMs: 0, exhausted: false, deniedBy: null };
      const s = getSession(sessionKey);
      const t = cfg.now();

      if (s.count >= cfg.maxAttempts) {
        s.exhausted = true;
        return { allowed: false, attempt: s.count, waitMs: 0, exhausted: true, deniedBy: 'session-cap' };
      }

      const budget = cfg.mountBudgets[actor];
      if (Number.isFinite(budget) && mountId) {
        const mount = s.mounts.get(mountId);
        const used = mount?.get(actor) || 0;
        if (used >= budget) {
          return { allowed: false, attempt: s.count, waitMs: 0, exhausted: false, deniedBy: 'mount-budget' };
        }
      }

      const effectiveCooldown = cfg.cooldownMs * Math.pow(cfg.cooldownBackoffMultiplier, s.count);
      const elapsed = t - s.lastAt;
      if (!bypassCooldown && s.lastAt > 0 && elapsed < effectiveCooldown) {
        return { allowed: false, attempt: s.count, waitMs: effectiveCooldown - elapsed, exhausted: false, deniedBy: 'cooldown' };
      }

      s.count += 1;
      s.lastAt = t;
      if (isUrlRefresh) s.urlRefreshCount += 1;
      if (Number.isFinite(budget) && mountId) {
        let mount = s.mounts.get(mountId);
        if (!mount) { mount = new Map(); s.mounts.set(mountId, mount); }
        mount.set(actor, (mount.get(actor) || 0) + 1);
      }
      return { allowed: true, attempt: s.count, waitMs: 0, exhausted: false, deniedBy: null, reason };
    },

    /** Playback resumed — clear attempts/cooldown but keep telemetry counters until release. */
    recordSuccess(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return;
      s.count = 0;
      s.lastAt = 0;
      s.exhausted = false;
      s.mounts.clear();
    },

    /** User-initiated retry from exhausted: full reset. */
    userReset(sessionKey) {
      sessions.delete(sessionKey);
    },

    /** Session ended/changed: prune (prevents unbounded growth on kiosk tabs). */
    releaseSession(sessionKey) {
      sessions.delete(sessionKey);
    },

    snapshot(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return null;
      return { count: s.count, lastAt: s.lastAt, urlRefreshCount: s.urlRefreshCount, exhausted: s.exhausted };
    }
  };
}

// Module singleton shared by every actuator in the tab.
let _shared = null;
export function getRecoveryLedger() {
  if (!_shared) _shared = createRecoveryLedger();
  return _shared;
}

// Test-only: swap the singleton.
export function _setSharedLedgerForTests(ledger) {
  _shared = ledger;
}
```

**Step 4: Run to verify pass** — `npx vitest run frontend/src/modules/Player/lib/recoveryLedger.test.js` → all PASS.

**Step 5: Commit** — `git commit -m "feat(player): add recoveryLedger — single scope-aware recovery attempt ledger"`

## Task 9: Route `useMediaResilience` through the ledger

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js`
- Test: `frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js` (existing — must keep passing)

**Step 1:** Write/extend a failing test first: in a new `useMediaResilience.ledger.test.jsx`, assert that (a) `triggerRecovery` denied by cooldown does NOT call `onReload`; (b) jolt-rung firing consumes ledger attempts AND respects the cooldown (this is the behavior change: audit §3.2 — jolt previously skipped the cooldown while refreshing it); (c) exhaustion fires `onExhausted` once with the ledger's attempt count. Model the harness on the existing refreshUrl test.

**Step 2:** Replace the tracker: delete the `_recoveryTracker` Map + `_getTracker`/`_recordRecovery`/`_recordUrlRefresh`/`_clearTracker` (:39-64) and import `getRecoveryLedger` from `../lib/recoveryLedger.js`.

**Step 3:** Rewire each site:
- `triggerRecovery` (:186-235): replace the cooldown/cap block with one `ledger.request({ sessionKey: playbackSessionKey, mountId: waitKey, actor: 'resilience', reason, isUrlRefresh: shouldRefreshUrlForReason(reason) })`; on `deniedBy === 'session-cap'` run the existing exhausted branch; on `cooldown` return; on allowed proceed (attempt number from the result).
- Jolt `fireRung` (:545-577): replace `_recordRecovery` with `ledger.request({ ..., actor: 'jolt', reason: plan?.reason || 'stall-jolt' })`; treat `!allowed && exhausted` as the existing exhausted path; treat cooldown-denied as "skip this rung firing, reschedule" (setTimeout the next check at `waitMs`).
- `retryFromExhausted` (:237-257): `_clearTracker` → `ledger.userReset(playbackSessionKey)`.
- Progress effect (:282): `_clearTracker` → `ledger.recordSuccess(playbackSessionKey)`.
- Session-change cleanup effect (:124-129): `_clearTracker(prev)` → `ledger.releaseSession(prev)`; ALSO add an unmount cleanup that releases the current key (fixes the audit §5 leak).

**Step 4:** Run — `npx vitest run frontend/src/modules/Player/hooks --reporter=basic`. The refreshUrl test must still pass. Note: the cooldown ladder is now anchored one step earlier than old production (first retry at 4s, not 12s) — deliberate, see recoveryLedger.js header.

**Step 5: Commit** — `git commit -m "refactor(player): useMediaResilience recovery accounting via recoveryLedger (audit §3.2)"`

## Task 10: Route dash-error recovery through the ledger

**Files:**
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx` (error handler ~:597-628, `dashErrorRefreshAttemptsRef` :130)
- Modify if needed: `frontend/src/modules/Player/lib/dashErrorRecovery.js` (keep the pure decision fn; it can stay attempt-count-parameterized)

**Step 1:** In the `api.on('error', ...)` handler, replace the ref counter with a ledger request: on `decision.action === 'refresh-url'`, call `getRecoveryLedger().request({ sessionKey: <the playbackSessionKey — thread it in as a prop or via resilienceBridge>, mountId: <per-mount id: use a `useRef(Symbol())` minted at mount>, actor: 'dash-error', reason: `dash-${code}`, bypassCooldown: true, isUrlRefresh: true })`. Fire `hardReset` only when `allowed`. The mount budget (3) now lives in the ledger config — pass `attemptsThisMount` to `decideDashErrorRecovery` from the ledger snapshot or simplify the pure fn to code-classification only.

**Step 2:** The stale-session watchdog escalation (`bridge.requestRecovery`, :153-156) needs no change — it already flows into `triggerRecovery`, now ledger-gated. This closes the §3.1 quad-reset window: the direct dash-error resets are now visible to the same session cap the watchdog path consumes.

**Step 3:** Threading `playbackSessionKey` to VideoPlayer: check `SinglePlayer.jsx` → renderer props; if not present, add it to the resilienceBridge object (it already crosses that boundary) rather than a new prop chain.

**Step 4:** Test: extend `dashErrorRecovery.test.js` (pure fn unchanged = untouched) and add a focused test if the handler logic is extractable; otherwise verify via the existing VideoPlayer hardReset test (`VideoPlayer.hardReset.test.jsx`) still passing plus manual log inspection in Task 13.

**Step 5: Commit** — `git commit -m "refactor(player): dash 27/28 recovery consumes the shared recoveryLedger (audit §3.1)"`

## Task 11: Route `controllerRef.forceReload` through gated recovery

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (controller API ~:679-688)
- Verify callers: `frontend/src/modules/Fitness/player/FitnessPlayerFooterControls.jsx:108-109`, `frontend/src/modules/Fitness/player/useSeekState.js:134-135` (grep exact paths first)

**Step 1:** `grep -rn "forceReload" frontend/src --include="*.js*"` — map all callers.

**Step 2:** Change the controller API: `forceReload: (opts) => triggerRecovery(opts?.reason || 'manual-force-reload')` — routing user-facing reloads through the ledger + status machine instead of raw `onReload`. If Fitness callers pass seek/refresh options that `triggerRecovery` drops, extend `triggerRecovery` to accept an options override rather than reverting to raw `onReload`. Also: this is a user-initiated action — pass `bypassCooldown: true` via the ledger request for the manual reason (add a small reason→bypass map or an options arg).

**Step 3:** Read both Fitness call sites; confirm their expectations (do they rely on an immediate reload even during cooldown? If yes, `bypassCooldown: true` preserves UX while still counting the attempt).

**Step 4:** Fix the `useMemo`-for-side-effect while here: move the `controllerRef.current = {...}` assignment into a `useEffect` (audit §6.2).

**Step 5:** Run Fitness + Player tests: `npx vitest run frontend/src/modules/Player frontend/src/modules/Fitness --reporter=basic 2>&1 | tail -5` → commit `git commit -m "refactor(player): forceReload routes through gated recovery; controllerRef assignment moved to effect"`

## Task 12: Retire the controller's auto-recovery (detection-only + ledger-gated nudge)

Per audit §3.3 this is nearly a runtime no-op: in auto mode the controller only ever fires one nudge per stall episode. Preserve exactly that — one nudge, now ledger-visible — and delete the fiction around it.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx` (again — assertions about pipeline internals)

**Step 1:** Write the failing test: hard stall → exactly one nudge fired, ledger `request` called with `actor: 'controller-nudge'`; a second hard stall in the same session inside the cooldown → nudge suppressed (ledger denies).

**Step 2:** In the controller:
- Delete `attemptRecovery` (:752-834), `getStrategyStep`, `strategySteps`, `recoveryMethods`' `reload` entry and `reloadRecovery` (grep for other callers of `reloadRecovery` first — expected none), `handleTerminalFailure` (:702-721; keep a one-line terminal log where the hard timer exhausts), and the `s.recoveryAttempt/strategyCounts/activeStrategy/attemptIndex/terminal/pendingSoftReinit` fields from `stallStateRef` + `publishStallSnapshot` (grep downstream consumers of the published snapshot fields first: `grep -rn "stallState" frontend/src --include="*.jsx"`).
- Keep: soft/hard timers, `decideStallVerdict`, `markProgress`, `publishStallSnapshot` (with the surviving fields), `setIsStalled`, the duration-lost → `softReinitRecovery` branch (:965-976, now calling `softReinitRecovery()` directly), and `nudgeRecovery`.
- Replace the hard-timer body (:948-988): duration-lost → softReinit (unchanged); otherwise `const r = getRecoveryLedger().request({ sessionKey, mountId, actor: 'controller-nudge', reason: 'hard-stall-nudge' }); if (r.allowed) nudgeRecovery();` — and nothing else. The resilience jolt ladder (already armed by the same stall via `isStuck`) owns all further escalation.
- Thread `sessionKey`/`mountId` in: the controller already receives `assetId`; use `assetId` as sessionKey scope only if `playbackSessionKey` isn't available at this layer — check what SinglePlayer passes; prefer threading the real `playbackSessionKey` through the existing props (it originates in Player.jsx as `itemSessionKey`).

**Step 3:** Also call `getRecoveryLedger().recordSuccess(sessionKey)` from `markProgress`'s `wasStalled` branch (:1024-1050) so a controller-observed resume clears the shared ledger (same semantics `useMediaResilience`'s progress effect provides — idempotent).

**Step 4:** Run all Player tests. Expected churn: only the escalation test (rewritten in Step 1) and any test asserting deleted snapshot fields.

**Step 5: Commit**

```bash
git commit -m "refactor(player): demote controller to detection + single ledger-gated nudge (audit §3.3)

The auto pipeline never escalated past one nudge per stall episode
(scheduleStallDetection early-returns while isStalled). Codify the real
behavior, delete the unreachable ladder, and make the nudge visible to
the shared recoveryLedger. Escalation is owned by the resilience layer."
```

## Task 13: Milestone B verification + docs

**Step 1:** Full sweep: `npx vitest run frontend/src --reporter=basic 2>&1 | tail -10` — compare to baseline.

**Step 2:** REQUIRED SUB-SKILL: use the `verify` skill — drive real playback in the dev app (Task: play a dash video, force a mid-playback stall if feasible via devtools network throttling, observe `playback.stalled` → single nudge → jolt ladder logs; confirm no double-fire: each `resilience-recovery`/`playback.recovery-strategy` log line should carry a ledger attempt number, strictly increasing per session).

**Step 3:** Update docs: `docs/reference/player/README.md` (resilience-layers table: one ledger, controller = detection + nudge); mark audit §8 Phase 1 DONE with the FULL behavior-change register:

- (a) jolt rungs now respect the shared cooldown (a denied rung reschedules at `waitMs`);
- (b) cooldown ladder re-anchored — first retry waits 4s not 12s; exhaustion floor drops ~480s→~160s;
- (c) dash-error resets count toward the session cap (closes the quad-reset window); mediaUrl-change budget re-grant removed (near-unreachable);
- (d) user forceReload records ledger attempts — reload-hammering reaches the exhausted overlay (with retry) instead of looping raw reloads;
- (e) controller nudge is ledger-gated — when the jolt ladder fires first the nudge is often cooldown-denied (escalation-order inversion: heavy refresh-url at ~6s preempts the cheap nudge at ~8.3s — SOAK WATCH: if stalls a bare nudge used to fix now take a jolt, tune `HARD_STALL_MS` below the jolt grace or give the nudge `bypassCooldown`);
- (f) duration-lost softReinit is ledger-gated (`bypassCooldown`, cap-bounded at 5 — a plan deviation, justified: bounds a previously unbounded reinit loop).

> **DONE 2026-07-09.** Sweeps green (Player 43 files / 308 tests; Fitness 1041 with the 4 known pre-existing collection failures). Live verify: real Plex DASH stream, CDP offline injection — observed `dash.error-recovery` (attempt 1) → `playback.stalled` → jolt rung 1 (`stall-jolt-refresh-url`) → duration-lost softReinit → jolt rung 2 (`stall-jolt-remount`) → clean resume post-restore with no further attempts (recordSuccess) and no `resilience-recovery` storm. The live verify also exposed a Phase-0 regression invisible to the unit suites: orphaned `setIsAdapting`/`setAdaptMessage` calls in VideoPlayer's dash `ready` handler (left by `3e0a31e1c`) threw on every ready event and suppressed `playback.video-ready` telemetry — removed in the Task 13 commit and re-verified live (`playback.video-ready` now emits).

**Step 4:** Commit docs. **CHECKPOINT: request code review** before Milestone C.

---

# Milestone C — Soak + follow-up plan (Phases 2–4 are NOT in this plan)

## Task 14: Soak checkpoint and Phase 2 re-plan

**Step 1:** Merge decision belongs to the user (REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch). Recommend: merge to main, deploy, soak ≥1 week of real household playback (fitness sessions, living-room movies, office programs) watching `resilience-*` / `playback.*` logs for: ledger-denied storms, exhaustion regressions, stalls that no longer recover.

**Step 2:** After soak, write the Phase 2–4 plan as a NEW plan doc (`docs/_wip/plans/YYYY-MM-DD-player-ladder-unification-plan.md`) covering, per audit §8: the unified pure-module escalation ladder (nudge → in-place reload → refreshUrl → remount → exhausted) invoked from one orchestration point; the starved-bridge fix (§3.4 — stall state via element-direct events, not onTimeUpdate payloads); `transcodewarming` over the props bridge instead of a DOM CustomEvent; end-of-content watchdog wired into the VideoPlayer path; then seek-intent SSoT, epsilon unification, bounded Maps, overlay view-model extraction, controller split, lib/Player file moves, README rewrites. Each Phase-2 change ships behind one integration test per historical incident class (reproduction conditions are in the incident docs listed in the audit's Appendix A).

---

## Standing rules for the executor

- **Grep before every edit** — cited line numbers were correct at `14a03a565` and will drift as tasks land.
- **A failing grep precondition means STOP**, not improvise: re-read the audit section, update the plan, then proceed.
- **Never delete a detection mechanism.** This plan deletes decision/actuation duplication and dead code only.
- **Structured logging only** (CLAUDE.md Logging section) — new code paths (ledger denials, nudge gating) must emit `playbackLog`/logger events at the same detail level as what they replace.
- **Tests: skipping is not passing** (CLAUDE.md Test Discipline). If a rewritten test can't reproduce a scenario, it fails loudly; no vacuous passes.
- Commit after every task; do not push or merge to main without the user.
