# Cycle Lock Overlay When Parent Governance Is Unlocked — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the cycle-challenge lock panel whenever the cycle is in `cycleState === 'locked'`, including when parent governance is in `'unlocked'`. Today the overlay vanishes entirely in that state, so a rider who slows below the RPM threshold gets zero visual feedback while the video keeps playing.

**Architecture:** Single-file change to `useGovernanceDisplay.js`. The early-return at status `'unlocked'` short-circuits before the cycle-challenge data is forwarded to the overlay, even though `GovernanceStateOverlay` already has the rendering branch (`computeCycleLockPanelData` → cycle lock panel). The fix is to detect the cycle-locked-while-parent-unlocked case and pass through `show: true` with the cycle challenge, so the existing render branch can do its job.

**Tech Stack:** React 18, vitest, plain ES modules. No new dependencies.

---

## Context

**The bug:**
- `useGovernanceDisplay.js:28` returns `{ show: false }` whenever parent governance is `'unlocked'`.
- `FitnessPlayerOverlay.jsx:190-202` hides `CycleChallengeOverlay` whenever `cycleState === 'locked'`, intentionally delegating to `GovernanceStateOverlay`'s cycle-lock branch.
- Result: when cycle locks while parent governance is unlocked, both overlays bail. The rider sees nothing.

**Why this only manifests for cycle:** zone-based HR challenges live inside parent governance state itself — a zone challenge couldn't be "active" while parent gov says `unlocked` because failing a zone requirement is what flips parent gov to `warning`. Cycle is different: it runs as a side-state machine that can lock on its own (rider RPM dropped below `loRpm`) independently of HR-based base requirements.

**Confirmation from prod logs** (session `20260511194128`, Wave Race 64): cycle was in `cycleState: 'locked'` for ~7.5 minutes total over two episodes; parent governance was `unlocked` for ~6 of those minutes. No overlay rendered during those windows.

**Why fix `useGovernanceDisplay` and not `FitnessPlayerOverlay`:** the cycle-lock render path already exists end-to-end inside `GovernanceStateOverlay` (lines 615-687) and is fed by `display.challenge`. The only thing blocking it is the early-return upstream. Fixing it there means the dispatch logic stays in one place.

---

## File Structure

- **Modify:** `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` — replace the `status === 'unlocked'` early-return with a branch that still returns `{ show: true, challenge, ... }` when the cycle is locked.
- **Modify:** `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs` — add three new tests covering (a) the new pass-through behavior when cycle is locked, (b) the unchanged behavior when cycle exists but isn't locked, (c) the unchanged behavior when there's no challenge at all.

No new files. No changes to `GovernanceStateOverlay`, `FitnessPlayerOverlay`, `cycleLockPanelData`, or `GovernanceEngine` — they already handle the case correctly once the data reaches them.

---

## Task 1: Add failing tests for cycle-locked-while-parent-unlocked

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`

- [ ] **Step 1: Open the test file and locate the existing `'returns show:false for unlocked'` test (around line 55).** Add three new tests immediately after it, before the `'resolves pending rows from requirements + display map'` block.

- [ ] **Step 2: Add the three failing tests.**

Insert this block after the existing `'returns show:false for unlocked'` test (i.e. immediately after its closing `});`):

```javascript
  test('cycle locked while parent unlocked: returns show:true and forwards challenge', () => {
    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'unlocked',
        requirements: [],
        challenge: {
          id: 'default_0_7_1234',
          type: 'cycle',
          cycleState: 'locked',
          lockReason: 'maintain',
          rider: { id: 'user_2', name: 'User_2' },
          currentRpm: 42,
          currentPhase: { hiRpm: 69, loRpm: 52 },
          status: 'pending'
        },
        videoLocked: false
      },
      new Map(),
      ZONE_META
    );

    expect(result.show).toBe(true);
    expect(result.status).toBe('unlocked');
    expect(result.challenge).toBeTruthy();
    expect(result.challenge.cycleState).toBe('locked');
    expect(result.challenge.rider.id).toBe('user_2');
    expect(result.rows).toEqual([]);
    expect(result.requirements).toEqual([]);
    expect(result.videoLocked).toBe(false);
  });

  test('cycle in non-locked state while parent unlocked: returns show:false (CycleChallengeOverlay owns it)', () => {
    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'unlocked',
        requirements: [],
        challenge: {
          id: 'default_0_7_1234',
          type: 'cycle',
          cycleState: 'maintain',
          rider: { id: 'user_2', name: 'User_2' },
          status: 'pending'
        }
      },
      new Map(),
      ZONE_META
    );

    expect(result.show).toBe(false);
    expect(result.status).toBe('unlocked');
  });

  test('parent unlocked with no challenge at all: returns show:false (existing behavior)', () => {
    const result = resolveGovernanceDisplay(
      { isGoverned: true, status: 'unlocked', requirements: [] },
      new Map(),
      ZONE_META
    );

    expect(result.show).toBe(false);
    expect(result.status).toBe('unlocked');
  });
```

- [ ] **Step 3: Run the new tests and confirm they fail.**

Run:
```bash
cd /opt/Code/DaylightStation && timeout 60 npx vitest run tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --reporter=default
```

Expected: the first new test (`cycle locked while parent unlocked: returns show:true and forwards challenge`) **FAILS** with something like `expected false to be true` on the `result.show` assertion. The other two new tests should already **PASS** (they assert existing behavior we intend to preserve).

If the third test `parent unlocked with no challenge at all` fails, you broke the existing behavior — stop and re-read Task 2 before editing source.

- [ ] **Step 4: Do not commit yet.** Failing tests stay uncommitted until the implementation lands.

---

## Task 2: Implement the fix in useGovernanceDisplay.js

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:28-30`

- [ ] **Step 1: Open `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`.** Find the existing early-return block at lines 28-30:

```javascript
  if (status === 'unlocked') {
    return { show: false, status, rows: [] };
  }
```

- [ ] **Step 2: Replace those three lines with the cycle-aware branch:**

```javascript
  if (status === 'unlocked') {
    // Cycle challenges can enter `cycleState: 'locked'` independently of
    // parent governance — the rider dropped below loRpm even though HR-based
    // base requirements are still satisfied. CycleChallengeOverlay hides
    // itself in this case (see FitnessPlayerOverlay.jsx) on the expectation
    // that GovernanceStateOverlay will take over with its cycle lock panel
    // (computeCycleLockPanelData). For that hand-off to actually happen we
    // have to forward the challenge through `show: true` instead of bailing.
    if (challenge && challenge.type === 'cycle' && challenge.cycleState === 'locked') {
      return {
        show: true,
        status,
        rows: [],
        requirements: [],
        deadline: null,
        gracePeriodTotal: null,
        videoLocked: false,
        challenge,
        activeUserCount: Number.isFinite(activeUserCount) ? Math.max(0, Math.round(activeUserCount)) : null
      };
    }
    return { show: false, status, rows: [] };
  }
```

The fields returned mirror the shape `GovernanceStateOverlay` consumes for the cycle-lock branch:
- `show: true` — opens the GovernanceStateOverlay gate at `FitnessPlayerOverlay.jsx:204`.
- `status: 'unlocked'` preserved — the cycle-lock branch inside `GovernanceStateOverlay` (`:615-687`) does not key off status, only off `cycleLockData` (which keys off `challenge.cycleState === 'locked'`). Status remains accurate so the warning-overlay branch above it correctly skips.
- `rows: []`, `requirements: []` — there are no HR-based lock rows in this state by definition (parent gov is satisfied).
- `videoLocked: false` — accurate; the video is *not* locked by parent governance during a cycle-only lock.
- `challenge` forwarded as-is — the cycle-lock panel reads `rider`, `cycleState`, `lockReason`, `currentRpm`, `currentPhase` from it.

- [ ] **Step 3: Run the affected test file:**

```bash
cd /opt/Code/DaylightStation && timeout 60 npx vitest run tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --reporter=default
```

Expected: all tests in this file pass (existing 16 + new 3 = 19 total).

If the first new test still fails: re-check that you placed the `challenge.cycleState === 'locked'` branch *inside* the `if (status === 'unlocked')` block. If it's outside, you'd be checking it after fields like `requirements` have been destructured and would also need to defend against `unlocked` falling through to row computation.

- [ ] **Step 4: Run the full isolated fitness suite to catch any indirect regressions:**

```bash
cd /opt/Code/DaylightStation && timeout 120 npx vitest run tests/isolated/domain/fitness/ --reporter=default
```

Expected: all tests pass. The relevant adjacent files are `active-participant-state.unit.test.mjs` (covers the roster fix from earlier today) and `governance-canonical-state.unit.test.mjs`. None of them depend on the unlocked early-return path being absolute.

- [ ] **Step 5: Syntax-check the modified source file:**

```bash
cd /opt/Code/DaylightStation && node --check frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js && echo OK
```

Expected: `OK`.

---

## Task 3: Commit

**Files:** all three (source + test) staged together.

- [ ] **Step 1: Stage the two changed files:**

```bash
cd /opt/Code/DaylightStation && git add \
  frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js \
  tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
```

- [ ] **Step 2: Confirm the diff is small and contained:**

```bash
cd /opt/Code/DaylightStation && git diff --cached --stat
```

Expected: two files, on the order of ~20 lines added in the source file and ~60 lines added in the test file.

- [ ] **Step 3: Commit:**

```bash
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
fix(fitness): show cycle lock panel when parent governance is unlocked

The cycle challenge can enter `cycleState: 'locked'` whenever the rider
drops below loRpm, independently of HR-based base requirements. In
session 20260511194128.yml (Wave Race 64), the rider was locked for
~7.5 minutes total across two episodes while parent governance was
'unlocked' the whole time — and saw zero feedback.

Two overlays cooperate to render the cycle UI:
- CycleChallengeOverlay handles init/ramp/maintain (hides on locked)
- GovernanceStateOverlay handles locked via computeCycleLockPanelData

The hand-off was broken by useGovernanceDisplay.js:28 returning
`show: false` whenever parent gov was 'unlocked', which closed the
GovernanceStateOverlay gate in FitnessPlayerOverlay.jsx:204 before
the cycle-lock branch inside it could be reached.

Fix: when parent is unlocked AND challenge.type === 'cycle' AND
challenge.cycleState === 'locked', still return show:true with the
challenge forwarded so the existing cycle-lock render path engages.
Everything else stays as-is.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify the commit landed:**

```bash
cd /opt/Code/DaylightStation && git log -1 --oneline
```

Expected: a new commit with the subject line `fix(fitness): show cycle lock panel when parent governance is unlocked`.

---

## What this plan does NOT do

Out of scope, left as separate follow-ups (none required to ship this fix):

- **`lockDurationMs: null` in the `governance.cycle.recovered` event** — logging bug at `GovernanceEngine.js:2762, 2781`. No `active.lockedAtMs` is stored. Not user-visible.
- **Cycle audio cue during the cycle-only lock window** — `audioTrackKey` in `GovernanceStateOverlay.jsx:578-590` returns null when `videoLocked: false` and `normalizedStatus === 'unlocked'`. Adding audio here is a UX decision, not a regression.
- **Whether the cycle should restart when parent governance comes back through `pending` after a `locked` escalation** — observed once at the very end of session 1 (cycle stayed paused, then session ended). Investigate separately.

## Manual verification (after merge)

If you want to confirm in a live session without waiting for the next governed cycling content:

1. Open a governed cycling show (e.g. `/fitness/play/674283`).
2. Pedal up through phase 0 maintain to clear into phase 1.
3. Once in phase 1 maintain, deliberately slow below `loRpm` for 3+ seconds.
4. Expect: cycle lock panel appears with "Reach NN RPM to resume", *even though the HR overlay row is not present and the video continues to play*.
5. Pedal back up to `hiRpm`; expect the panel to disappear and ride to resume.
