# Cycle Game — Targeted Race-Visual & Ghost Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the seven well-specified, high-value fixes from the 2026-06-04 cycle-game audit (F14, F12, F10, F4, F1, F2, F11) — one self-contained task each.

**Architecture:** All changes are inside the existing `frontend/src/modules/Fitness/widgets/CycleGame/` (panels + lobby) and `lib/cycleGame/` (pure models). Pure logic is fixed test-first in the `lib/` models (`participantIdentity`, `ovalTrackModel`, `CameraZoom`'s `framePositions`); presentational fixes are verified with `@testing-library` component tests plus an explicit on-kiosk visual check (jsdom can't prove motion). No backend, no persistence-format changes.

**Tech Stack:** React 18 (JSX), SCSS, vitest + @testing-library/react (jsdom). Run a single test file with `./node_modules/.bin/vitest run <path>` (config auto-resolves; verified working in this repo).

**Source audit:** `docs/_wip/audits/2026-06-04-cycle-game-race-visualization-audit.md`.
**Reference:** `docs/reference/fitness/cycle-game.md`.

**Out of scope (deferred — see end of doc):** F3, F5, F7, F8, F9, F13, F15. These need UX/structural decisions and should each get their own brainstorm + plan.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `lib/cycleGame/participantIdentity.js` | Resolve `ghost:…` ids → real source user (deref nested ghosts) | T1 |
| `lib/cycleGame/participantIdentity.test.js` | Unit tests for the resolver | T1 |
| `widgets/CycleGame/CycleGameContainer.jsx` | `onSelectGhost` — flatten imported ghost ids to first-gen | T1 |
| `widgets/CycleGame/CycleGameHome.jsx` | Remove the "Tap again to choose" label | T2 |
| `widgets/CycleGame/panels/CameraZoom.jsx` | `framePositions` — add framing margin | T3 |
| `widgets/CycleGame/panels/CameraZoom.test.jsx` | Unit test for the margin | T3 |
| `lib/cycleGame/ovalTrackModel.js` | `ovalProgressFor` — one revolution = one lap when laps on | T4 |
| `lib/cycleGame/ovalTrackModel.test.js` | Unit tests for `ovalProgressFor` | T4 |
| `widgets/CycleGame/CycleRaceScreen.jsx` | Wire the oval to `ovalProgressFor` | T4 |
| `widgets/CycleGame/panels/OvalTrack.jsx` | Position markers via CSS `transform` property (animatable on FF) | T5 |
| `widgets/CycleGame/panels/OvalTrack.scss` | Glide duration | T5 |
| `widgets/CycleGame/panels/OvalTrack.test.jsx` | Assert CSS-property positioning (not SVG attr) | T5 |
| `widgets/CycleGame/panels/RacePistons.scss` | Glide duration to fill the tick | T6 |
| `widgets/CycleGame/panels/CameraZoom.scss` | Glide duration to fill the tick | T6 |
| `widgets/CycleGame/panels/RacePistons.jsx` | Wrap ghost tip avatar in `.cg-ghost` | T7 |
| `widgets/CycleGame/panels/RacePistons.test.jsx` | Assert ghost styling on the tip avatar | T7 |

---

## Task 1: F14 — Dereference ghost-of-a-ghost to the original rider

**Why:** `participantIdentity.js:16` does `id.split(':')[2]`, which returns the literal `"ghost"` for a nested id `ghost:R2:ghost:R1:user_1` → avatar URL `/users/ghost` → 404/broken face. The morning's log proves nested ids are minted (`ghost:20260604055802:ghost:20260604055230:user_1`). Fix the resolver to take the final segment, and stop `onSelectGhost` from nesting in the first place (store a first-generation ghost). Guest source ids are hyphenated (`guest-adult`) so they contain no inner colons — the final segment is always the real source slug.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.js:14-24`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx:952-962`

- [ ] **Step 1: Write the failing tests for nested-ghost resolution**

Add these cases to `participantIdentity.test.js` (inside the existing top-level `describe`, or append a new one):

```javascript
import { describe, it, expect } from 'vitest';
import { resolveParticipantIdentity } from './participantIdentity.js';

describe('resolveParticipantIdentity — ghost dereference', () => {
  it('resolves a first-generation ghost to its source user', () => {
    const r = resolveParticipantIdentity('ghost:20260604055230:user_1', 'KC');
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('user_1');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/kckern');
  });

  it('resolves a SECOND-generation ghost back to the original user (not "ghost")', () => {
    const r = resolveParticipantIdentity('ghost:R2:ghost:R1:user_1', 'KC');
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('user_1');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/kckern');
  });

  it('resolves a ghost of a hyphenated guest id', () => {
    const r = resolveParticipantIdentity('ghost:R1:guest-adult', 'Guest (Adult)');
    expect(r.sourceId).toBe('guest-adult');
  });

  it('passes a real (non-ghost) id through unchanged', () => {
    const r = resolveParticipantIdentity('user_3', 'User_3');
    expect(r.isGhost).toBe(false);
    expect(r.sourceId).toBe('user_3');
  });
});
```

- [ ] **Step 2: Run the tests to verify the second-gen case fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.test.js`
Expected: FAIL on "resolves a SECOND-generation ghost…" — `sourceId` is `"ghost"`, not `"user_1"`.

- [ ] **Step 3: Fix the resolver to take the final segment**

In `participantIdentity.js`, change line 16 from:

```javascript
  const sourceId = isGhost ? (id.split(':')[2] || id) : id;
```

to:

```javascript
  // A ghost id is `ghost:<raceId>:<sourceId>`. A ghost recorded from a race that
  // itself contained a ghost nests (`ghost:R2:ghost:R1:user`); the real source is
  // always the FINAL segment (source slugs — incl. hyphenated guests — never
  // contain a colon), so dereference straight to it rather than blindly taking [2].
  const sourceId = isGhost ? (id.split(':').pop() || id) : id;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Stop `onSelectGhost` from nesting — store first-generation ghosts**

In `CycleGameContainer.jsx`, the `onSelectGhost` callback builds rider ids as
`ghost:${candidate.raceId}:${p.id}`. When `p.id` is itself a ghost id, that nests.
Route it through the resolver so the new id references the original source, and
de-duplicate the 👻 suffix. Change the `.map(...)` at lines 954-962 from:

```javascript
    const riders = (candidate.participants || []).map((p) => ({
      userId: `ghost:${candidate.raceId}:${p.id}`,
      displayName: `${p.displayName} 👻`,
      ghostSeries: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
      ghostHrSeries: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
      ghostRpmSeries: SessionSerializerV3.decodeSeries(p.rpmSeries) || [],
      ghostZoneSeries: SessionSerializerV3.decodeSeries(p.zoneSeries) || [],
      ghostIntervalS: candidate.intervalSeconds || 1
    })).filter((r) => r.ghostSeries.length > 0);
```

to:

```javascript
    const riders = (candidate.participants || []).map((p) => {
      // Flatten ghost-of-a-ghost: reference the ORIGINAL source user so we never
      // mint `ghost:R2:ghost:R1:user` (which 404s the avatar). resolveParticipantIdentity
      // returns the final source slug for nested ids; for a real id it's the id itself.
      const { sourceId } = resolveParticipantIdentity(p.id, p.displayName);
      const baseName = String(p.displayName || sourceId).replace(/\s*👻\s*$/, '');
      return {
        userId: `ghost:${candidate.raceId}:${sourceId}`,
        displayName: `${baseName} 👻`,
        ghostSeries: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
        ghostHrSeries: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
        ghostRpmSeries: SessionSerializerV3.decodeSeries(p.rpmSeries) || [],
        ghostZoneSeries: SessionSerializerV3.decodeSeries(p.zoneSeries) || [],
        ghostIntervalS: candidate.intervalSeconds || 1
      };
    }).filter((r) => r.ghostSeries.length > 0);
```

Then confirm the import exists at the top of `CycleGameContainer.jsx` (it is already used at line 475):

```javascript
import { resolveParticipantIdentity } from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
```

If that import line is missing, add it next to the other `lib/cycleGame` imports.

- [ ] **Step 6: Run the broader cycle-game lib + container suites**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.test.js`
Expected: PASS.
Then, if a container test exists, run it: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.js \
        frontend/src/modules/Fitness/lib/cycleGame/participantIdentity.test.js \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "fix(cycle-game): dereference ghost-of-a-ghost to the original rider (F14)"
```

---

## Task 2: F12 — Remove the "Tap again to choose" label

**Why:** `CycleGameHome.jsx:536-538` renders a `flex-shrink:0` label on the focused ghost card that forces word-wrapping and breaks the card layout. The two-tap model (tap = highlight, tap again = commit) is already visually obvious; delete the label.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx:536-538`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (remove the now-dead `.cgh-ghost-card__confirm` rule)

- [ ] **Step 1: Remove the label JSX**

In `CycleGameHome.jsx`, delete these three lines (536-538):

```javascript
                        {isFocused && (
                          <span className="cgh-ghost-card__confirm">Tap again to choose</span>
                        )}
```

- [ ] **Step 2: Remove the dead SCSS rule**

In `CycleGameHome.scss`, delete the `.cgh-ghost-card__confirm { … }` block (around lines 830-838):

```scss
.cgh-ghost-card__confirm {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: t.$cg-cyan;
}
```

- [ ] **Step 3: Verify the string is gone**

Run: `grep -rn "Tap again to choose\|cgh-ghost-card__confirm" frontend/src/modules/Fitness/widgets/CycleGame/`
Expected: no matches.

- [ ] **Step 4: Build the frontend to confirm SCSS still compiles**

Run: `npx vite build 2>&1 | tail -5`
Expected: build succeeds (no SCSS error referencing the removed class).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss
git commit -m "fix(cycle-game): drop the layout-breaking 'Tap again to choose' label (F12)"
```

---

## Task 3: F10 (part 1) — Camera framing margin

**Why:** `framePositions` (`CameraZoom.jsx:15-23`) maps the trailing rider to 0% and the leader to 100% — markers pin to the literal edges with no framing. Add a 15% margin so the field reads inside a framed shot (trailing → 15%, leader → 85%). *(The grid-pan-coupled-to-speed half of F10 is deferred — it needs a leader-position prop and is design-adjacent.)*

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.jsx:15-23`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.test.jsx`

- [ ] **Step 1: Write the failing test for the margin**

Add to `CameraZoom.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { framePositions } from './CameraZoom.jsx';

describe('framePositions — framing margin', () => {
  it('insets the trailing rider to 15% and the leader to 85%', () => {
    const out = framePositions([
      { id: 'a', distanceM: 0 },
      { id: 'b', distanceM: 100 }
    ]);
    const a = out.find((p) => p.id === 'a');
    const b = out.find((p) => p.id === 'b');
    expect(a.xPct).toBeCloseTo(15, 5);
    expect(b.xPct).toBeCloseTo(85, 5);
  });

  it('puts a mid rider proportionally inside the framed band', () => {
    const out = framePositions([
      { id: 'a', distanceM: 0 },
      { id: 'b', distanceM: 50 },
      { id: 'c', distanceM: 100 }
    ]);
    expect(out.find((p) => p.id === 'b').xPct).toBeCloseTo(50, 5);
  });

  it('centers everyone at 50% when there is no spread', () => {
    const out = framePositions([
      { id: 'a', distanceM: 40 },
      { id: 'b', distanceM: 40 }
    ]);
    expect(out.every((p) => p.xPct === 50)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.test.jsx`
Expected: FAIL — current code returns 0 and 100, not 15 and 85.

- [ ] **Step 3: Add the margin to `framePositions`**

In `CameraZoom.jsx`, change the function body (lines 15-23) to:

```javascript
export function framePositions(riders) {
  const MARGIN_PCT = 15; // keep the field off the literal edges so the shot is framed
  const span = 100 - MARGIN_PCT * 2;
  const ds = riders.map((r) => r.distanceM || 0);
  const min = Math.min(...ds), max = Math.max(...ds);
  const range = max - min;
  return riders.map((r) => ({
    id: r.id,
    xPct: range > 0 ? MARGIN_PCT + (((r.distanceM || 0) - min) / range) * span : 50
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.test.jsx
git commit -m "fix(cycle-game): frame the camera field with a 15% margin (F10)"
```

---

## Task 4: F4 — Oval honors lap length (one revolution = one lap)

**Why:** The oval ignores `lap_length_m`. `ovalTrackModel.circuitProgress` maps the whole race (distance) or `oval_circuit_m` (time) onto one loop, so in a time race the marker is just `distance / 1000m`. When laps are enabled the tester wants **one full revolution per lap** (lap completes at the top tick). This deliberately re-couples the oval to laps (reversing commit `5493e0c24`'s "whole-race track" decision — note for the F7 redesign).

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/ovalTrackModel.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/ovalTrackModel.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx:83-92`

- [ ] **Step 1: Write the failing tests for `ovalProgressFor`**

Add to `ovalTrackModel.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { ovalProgressFor } from './ovalTrackModel.js';

describe('ovalProgressFor — laps drive one revolution per lap', () => {
  it('when laps are ON, returns the fraction INTO the current lap (one rev/lap)', () => {
    // lap = 100 m: 250 m total => 2 full laps + 0.5 into the 3rd.
    expect(ovalProgressFor({
      winCondition: 'time', distanceM: 250, goalM: null, ovalCircuitM: 1000, lapLengthM: 100
    })).toBeCloseTo(0.5, 5);
  });

  it('a rider exactly on a lap boundary reads 0 (top of the oval)', () => {
    expect(ovalProgressFor({
      winCondition: 'time', distanceM: 300, goalM: null, ovalCircuitM: 1000, lapLengthM: 100
    })).toBeCloseTo(0, 5);
  });

  it('when laps are OFF, falls back to whole-race circuit progress (distance race, clamped)', () => {
    expect(ovalProgressFor({
      winCondition: 'distance', distanceM: 1500, goalM: 3000, ovalCircuitM: 1000, lapLengthM: 0
    })).toBeCloseTo(0.5, 5);
    // finisher parks at the top (clamped to 1)
    expect(ovalProgressFor({
      winCondition: 'distance', distanceM: 4000, goalM: 3000, ovalCircuitM: 1000, lapLengthM: 0
    })).toBeCloseTo(1, 5);
  });

  it('when laps are OFF in a time race, uses oval_circuit_m unclamped', () => {
    expect(ovalProgressFor({
      winCondition: 'time', distanceM: 1500, goalM: null, ovalCircuitM: 1000, lapLengthM: 0
    })).toBeCloseTo(1.5, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/ovalTrackModel.test.js`
Expected: FAIL — `ovalProgressFor` is not exported.

- [ ] **Step 3: Implement `ovalProgressFor`**

In `ovalTrackModel.js`, add the import and the new function (keep the existing `circuitTargetFor` / `circuitProgress` exports intact):

```javascript
import { lapProgress } from './lapModel.js';
```

```javascript
/**
 * Oval marker progress (0..1+ around the loop). When laps are enabled the oval is
 * a LAP track: one full revolution = one lap, so progress is the fraction into the
 * current lap (it wraps 1→0 across the top tick each lap). When laps are off it
 * falls back to the whole-race circuit progress (distance race clamps at the line;
 * time race wraps past oval_circuit_m).
 */
export function ovalProgressFor({ winCondition, distanceM, goalM, ovalCircuitM = DEFAULT_OVAL_CIRCUIT_M, lapLengthM = 0 }) {
  if (Number.isFinite(lapLengthM) && lapLengthM > 0) {
    return lapProgress(distanceM, lapLengthM);
  }
  return circuitProgress(
    distanceM,
    circuitTargetFor(winCondition, goalM, ovalCircuitM),
    { clamp: winCondition === 'distance' }
  );
}
```

Add `ovalProgressFor` to the default export object:

```javascript
export default { circuitTargetFor, circuitProgress, ovalProgressFor, DEFAULT_OVAL_CIRCUIT_M };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/ovalTrackModel.test.js`
Expected: PASS.

- [ ] **Step 5: Wire `CycleRaceScreen` to use it**

In `CycleRaceScreen.jsx`, update the import on line 7:

```javascript
import { circuitTargetFor, circuitProgress, ovalProgressFor } from '@/modules/Fitness/lib/cycleGame/ovalTrackModel.js';
```

Then change the `lapPanel` factory's `progress` prop (lines 83-92) from the `circuitProgress(...)` call to:

```javascript
        progress={Object.fromEntries(riderIds.map((id) => [
          id,
          ovalProgressFor({
            winCondition,
            distanceM: riders[id]?.cumulativeDistanceM || 0,
            goalM,
            ovalCircuitM,
            lapLengthM
          })
        ]))} />
```

(`circuitTargetFor` / `circuitProgress` may now be unused in this file — if your lint flags them, drop them from the import on line 7, leaving only `ovalProgressFor`.)

- [ ] **Step 6: Run the screen test to confirm no regression**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/ovalTrackModel.js \
        frontend/src/modules/Fitness/lib/cycleGame/ovalTrackModel.test.js \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx
git commit -m "feat(cycle-game): oval honors lap_length_m — one revolution per lap (F4)"
```

---

## Task 5: F1 — Oval markers actually animate (CSS transform property, not SVG attribute)

**Why:** `OvalTrack.jsx:56` sets marker position with the SVG `transform` **attribute**; the SCSS `transition: transform` can't animate that on the Firefox 151 kiosk, so markers snap. Drive position with the CSS `transform` **property** (inline style) instead — Firefox transitions that on SVG `<g>`. jsdom can't prove motion, so the test asserts the *mechanism* (CSS property set, attribute absent) and the step ends with a required on-kiosk visual check.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.jsx:51-57`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.scss:42-44`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx`

- [ ] **Step 1: Write the failing test for the positioning mechanism**

Add to `OvalTrack.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import OvalTrack from './OvalTrack.jsx';

describe('OvalTrack — marker positioned via CSS transform property (animatable on FF)', () => {
  it('sets an inline style transform and NOT the SVG transform attribute', () => {
    const { getAllByTestId } = render(
      <OvalTrack
        riderIds={['a']}
        riders={{ a: { displayName: 'Ann' } }}
        progress={{ a: 0.25 }}
      />
    );
    const marker = getAllByTestId('oval-marker')[0];
    // Mechanism: CSS transform property (transitionable in Firefox), not the
    // SVG presentation attribute (which Firefox won't transition).
    expect(marker.getAttribute('transform')).toBeNull();
    expect(marker.style.transform).toMatch(/translate\(/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx`
Expected: FAIL — the marker currently has a `transform` attribute and no inline transform style.

- [ ] **Step 3: Switch the marker to the CSS transform property**

In `OvalTrack.jsx`, change the `<g …>` (lines 51-57) from:

```javascript
            <g
              key={`oval-marker-${id}`}
              className={`cg-oval-track__marker${isGhost ? ' cg-oval-track__marker--ghost' : ''}`}
              data-testid="oval-marker"
              transform={`translate(${p.x} ${p.y})`}
            >
```

to:

```javascript
            <g
              key={`oval-marker-${id}`}
              className={`cg-oval-track__marker${isGhost ? ' cg-oval-track__marker--ghost' : ''}`}
              data-testid="oval-marker"
              // CSS transform PROPERTY (not the SVG attribute) so the glide transition
              // in OvalTrack.scss actually animates on the Firefox kiosk. px == user units
              // for a translate, so the ellipse coordinates carry over unchanged.
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            >
```

- [ ] **Step 4: Lengthen the glide to fill the 1 Hz tick**

In `OvalTrack.scss`, change the marker transition (line 44) from:

```scss
    transition: transform 0.3s linear;
```

to:

```scss
    // Glide across the whole 1 Hz tick interval so motion reads continuous.
    transition: transform 0.9s linear;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx`
Expected: PASS.

- [ ] **Step 6: Visual check on the kiosk (REQUIRED — jsdom can't prove motion)**

Build + deploy (this host is prod), open a race with ≥2 riders or a ghost on the Firefox office screen, and confirm the oval markers **glide** between positions each second instead of snapping.

```bash
npx vite build 2>&1 | tail -3
```

Then follow the build+deploy steps in `CLAUDE.local.md` (or ask the operator to eyeball `/fitness/module/cycle_game`). Confirm: markers glide; ghost markers still dashed/dimmed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx
git commit -m "fix(cycle-game): animate oval markers via CSS transform property (F1)"
```

---

## Task 6: F2 — Piston & camera glides fill the tick (continuous motion)

**Why:** Pistons (`0.45s`) and camera markers (`0.3s`) transition correctly but finish well before the next 1 Hz tick, so they "move then pause." Lengthen to `0.9s linear` so each glide spans the tick interval and reads continuous, matching the oval (T5) and the chart's rAF feel. SCSS-only; jsdom can't prove motion, so this task is verified visually.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.scss:30,39`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.scss:73`

- [ ] **Step 1: Lengthen the piston bar + head glide**

In `RacePistons.scss`, change line 30 from:

```scss
    transition: width 0.45s cubic-bezier(0.33, 1, 0.68, 1);
```

to:

```scss
    transition: width 0.9s linear;
```

and line 39 from:

```scss
    transition: left 0.45s cubic-bezier(0.33, 1, 0.68, 1);
```

to:

```scss
    transition: left 0.9s linear;
```

- [ ] **Step 2: Lengthen the camera marker glide**

In `CameraZoom.scss`, change line 73 from:

```scss
    transition: left 0.3s linear;
```

to:

```scss
    transition: left 0.9s linear;
```

- [ ] **Step 3: Confirm SCSS compiles**

Run: `npx vite build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 4: Visual check on the kiosk (REQUIRED)**

In a live race, confirm the piston bars/avatars and the camera markers glide smoothly across the full second instead of snapping-then-resting. (Deploy per `CLAUDE.local.md`, or have the operator eyeball it.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.scss
git commit -m "fix(cycle-game): glide pistons + camera across the full tick (F2)"
```

---

## Task 7: F11 — Ghost styling on the piston tip avatar

**Why:** The piston tip uses a real `CircularUserAvatar` but only sets `opacity` for ghosts — it skips the canonical grayscale+tint (`.cg-ghost`) that the speedometer/rankings/results use. Wrap the ghost avatar in `.cg-ghost` so the treatment is consistent. *(The other F11 surfaces — oval/camera markers render initials not faces, and the ghost-picker card img — are folded into the F7/F15 redesign work where those panels are reworked; this task fixes the one chart that already renders a face.)*

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.jsx:44-59`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.test.jsx`

- [ ] **Step 1: Write the failing test for ghost styling**

Add to `RacePistons.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RacePistons from './RacePistons.jsx';

describe('RacePistons — ghost tip avatar carries the cg-ghost treatment', () => {
  it('wraps a ghost rider tip avatar in .cg-ghost', () => {
    const { container } = render(
      <RacePistons
        riderIds={['g']}
        riders={{ g: { displayName: 'Ann 👻', isGhost: true, cumulativeDistanceM: 120 } }}
        riderLive={{ g: {} }}
      />
    );
    const head = container.querySelector('.cg-pistons__head');
    expect(head).not.toBeNull();
    expect(head.querySelector('.cg-ghost')).not.toBeNull();
  });

  it('does NOT wrap a live (non-ghost) rider in .cg-ghost', () => {
    const { container } = render(
      <RacePistons
        riderIds={['h']}
        riders={{ h: { displayName: 'Bob', isGhost: false, cumulativeDistanceM: 120 } }}
        riderLive={{ h: {} }}
      />
    );
    expect(container.querySelector('.cg-pistons__head .cg-ghost')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.test.jsx`
Expected: FAIL — there is no `.cg-ghost` element inside the head.

- [ ] **Step 3: Wrap the ghost avatar in `.cg-ghost`**

In `RacePistons.jsx`, change the head block (lines 44-59) from:

```javascript
              <div
                className={`cg-pistons__head${isGhost ? ' is-ghost' : ''}`}
                style={{ left: `${(f * 100).toFixed(2)}%`, '--cg-piston-color': color }}
              >
                <CircularUserAvatar
                  name={riders[id]?.displayName}
                  avatarSrc={live.avatarSrc}
                  heartRate={live.heartRate}
                  zoneId={live.zoneId}
                  zoneColor={live.zoneColor || color}
                  size={38}
                  showGauge={false}
                  showIndicator={false}
                  opacity={isGhost ? 0.85 : undefined}
                />
              </div>
```

to:

```javascript
              <div
                className={`cg-pistons__head${isGhost ? ' is-ghost' : ''}`}
                style={{ left: `${(f * 100).toFixed(2)}%`, '--cg-piston-color': color }}
              >
                {(() => {
                  const avatar = (
                    <CircularUserAvatar
                      name={riders[id]?.displayName}
                      avatarSrc={live.avatarSrc}
                      heartRate={live.heartRate}
                      zoneId={live.zoneId}
                      zoneColor={live.zoneColor || color}
                      size={38}
                      showGauge={false}
                      showIndicator={false}
                    />
                  );
                  // Ghost riders get the canonical grayscale+tint treatment (the same
                  // .cg-ghost used by the speedometer/rankings/results), not a bare opacity.
                  return isGhost ? <span className="cg-ghost">{avatar}</span> : avatar;
                })()}
              </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/RacePistons.test.jsx
git commit -m "fix(cycle-game): apply cg-ghost treatment to piston tip avatars (F11)"
```

---

## Final verification

- [ ] **Run every touched cycle-game suite**

```bash
./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/ frontend/src/modules/Fitness/widgets/CycleGame/
```
Expected: all PASS.

- [ ] **Build the frontend**

```bash
npx vite build 2>&1 | tail -3
```
Expected: build succeeds.

- [ ] **Deploy + on-kiosk visual pass** (this host is prod — see `CLAUDE.local.md`): run a 2-rider-or-ghost race on the Firefox office screen and confirm: oval markers glide (T5), pistons + camera glide continuously (T6), the camera field sits inside a margin (T3), oval revolutions track laps when `lap_length_m > 0` (T4), ghost piston avatars are grayscale+tinted (T7), the ghost-picker card has no "Tap again to choose" label (T2), and a second-order ghost shows the real rider's face (T1).

---

## Deferred to follow-up brainstorm + plans (NOT in this plan)

These need UX or structural decisions before they can be planned with concrete code:

| ID | Item | Why deferred |
|----|------|--------------|
| F7 | Fuse oval + pistons + camera into one "race view" panel; split the lap **list** into its own panel | Largest change; reshapes `racePanels`/`raceDirector` zones + an alternation policy. Needs a layout brainstorm. |
| F8 | Gap labels (m / s behind) on pistons / camera / rankings | Data exists (`leaderGapM`, `closingRateMPS`) but placement + time-race seconds derivation are UX choices. |
| F9 | Ranking panel enrichment (inter-row gap connectors / merge with pistons) | Depends on F8 + F7 decisions. |
| F5 | Lap list auto-scroll + aggregate older laps | Aggregation form is a UX decision. |
| F13 | Subset picker for multi-rider ghost races | New modal/flow — needs design. |
| F15 | History winner-avatar + concealed-others + ghost styling | Builds on `2026-06-03-cycle-game-records-list-ux-evaluation.md`; avatar-stacking treatment is a UX choice. |
| F3 | FLIP/transform animation on ranking row reorder | Non-trivial JS animation; lower priority than the snap-fixes above. |
| F10 (part 2) | Grid pan coupled to race speed | Needs a leader-position/speed prop into `CameraZoom` + motion design. |

**Note for F7:** Tasks 4 (F4) and 5 (F1) touch `OvalTrack`/oval wiring, which the F7 redesign will move into the combined panel. Their changes (lap-driven progress, CSS-property motion) are panel-internal and carry over — but flag them when scoping F7 so the oval's progress source and motion mechanism aren't re-litigated.
