# Guests & Exempt: Credit Without Consequence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests and `exempt` users never cause a negative governance consequence (warning/lock/failure) in either the steady-state requirement or a challenge, while still earning coins and counting toward challenge achievement when they qualify.

**Architecture:** Teach `GovernanceEngine` which active participants are guests (a `guestIds` set plumbed through `evaluate()`), then split "subjects" (registered, non-exempt, non-guest — the only ids that can be required or blamed) from "eligible" (everyone — counts toward challenge achievement). Steady-state stays subjects-only for satisfaction; challenges count eligible. Coins are already guest/exempt-inclusive and are NOT touched.

**Tech Stack:** Vanilla ES-module class (`GovernanceEngine.js`), `FitnessSession.js`, `ParticipantRoster.js`; Vitest (`vitest.config.mjs`), colocated `*.test.js`.

**Spec:** `docs/superpowers/specs/2026-06-25-guest-exempt-governance-design.md`

**Test runner (every task):** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`

---

## Verified current state (from code trace)

- **Guests currently DO trigger** warnings/locks: the dominant **snapshot path** (`FitnessSession.js:2041`) builds `activeParticipants` from `effectiveRoster` and does NOT filter `isGuest`; guest roster entries carry an `id`. The pulse path (`ParticipantRoster.getActiveParticipantState:301`) DOES drop guests. The snapshot path drives the kiosk.
- **Guests & exempt already earn coins** (`TimelineRecorder.js:381` `currentTickActiveHR` is device-mapping based, no `isGuest`/exempt filter). → **No coin change needed.**
- **Exempt** are already excluded from numerator (`nonExemptMetCount`), denominator (`_normalizeRequiredCount`), and `missingUsers` — but that means they currently do NOT count toward challenge achievement (must change for challenges).
- The engine has **no guest awareness** — only `config.exemptions` (usernames). Must add `guestIds`.

## Target semantics

| Quantity | Steady-state (`_evaluateZoneRequirement`) | Challenge (`buildChallengeSummary`) |
|----------|-------------------------------------------|-------------------------------------|
| numerator (satisfied) | **subjects** who met | **eligible** (all) who met |
| denominator (`requiredCount`) | **subjects** | **subjects** |
| `missingUsers` (blame) | **subjects** who didn't meet | **subjects** who didn't meet |

`subjects = activeParticipants − guests − exempt`. `eligible = activeParticipants` (all).

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `frontend/src/hooks/fitness/GovernanceEngine.js` | `guestIds` capture, `_buildSubjectFilter`, subject/eligible split in both eval methods + `_normalizeRequiredCount` |
| Modify | `frontend/src/hooks/fitness/FitnessSession.js` | snapshot-path: pass `guestIds` in `evaluate()` payload |
| Modify | `frontend/src/hooks/fitness/ParticipantRoster.js` | pulse-path: include guests + return `guestIds` |
| Test | colocated `GovernanceEngine.guestExempt.test.js` (new) + existing suites | behavior + regression |

---

### Task 1: Engine learns who the guests are (`guestIds` capture + subject filter)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_latestInputs` init `:291-299`; `_captureLatestInputs` `:851-880`; add helper near `_normalizeRequiredCount`)
- Test: `frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js`:

```javascript
/**
 * Guests + exempt users are "non-subjects": eligible for challenge credit but
 * never required and never blamed. This task only verifies the subject filter +
 * guestIds capture; the per-method numerator/missingUsers behavior is Tasks 2-4.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

describe('GovernanceEngine — subject filter (guests + exempt)', () => {
  it('captures guestIds from the evaluate payload into _latestInputs', () => {
    const eng = new GovernanceEngine();
    eng._captureLatestInputs({ activeParticipants: ['a', 'g1'], guestIds: ['g1'] });
    expect(eng._latestInputs.guestIds).toEqual(['g1']);
  });

  it('_buildSubjectFilter excludes both guests and exempt, keeps registered', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['Mom'] };
    eng._captureLatestInputs({ activeParticipants: ['felix', 'mom', 'g1'], guestIds: ['g1'] });
    const isSubject = eng._buildSubjectFilter();
    expect(isSubject('felix')).toBe(true);  // registered
    expect(isSubject('mom')).toBe(false);   // exempt (by name)
    expect(isSubject('g1')).toBe(false);    // guest (by id)
  });

  it('guestIds defaults to empty when omitted (backward compatible)', () => {
    const eng = new GovernanceEngine();
    eng._captureLatestInputs({ activeParticipants: ['a'] });
    expect(eng._latestInputs.guestIds).toEqual([]);
    expect(eng._buildSubjectFilter()('a')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js`
Expected: FAIL — `_buildSubjectFilter` undefined and `_latestInputs.guestIds` undefined.

- [ ] **Step 3: Implement**

(a) In the `_latestInputs` initializer (constructor, currently `:291-299`), add `guestIds: []` to the object literal:

```javascript
    this._latestInputs = {
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: {},
      zoneInfoMap: {},
      totalCount: 0,
      equipmentCadenceMap: {},
      equipmentRiderMap: {},
      guestIds: []
    };
```

(b) In `_captureLatestInputs(payload)` (currently `:862-875`), add `guestIds` to the rebuilt `_latestInputs` object (place it alongside `equipmentRiderMap`):

```javascript
      guestIds: Array.isArray(payload.guestIds) ? [...payload.guestIds] : []
```

(c) Add the helper method immediately above `_normalizeRequiredCount` (currently `:2540`):

```javascript
  /**
   * A "subject" is a participant who is governed: registered, NOT in
   * config.exemptions, and NOT a guest. Only subjects can be required
   * (denominator) or blamed (missingUsers). Guests/exempt are eligible for
   * challenge credit but never carry a negative consequence.
   * Exempt match is by normalized name (exemptions are usernames); guest match
   * is by participant id (the ids that arrive in activeParticipants).
   * @returns {(participantId: string) => boolean}
   */
  _buildSubjectFilter() {
    const exemptUsers = (this.config?.exemptions || []).map((u) => normalizeName(u));
    const guestIds = new Set(this._latestInputs?.guestIds || []);
    return (participantId) =>
      !guestIds.has(participantId) &&
      !exemptUsers.includes(normalizeName(participantId));
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js
git commit -m "feat(governance): engine learns guestIds + subject filter (guests+exempt)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `_normalizeRequiredCount` denominator excludes guests too

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_normalizeRequiredCount` `:2540-2548`)
- Test: append to `GovernanceEngine.guestExempt.test.js`

- [ ] **Step 1: Add the failing test** (append inside the existing `describe`):

```javascript
  it('requiredCount denominator counts only subjects (drops guests + exempt)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['felix', 'milo', 'mom', 'g1'], guestIds: ['g1'] });
    // 'all' over [felix, milo, mom(exempt), g1(guest)] = 2 subjects.
    expect(eng._normalizeRequiredCount('all', 4, ['felix', 'milo', 'mom', 'g1'])).toBe(2);
    // numeric rule clamps to subject count.
    expect(eng._normalizeRequiredCount(3, 4, ['felix', 'milo', 'mom', 'g1'])).toBe(2);
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js`
Expected: FAIL — current code only drops exempt (returns 3, not 2).

- [ ] **Step 3: Implement** — replace the body of `_normalizeRequiredCount` `:2540-2548` (the exempt-only filter) with a subject filter that always applies:

```javascript
  _normalizeRequiredCount(rule, totalCount, activeParticipants = []) {
    // Only subjects (registered, non-exempt, non-guest) count toward the
    // denominator — guests/exempt never raise the bar.
    let effectiveCount = totalCount;
    if (Array.isArray(activeParticipants) && activeParticipants.length > 0) {
      const isSubject = this._buildSubjectFilter();
      effectiveCount = activeParticipants.filter(isSubject).length;
    }
```

(Leave the `if (typeof rule === 'number' …)` block and the rest of the method unchanged.)

- [ ] **Step 4: Run it, verify it passes** (same command) → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js
git commit -m "feat(governance): requiredCount denominator excludes guests + exempt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Steady-state requirement — subjects-only numerator + missingUsers

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_evaluateZoneRequirement` `:2488-2538`)
- Test: append to `GovernanceEngine.guestExempt.test.js`

- [ ] **Step 1: Add the failing test** (append):

```javascript
  it('steady-state: a guest in-zone does NOT satisfy and is never missing', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    eng._latestInputs.zoneRankMap = { cold: 0, warm: 1, hot: 2 };
    eng._latestInputs.zoneInfoMap = { hot: { id: 'hot', name: 'Hot' } };
    eng._captureLatestInputs({
      activeParticipants: ['felix', 'g1'], guestIds: ['g1'],
      zoneRankMap: { cold: 0, warm: 1, hot: 2 },
      zoneInfoMap: { hot: { id: 'hot', name: 'Hot' } },
    });
    // require all in HOT; felix is cold (subject, fails), guest is hot.
    const userZoneMap = { felix: 'cold', g1: 'hot' };
    const res = eng._evaluateZoneRequirement('hot', 'all', ['felix', 'g1'], userZoneMap,
      eng._latestInputs.zoneRankMap, eng._latestInputs.zoneInfoMap, 2);
    expect(res.satisfied).toBe(false);                 // guest can't satisfy steady-state
    expect(res.missingUsers).toEqual(['felix']);       // only the subject is blamed
    expect(res.missingUsers).not.toContain('g1');      // guest never blamed
  });
```

- [ ] **Step 2: Run it, verify it fails** (same command) → FAIL (current code counts the guest in `nonExemptMetCount`, so satisfied would be true / guest mishandled).

- [ ] **Step 3: Implement** — in `_evaluateZoneRequirement` (`:2488-2538`), replace the exempt-only counting with the subject filter. Specifically:

Replace lines `:2494-2521` (from `const exemptUsers = …` through the `missingUsers` definition) with:

```javascript
    const isSubject = this._buildSubjectFilter();
    const metUsers = [];
    let subjectMetCount = 0;
    activeParticipants.forEach((participantId) => {
      const participantZoneId = userZoneMap[participantId];
      if (!participantZoneId) {
        getLogger().warn('participant.zone.lookup_failed', {
          key: participantId,
          availableKeys: Object.keys(userZoneMap),
          caller: 'GovernanceEngine._evaluateZoneRequirement'
        });
      }
      const participantRank = this._getZoneRank(participantZoneId) ?? 0;
      if (participantRank >= requiredRank) {
        metUsers.push(participantId);
        if (isSubject(participantId)) subjectMetCount++;
      }
    });

    const requiredCount = this._normalizeRequiredCount(rule, totalCount, activeParticipants);
    // Steady-state: only SUBJECTS satisfy it (guests/exempt can't clear the
    // always-on requirement — anti-cheat). They are also never blamed.
    const satisfied = subjectMetCount >= requiredCount;
    const missingUsers = activeParticipants.filter((participantId) =>
      !metUsers.includes(participantId) && isSubject(participantId)
    );
```

Then update the returned object's `actualCount` (currently `:2533`) from `nonExemptMetCount` to `subjectMetCount`.

- [ ] **Step 4: Run it, verify it passes** (same command) → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js
git commit -m "feat(governance): steady-state satisfied/blamed by subjects only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Challenge — eligible numerator (guests+exempt count), subjects-only blame

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`buildChallengeSummary` zone branch `:3507-3549`)
- Test: append to `GovernanceEngine.guestExempt.test.js`

The challenge summary is built by a closure `buildChallengeSummary` defined at `:3488`. The zone branch (`:3507-3549`) currently mirrors steady-state (exempt-only). Change it so the **numerator counts everyone who met** (eligible), while `requiredCount`/`missingUsers` stay subjects-only.

- [ ] **Step 1: Add the failing test.** `buildChallengeSummary` is an inner closure (not directly callable), so assert via the public path is heavy; instead extract the intent into a focused unit by calling the engine's challenge evaluation through its tested seam. Use the existing pattern from `GovernanceEngine.challenge*.test.js` if present; otherwise this test drives the closure through `_buildChallengeSnapshot`/evaluate. Append a direct-logic test that will fail until the numerator counts eligible:

```javascript
  it('challenge: a guest in-zone counts toward achievement (group tally)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    const zoneRankMap = { cold: 0, warm: 1, hot: 2 };
    const zoneInfoMap = { hot: { id: 'hot', name: 'Hot' } };
    eng._captureLatestInputs({
      activeParticipants: ['felix', 'g1'], guestIds: ['g1'], zoneRankMap, zoneInfoMap,
    });
    eng._latestInputs.zoneRankMap = zoneRankMap;
    eng._latestInputs.zoneInfoMap = zoneInfoMap;
    // Helper mirrors the challenge numerator semantics via the public evaluator
    // added in Step 3 (evaluateChallengeZone) — see implementation.
    const res = eng.evaluateChallengeZone(
      { zone: 'hot', rule: 2 },
      ['felix', 'g1'],
      { felix: 'hot', g1: 'hot' },
      2
    );
    expect(res.satisfied).toBe(true);            // 1 subject + 1 guest meet "2 in hot"
    expect(res.actualCount).toBe(2);             // eligible numerator counts the guest
    expect(res.missingUsers).toEqual([]);        // nobody blamed
  });

  it('challenge: a slacking guest is never blamed', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    const zoneRankMap = { cold: 0, hot: 2 };
    eng._captureLatestInputs({ activeParticipants: ['felix', 'g1'], guestIds: ['g1'], zoneRankMap });
    eng._latestInputs.zoneRankMap = zoneRankMap;
    const res = eng.evaluateChallengeZone({ zone: 'hot', rule: 1 }, ['felix', 'g1'], { felix: 'hot', g1: 'cold' }, 2);
    expect(res.satisfied).toBe(true);            // felix (subject) meets required 1
    expect(res.missingUsers).toEqual([]);        // guest cold but NOT blamed
  });
```

- [ ] **Step 2: Run it, verify it fails** (same command) → FAIL (`evaluateChallengeZone` not defined).

- [ ] **Step 3: Implement.** Extract the challenge zone-scoring into a small public method so it is unit-testable and reused by the closure (DRY). Add this method near `_evaluateZoneRequirement`:

```javascript
  /**
   * Challenge zone scoring. Unlike steady-state, the numerator counts EVERY
   * eligible participant who met the zone (subjects + guests + exempt) — a guest
   * can fill the group tally. requiredCount + missingUsers stay subjects-only,
   * so guests/exempt are never required and never blamed.
   */
  evaluateChallengeZone(challenge, activeParticipants, userZoneMap, totalCount) {
    const zoneId = challenge.zone;
    const zoneInfo = this._getZoneInfo(zoneId);
    const requiredRank = this._getZoneRank(zoneId) ?? 0;
    const isSubject = this._buildSubjectFilter();

    const metUsers = [];
    activeParticipants.forEach((participantId) => {
      const pRank = this._getZoneRank(userZoneMap[participantId]) ?? 0;
      if (pRank >= requiredRank) metUsers.push(participantId);
    });

    const requiredCount = this._normalizeRequiredCount(challenge.rule, totalCount, activeParticipants);
    const satisfied = metUsers.length >= requiredCount; // eligible numerator
    const missingUsers = activeParticipants.filter((participantId) =>
      !metUsers.includes(participantId) && isSubject(participantId)
    );

    return {
      satisfied,
      metUsers,
      missingUsers,
      actualCount: metUsers.length,
      requiredCount,
      zoneLabel: zoneInfo?.name || zoneId
    };
  }
```

Then in the `buildChallengeSummary` closure zone branch (`:3508-3549`), replace the inline scoring block (the `const exemptUsers …` through the `return { satisfied, metUsers, missingUsers, actualCount: nonExemptMetCount, requiredCount: liveRequiredCount, zoneLabel … }`) with a delegation:

```javascript
        // Existing zone-based logic follows unchanged...
        return this.evaluateChallengeZone(challenge, activeParticipants, userZoneMap, totalCount);
```

- [ ] **Step 4: Run it, verify it passes** (same command) → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js
git commit -m "feat(governance): challenges count guests+exempt toward achievement, blame subjects only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Plumb `guestIds` from both governance input paths

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (`:2041-2100`)
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js` (`getActiveParticipantState` `:293-340`)
- Test: `frontend/src/hooks/fitness/ParticipantRoster.guestExempt.test.js` (new)

- [ ] **Step 1: Write the failing roster test.** Create `frontend/src/hooks/fitness/ParticipantRoster.guestExempt.test.js`:

```javascript
/**
 * getActiveParticipantState must now INCLUDE guests (so they can earn challenge
 * credit downstream) and report them via guestIds (so the engine can keep them
 * out of the subject set). Mirrors the harness in ParticipantRoster.hrFloor.test.js.
 */
import { describe, it, expect } from 'vitest';
import { ParticipantRoster } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const build = () => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager });
  return { roster, deviceManager, userManager };
};

describe('getActiveParticipantState — guests included + flagged', () => {
  it('includes a guest in participants and lists its id in guestIds', () => {
    const { roster, deviceManager, userManager } = build();
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 150, lastSeen: Date.now() });
    userManager.assignGuest('29425', 'Guest', { profileId: 'guest_29425', occupantType: 'guest' });

    const state = roster.getActiveParticipantState();
    expect(state.participants).toContain('guest_29425');
    expect(state.guestIds).toContain('guest_29425');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.guestExempt.test.js`
Expected: FAIL — guest is skipped (`:301`) and `guestIds` is undefined.

- [ ] **Step 3: Implement the pulse path** — in `ParticipantRoster.getActiveParticipantState()` (`:293-340`): remove the `if (entry.isGuest) continue;` exclusion; instead include the guest in `participants` and collect its id into a new `guestIds` array; return `guestIds`.

Replace the loop head + the return:

```javascript
  getActiveParticipantState() {
    const roster = this.getRoster();
    const participants = [];
    const hrInactiveUsers = [];
    const guestIds = [];
    const zoneMap = {};

    for (const entry of roster) {
      if (!entry.isActive) continue;
      const id = entry.id || entry.profileId;
      if (!id) continue;
      if (entry.hrInactive) {
        hrInactiveUsers.push(id);
        continue;
      }
      participants.push(id);
      if (entry.isGuest) guestIds.push(id);   // eligible, but flagged non-subject
      const zoneId = entry.zoneId;
      if (zoneId) {
        zoneMap[id] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
      }
    }
```

…and change the final `return` (currently `:339`) to include `guestIds`:

```javascript
    return { participants, zoneMap, totalCount: participants.length, hrInactiveUsers, guestIds };
```

(Leave the diagnostic logging block between as-is.)

- [ ] **Step 4: Run the roster test, verify it passes** (same command) → PASS.

- [ ] **Step 5: Wire the snapshot path** — in `FitnessSession.js` (`:2049` area, right after `hrInactiveUsers` is built), add a `guestIds` collection from `effectiveRoster`, and add it to the `evaluate()` payload (`:2091-2100`):

```javascript
    // Guests are eligible (challenge credit + coins) but never governed as
    // subjects — flag them so the engine keeps them out of required/missing.
    const guestIds = effectiveRoster
        .filter(entry => entry.isGuest && (entry.id || entry.profileId))
        .map(entry => entry.id || entry.profileId);
```

Then add `guestIds,` to the `this.governanceEngine.evaluate({ … })` object (alongside `hrInactiveUsers`).

- [ ] **Step 6: Wire the pulse path payload** — find where `GovernanceEngine.evaluate()` consumes `getActiveParticipantState()` (the pulse fallback, ~`GovernanceEngine.js:1979`) and ensure the `guestIds` from that state object is passed into the same `_captureLatestInputs`/evaluate payload it builds. Read that block and add `guestIds: state.guestIds` (or equivalent var name) to the captured inputs so the pulse path is consistent with the snapshot path.

- [ ] **Step 7: Run both new test files + the engine suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.guestExempt.test.js frontend/src/hooks/fitness/ParticipantRoster.guestExempt.test.js --exclude '**/.claire/**'`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/ParticipantRoster.js frontend/src/hooks/fitness/ParticipantRoster.guestExempt.test.js frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "feat(governance): plumb guestIds through snapshot + pulse paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full governance/roster regression sweep + coin no-op confirmation

**Files:** none (verification); fix any test that encoded the OLD exempt-challenge behavior.

- [ ] **Step 1: Run the fitness-hooks governance + roster suites**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ --exclude '**/.claire/**'`
Expected: green. **Watch for** existing challenge tests that asserted exempt users do NOT count toward a challenge — those encoded the old behavior and must be updated to the new group-tally semantics (exempt/guests now count toward challenge achievement). Update such assertions to match the spec; do NOT weaken steady-state tests (subjects-only there is unchanged from exempt's prior behavior).

- [ ] **Step 2: Confirm coins are untouched** — grep proves no change to the coin path:

Run: `git diff main --stat -- frontend/src/hooks/fitness/TreasureBox.js frontend/src/hooks/fitness/TimelineRecorder.js`
Expected: no output (those files unchanged). Guests/exempt already earn coins via the device-mapping coin set; this change does not alter it.

- [ ] **Step 3: Commit any test updates**

```bash
git add -A frontend/src/hooks/fitness/
git commit -m "test(governance): update challenge tests to group-tally (guests+exempt count)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** subject/eligible split (Tasks 1-4) ✓; no-negative-ever for guests+exempt in both gates (Tasks 3-4 missingUsers subjects-only) ✓; challenge group-tally credit (Task 4) ✓; steady-state subjects-only satisfaction / anti-cheat (Task 3) ✓; guestIds plumbing both paths (Task 5) ✓; coins unchanged (Task 6 confirms) ✓; exempt = config.exemptions ✓.
- **Placeholder scan:** all steps carry concrete code/commands.
- **Type/name consistency:** `_buildSubjectFilter()` (Task 1) used identically in Tasks 2-4; `guestIds` key consistent across `_captureLatestInputs`, `evaluate()` payload, `getActiveParticipantState` return, and the snapshot builder; `evaluateChallengeZone(challenge, activeParticipants, userZoneMap, totalCount)` defined in Task 4 and called by the closure + tests with that exact signature; `subjectMetCount`/`actualCount` consistent in Task 3.
- **Risk:** the inner `buildChallengeSummary` closure (Task 4) also has non-zone branches (vibration at `:3500`); only the zone branch is delegated — verify the vibration branch is untouched.
