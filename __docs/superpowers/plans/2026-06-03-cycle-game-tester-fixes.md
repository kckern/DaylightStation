# CycleGame Tester-Round Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six issues surfaced in the first CycleGame tester round — record-rail density, the add-rider hit target, per-equipment RPM caps, countdown layout overlap, the distance-race winner display, and a forfeit/end-race lifecycle.

**Architecture:** All changes live in `frontend/src/modules/Fitness/`. Pure-logic changes (RPM limits, the end-race lifecycle) get a TDD'd helper/controller method; presentational changes (SCSS, roster row, hit target) get a colocated component test where behavior is observable, or are verified live where they are pure CSS. One per-equipment config edit lands in the container's data volume (not version-controlled).

**Tech Stack:** React (JSX), SCSS (Sass modules via `@use 'cgTokens'`), Vitest + @testing-library/react. Run a single test file with:
`./node_modules/.bin/vitest run --config vitest.config.mjs <path>`

**Conventions already in this codebase (do not reinvent):**
- Structured logging only (`getLogger().child({component})`), never raw console.
- The race interval (`phase === 'racing'` effect) depends ONLY on `phase`; anything it reads that changes identity per render must come from a ref (see `sessionRef`, `zonesRef`), or it tears down and starves ticks.
- Ghost rider ids look like `ghost:<raceId>:<sourceId>`; ghosts have `equipmentId: null`.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` | Records rail density | 1 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx` | Whole-slot add-rider hit target | 2 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx` | Hit-target test | 2 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.scss` | Countdown stoplight layout | 3 |
| `frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.js` (new) | Per-equipment RPM limits (gauge max + abuse clamp) | 4 |
| `frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.test.js` (new) | Limits unit tests | 4 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` | Wire RPM limits; finish-race button + handler | 4, 6 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` | Per-rider gauge max; roster finish time + medal | 4, 5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx` | Gauge-max + roster tests | 4, 5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss` | Roster finished-row styling | 5 |
| `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js` | `finishNow()` forfeit method | 6 |
| `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js` | `finishNow()` tests | 6 |
| `data/household/config/fitness.yml` (container data volume, NOT git) | tricycle/ab_roller RPM config | 4 |

---

## Task 1: Compact the records rail (start here)

Pure CSS. The rail rows carry ~18px vertical padding plus the 40px avatar; testers found too much empty vertical space. Tighten the row padding and the button padding so rows pack closer. No behavior change → verified live, not unit-tested.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (`.cgh-record`, `.cgh-record__btn`)

- [ ] **Step 1: Tighten the record row padding**

Find this block:

```scss
.cgh-record {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid t.$cg-border-soft;
```

Change `padding: 9px 0;` to `padding: 3px 0;`.

- [ ] **Step 2: Tighten the record button padding**

Find this block:

```scss
.cgh-record__btn {
  appearance: none; cursor: pointer; width: 100%;
  display: flex; align-items: center; justify-content: flex-start; gap: 14px;
  background: transparent; border: none; color: inherit; padding: 4px; border-radius: 8px;
  &:hover { background: rgba(255, 255, 255, 0.05); }
}
```

Change `padding: 4px;` to `padding: 2px 4px;`.

- [ ] **Step 3: Run the home suite to confirm nothing breaks**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`
Expected: PASS (CSS-only change; tests assert structure, not pixels).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss
git commit -m "fix(cycle-game): compact the records rail (less vertical dead space)"
```

---

## Task 2: Make the whole bike slot the add-rider hit target

Today `BikeSlot` wraps only the equipment icon (`.cgh-slot__main`, 96×96) in the click button; the `+ Add rider` hint and the rest of the tile are dead. Restructure so a single full-bleed button covers the whole slot.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx` (`BikeSlot`, ~lines 382–428)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (`.cgh-slot__main` → full-bleed)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('CycleGameHome', ...)` block in `CycleGameHome.test.jsx` (place it right after the existing `'opens the rider picker and assigns a rider on-screen'` test):

```jsx
it('opens the rider picker when the add-rider hint (anywhere in the slot) is clicked', () => {
  const { getByTestId, queryByTestId } = render(
    <CycleGameHome bikes={bikes} people={people} records={[]} />
  );
  expect(queryByTestId('rider-picker')).toBeNull();
  // Click the "+ Add rider" hint specifically — the whole slot must be the target.
  const addHint = getByTestId('bike-tricycle').querySelector('.cgh-slot__add');
  expect(addHint).toBeTruthy();
  fireEvent.click(addHint);
  expect(getByTestId('rider-picker')).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "add-rider hint"`
Expected: FAIL — clicking `.cgh-slot__add` does nothing because it's outside the button (picker never opens).

- [ ] **Step 3: Restructure BikeSlot so the whole slot is one button**

In `CycleGameHome.jsx`, replace the entire `BikeSlot` return (the `return ( ... )` from `<div className={\`cgh-slot...\`}` through its closing `</div>`) with:

```jsx
  return (
    <div className={`cgh-slot${filled ? ' is-filled' : ''}`} data-testid={`bike-${bike.id}`}>
      <span className="cgh-slot__lane" aria-hidden="true">{lane}</span>
      <button
        type="button"
        className="cgh-slot__main"
        onClick={() => onPick?.(bike)}
        aria-label={filled ? `Change rider for ${bike.name}` : `Assign rider to ${bike.name}`}
      >
        <span className="cgh-slot__device-wrap">
          <RpmDeviceAvatar
            className="cgh-slot__device"
            avatarSrc={bike.iconSrc}
            avatarAlt={bike.name}
            fallbackSrc={EQUIPMENT_FALLBACK}
            rpm={rpm}
            animationDuration={spinDuration}
            showValue
            renderValue={(v, isZero) => (isZero ? '' : v)}
            hideSpinnerWhenZero
          />
          {filled && (
            <span className="cgh-slot__rider-avatar">
              <CircularUserAvatar
                name={person.name}
                avatarSrc={person.avatarSrc}
                fallbackSrc={FALLBACK_AVATAR}
                heartRate={Number.isFinite(person.heartRate) ? person.heartRate : undefined}
                zoneId={person.zoneId || undefined}
                zoneColor={person.zoneColor || undefined}
                progress={Number.isFinite(person.progress) ? person.progress : undefined}
                size={48}
                showGauge={person.hasHR}
                showIndicator={false}
              />
            </span>
          )}
        </span>
        {!filled && (
          <span className="cgh-slot__add" aria-hidden="true">+ Add rider</span>
        )}
      </button>
    </div>
  );
```

The key change: the `+ Add rider` hint and the device now live INSIDE the single `.cgh-slot__main` button, and a `.cgh-slot__device-wrap` keeps the rider avatar positioned relative to the device (it used to be positioned relative to the button).

- [ ] **Step 4: Update the SCSS so the button fills the slot and the device wrap anchors the avatar**

In `CycleGameHome.scss`, find:

```scss
  &__main {
    appearance: none;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    position: relative;
    width: 96px;
    height: 96px;
  }
```

Replace it with:

```scss
  &__main {
    appearance: none;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  // The device + overlaid rider avatar; the avatar positions against this wrap
  // (was the button before the hit target was expanded to the whole slot).
  &__device-wrap {
    position: relative;
    width: 96px;
    height: 96px;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`
Expected: PASS — including the existing tests that click `.cgh-slot__main` and the new add-hint test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "fix(cycle-game): entire bike slot is the add-rider hit target"
```

---

## Task 3: Stop the countdown stoplight overlapping the rider strip

The `.countdown-stoplight` overlay is `inset: 0` with `justify-content: center`, so its 240px stage sits dead-center and collides with `.cycle-game-countdown-riders` (anchored `bottom: 28px`). Lift the centered stoplight group with bottom padding and raise the strip slightly. Pure CSS.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.scss` (`.countdown-stoplight`)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.scss` (`.cycle-game-countdown-riders`)

- [ ] **Step 1: Lift the stoplight content above the bottom strip**

In `CountdownStoplight.scss`, find:

```scss
.countdown-stoplight {
  position: absolute; inset: 0; z-index: 50;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 28px;
  @include cg.cg-backdrop;
  background-color: rgba(6, 7, 10, 0.86);
```

Change `justify-content: center;` so the line reads:

```scss
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 28px;
  // Reserve room at the bottom for the on-board rider strip so the centered
  // stoplight group lifts clear of it (it used to overlap the avatars).
  padding-bottom: 220px;
```

(Keep `justify-content: center;` — the `padding-bottom` shifts the centered group up.)

- [ ] **Step 2: Raise the rider strip a touch**

In `CycleGameContainer.scss`, find:

```scss
.cycle-game-countdown-riders {
  position: absolute;
  left: 0; right: 0; bottom: 28px;
  z-index: 51;
```

Change `bottom: 28px;` to `bottom: 48px;`.

- [ ] **Step 3: Run the container + stoplight suites to confirm nothing breaks**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx`
Expected: PASS (CSS-only).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.scss
git commit -m "fix(cycle-game): lift countdown stoplight clear of the rider strip"
```

---

## Task 4: Per-equipment RPM — gauge max + ab-roller abuse cap

Two problems, one root: the speedometer never receives a `maxRpm`, so it uses the 120 default and the needle "flattens" when a rider exceeds 120. And there is no cap on hand-spinnable equipment. Introduce per-equipment limits: `max_rpm` drives the gauge scale (never clamps the value), and a new optional `abuse_max_rpm` clamps the RPM that counts toward distance (set only for the ab roller; a real bike's cadence is always legitimate).

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
- Modify (data volume, NOT git): `data/household/config/fitness.yml`

- [ ] **Step 1: Write the failing helper test**

Create `frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { resolveRpmLimits, clampCountedRpm } from './equipmentRpm.js';

describe('resolveRpmLimits', () => {
  it('uses the equipment max_rpm as the gauge scale', () => {
    expect(resolveRpmLimits({ max_rpm: 250 }).gaugeMaxRpm).toBe(250);
  });
  it('defaults the gauge to 120 when max_rpm is absent or invalid', () => {
    expect(resolveRpmLimits({}).gaugeMaxRpm).toBe(120);
    expect(resolveRpmLimits({ max_rpm: 0 }).gaugeMaxRpm).toBe(120);
  });
  it('reports an abuse cap only when abuse_max_rpm is set (else null = uncapped)', () => {
    expect(resolveRpmLimits({ abuse_max_rpm: 120 }).abuseMaxRpm).toBe(120);
    expect(resolveRpmLimits({ max_rpm: 250 }).abuseMaxRpm).toBeNull();
  });
});

describe('clampCountedRpm', () => {
  it('caps the counted RPM when an abuse cap is set', () => {
    expect(clampCountedRpm(300, 120)).toBe(120);
  });
  it('passes RPM through untouched when uncapped (null)', () => {
    expect(clampCountedRpm(300, null)).toBe(300);
  });
  it('coerces non-finite RPM to 0', () => {
    expect(clampCountedRpm(undefined, null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.js`:

```js
// Per-equipment RPM limits for the cycle game.
//  - gaugeMaxRpm: speedometer dial scale (DISPLAY only — never clamps the value).
//  - abuseMaxRpm: optional clamp on the RPM that COUNTS toward distance, for
//    equipment that can be cheated by hand-spinning (e.g. the ab roller). null =
//    uncapped — a real bike's cadence is always legitimate, so it never clamps.
const DEFAULT_GAUGE_MAX_RPM = 120;

export function resolveRpmLimits(equipment = {}) {
  const gaugeMaxRpm = Number.isFinite(equipment?.max_rpm) && equipment.max_rpm > 0
    ? equipment.max_rpm
    : DEFAULT_GAUGE_MAX_RPM;
  const abuseMaxRpm = Number.isFinite(equipment?.abuse_max_rpm) && equipment.abuse_max_rpm > 0
    ? equipment.abuse_max_rpm
    : null;
  return { gaugeMaxRpm, abuseMaxRpm };
}

export function clampCountedRpm(rpm, abuseMaxRpm) {
  const v = Number.isFinite(rpm) ? rpm : 0;
  if (Number.isFinite(abuseMaxRpm) && abuseMaxRpm > 0) return Math.min(v, abuseMaxRpm);
  return v;
}

export default { resolveRpmLimits, clampCountedRpm };
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.test.js`
Expected: PASS (9 assertions).

- [ ] **Step 5: Wire the limits into the container — import + a bike lookup**

In `CycleGameContainer.jsx`, add the import next to the other `lib/cycleGame` imports (after the `participantIdentity` import):

```jsx
import { resolveRpmLimits, clampCountedRpm } from '@/modules/Fitness/lib/cycleGame/equipmentRpm.js';
```

Find the `bikes` memo:

```jsx
  const bikes = useMemo(
    () => (Array.isArray(equipment) ? equipment : []).filter((e) => e && e.cadence != null),
    [equipment]
  );
```

Immediately after it, add a by-id lookup plus a ref the race interval can read without re-subscribing:

```jsx
  const bikeById = useMemo(() => new Map(bikes.map((b) => [b.id, b])), [bikes]);
  const bikeByIdRef = useRef(bikeById);
  useEffect(() => { bikeByIdRef.current = bikeById; }, [bikeById]);
```

- [ ] **Step 6: Clamp counted RPM in the race tick (ab-roller abuse cap)**

In `CycleGameContainer.jsx`, find the inputs loop in the race interval:

```jsx
      Object.keys(before.engineState?.riders || {}).forEach((userId) => {
        const rider = before.engineState.riders[userId];
        const cadence = liveSession?.getEquipmentCadence?.(rider.equipmentId);
        const connected = !!(cadence && cadence.connected);
        if (rider.equipmentId) cadenceConnected[userId] = connected; // ghosts have no equipment
        const vitals = liveGetUserVitals?.(userId);
        inputs[userId] = {
          rpm: connected ? cadence.rpm : 0,
          zoneId: vitals?.zoneId || null,
          heartRate: Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null
        };
      });
```

Replace the `inputs[userId] = { ... }` assignment so the counted RPM is clamped per equipment:

```jsx
      Object.keys(before.engineState?.riders || {}).forEach((userId) => {
        const rider = before.engineState.riders[userId];
        const cadence = liveSession?.getEquipmentCadence?.(rider.equipmentId);
        const connected = !!(cadence && cadence.connected);
        if (rider.equipmentId) cadenceConnected[userId] = connected; // ghosts have no equipment
        const vitals = liveGetUserVitals?.(userId);
        const { abuseMaxRpm } = resolveRpmLimits(bikeByIdRef.current.get(rider.equipmentId) || {});
        inputs[userId] = {
          rpm: clampCountedRpm(connected ? cadence.rpm : 0, abuseMaxRpm),
          zoneId: vitals?.zoneId || null,
          heartRate: Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null
        };
      });
```

- [ ] **Step 7: Attach the per-rider gauge max to riderLive**

In `CycleGameContainer.jsx`, find the racing-phase `riderLive[userId] = { ... }` object (the one with `multiplier`, `finished`, `placement`, `penalized`, ...). Add a `maxRpm` field. Insert it right after the `placement:` line:

```jsx
        placement: isFinished ? (placementByUser[userId] ?? null) : null,
        maxRpm: resolveRpmLimits(bikeById.get(rider.equipmentId) || {}).gaugeMaxRpm,
```

(`bikeById` — not the ref — is in scope in the render path.)

- [ ] **Step 8: Pass the gauge max from CycleRaceScreen to the speedometer (failing test first)**

Add this test to `CycleRaceScreen.test.jsx` inside the existing `describe(...)` block:

```jsx
it('scales each speedometer to the rider\'s per-equipment max RPM', () => {
  const riders = { a: { userId: 'a', displayName: 'A', distanceSeries: [0], cumulativeDistanceM: 0, finishTimeS: null, isGhost: false } };
  const { getByText } = render(
    <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={1}
      riders={riders} riderLive={{ a: { rpm: 0, maxRpm: 250 } }} />
  );
  // A 250-max gauge labels ticks every 30 RPM → "240" appears; the 120 default never reaches it.
  expect(getByText('240')).toBeTruthy();
});
```

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx -t "per-equipment max RPM"`
Expected: FAIL — gauge uses the 120 default, no "240" tick label.

- [ ] **Step 9: Pass `maxRpm` through in CycleRaceScreen**

In `CycleRaceScreen.jsx`, find the `<CycleSpeedometer` element in the `showSpeedos` block and add the `maxRpm` prop right after `rpm={live.rpm}`:

```jsx
              <CycleSpeedometer
                key={id}
                rpm={live.rpm}
                maxRpm={live.maxRpm}
                cadenceBands={cadenceBands}
```

`CycleSpeedometer` already defaults `maxRpm = 120` when the prop is undefined, so recap/other callers are unaffected.

- [ ] **Step 10: Run the screen suite to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Expected: PASS.

- [ ] **Step 11: Update the equipment config (container data volume — one-time runtime edit, not git)**

This file lives in the container's data volume, not the repo. Edit via a temp copy + `cp` (never `sed -i` on the YAML in place). Run:

```bash
sudo docker exec daylight-station sh -c '
sed -e "402s/max_rpm: 150/max_rpm: 250/" data/household/config/fitness.yml > /tmp/fitness.yml
echo "=== tricycle (expect max_rpm: 250) ==="; sed -n "400,409p" /tmp/fitness.yml
'
```

Confirm line 402 is the `tricycle` `max_rpm` (the block starting `id: tricycle` at ~401). If correct, write it back and give the ab roller a gauge max + abuse cap:

```bash
sudo docker exec daylight-station sh -c '
cp /tmp/fitness.yml data/household/config/fitness.yml
# Ab roller: add a gauge max + abuse cap directly under its id line (it has neither).
sed -e "/^    id: ab_roller$/a\\    max_rpm: 120\\n    abuse_max_rpm: 120" data/household/config/fitness.yml > /tmp/fitness2.yml
echo "=== ab_roller block ==="; sed -n "/id: ab_roller/,/cadence/p" /tmp/fitness2.yml
'
```

Inspect the ab_roller block (it must show `max_rpm: 120` and `abuse_max_rpm: 120` with 4-space indent, no structure mangled). If correct:

```bash
sudo docker exec daylight-station sh -c 'cp /tmp/fitness2.yml data/household/config/fitness.yml && grep -nE "id: (tricycle|ab_roller)|max_rpm|abuse_max_rpm" data/household/config/fitness.yml | head'
```

Expected: tricycle `max_rpm: 250`; ab_roller `max_rpm: 120` + `abuse_max_rpm: 120`.

- [ ] **Step 12: Commit (code only — config is runtime data, not version-controlled)**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.js frontend/src/modules/Fitness/lib/cycleGame/equipmentRpm.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx
git commit -m "feat(cycle-game): per-equipment RPM — gauge scale + ab-roller abuse cap"
```

---

## Task 5: Distance-race roster — show finish time + medal for finishers

When a rider crosses the line in a distance race, the roster keeps showing their distance with no finish time and no placement marker. Surface a medal + finish time, and float finishers to the top of the roster in finish order.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` (roster build ~168–180, roster row ~328–349)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss` (`.cycle-race-screen__roster-*`)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `CycleRaceScreen.test.jsx`:

```jsx
it('shows a medal + finish time on the roster for a finished distance-race rider', () => {
  const riders = {
    a: { userId: 'a', displayName: 'Ann', distanceSeries: [1000], cumulativeDistanceM: 1000, finishTimeS: 252, isGhost: false },
    b: { userId: 'b', displayName: 'Bo', distanceSeries: [600], cumulativeDistanceM: 600, finishTimeS: null, isGhost: false }
  };
  const { getByTestId } = render(
    <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={260}
      riders={riders} riderLive={{ a: {}, b: {} }} />
  );
  const roster = getByTestId('race-roster');
  // Finisher Ann shows 1st-place medal + her 4:12 finish time; she's the top row.
  const rows = roster.querySelectorAll('.cycle-race-screen__roster-row');
  expect(rows[0].textContent).toContain('🥇');
  expect(rows[0].textContent).toContain('4:12');
  // Still-racing Bo shows distance, no medal.
  expect(rows[1].textContent).toContain('600');
  expect(rows[1].textContent).not.toContain('🥇');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx -t "medal + finish time"`
Expected: FAIL — roster shows distance only, no medal/time.

- [ ] **Step 3: Add a finish-time formatter + medals constant**

In `CycleRaceScreen.jsx`, near the top of the module (after the imports, before the component), add:

```jsx
const ROSTER_MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const fmtRosterTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
```

- [ ] **Step 4: Carry finish data into the roster + sort finishers first**

In `CycleRaceScreen.jsx`, replace the roster build:

```jsx
  // Roster panel (right of the chart): riders sorted by who's ahead.
  const roster = [...riderIds]
    .sort((a, b) => (riders[b].cumulativeDistanceM || 0) - (riders[a].cumulativeDistanceM || 0))
    .map((id) => {
      const origIdx = riderIds.indexOf(id);
      return {
        id,
        displayName: riders[id].displayName || id,
        distanceM: riders[id].cumulativeDistanceM || 0,
        isGhost: !!riders[id].isGhost,
        color: LINE_COLORS[origIdx % LINE_COLORS.length],
        live: riderLive[id] || {}
      };
    });
```

with:

```jsx
  // Roster panel (right of the chart): finishers float to the top in finish order
  // (earliest time first); everyone else follows by distance. Finishers carry a
  // placement so the row can show their medal + finish time.
  const isDistanceRace = winCondition === 'distance';
  const roster = [...riderIds]
    .sort((a, b) => {
      const fa = riders[a].finishTimeS, fb = riders[b].finishTimeS;
      const aDone = isDistanceRace && fa != null, bDone = isDistanceRace && fb != null;
      if (aDone && bDone) return fa - fb;
      if (aDone) return -1;
      if (bDone) return 1;
      return (riders[b].cumulativeDistanceM || 0) - (riders[a].cumulativeDistanceM || 0);
    })
    .map((id, i) => {
      const origIdx = riderIds.indexOf(id);
      const finishTimeS = isDistanceRace ? riders[id].finishTimeS : null;
      return {
        id,
        displayName: riders[id].displayName || id,
        distanceM: riders[id].cumulativeDistanceM || 0,
        finished: finishTimeS != null,
        finishTimeS,
        placement: finishTimeS != null ? i + 1 : null,
        isGhost: !!riders[id].isGhost,
        color: LINE_COLORS[origIdx % LINE_COLORS.length],
        live: riderLive[id] || {}
      };
    });
```

- [ ] **Step 5: Render the medal + finish time in the roster row**

In `CycleRaceScreen.jsx`, replace the roster row's rank span and metric span. Find:

```jsx
          <div key={`roster-${r.id}`} className={`cycle-race-screen__roster-row${r.isGhost ? ' is-ghost' : ''}`}>
            <span className="cycle-race-screen__roster-rank">{i + 1}</span>
```

replace with:

```jsx
          <div key={`roster-${r.id}`} className={`cycle-race-screen__roster-row${r.isGhost ? ' is-ghost' : ''}${r.finished ? ' is-finished' : ''}`}>
            <span className="cycle-race-screen__roster-rank">
              {r.finished ? (ROSTER_MEDALS[r.placement] || r.placement) : i + 1}
            </span>
```

Then find the metric span:

```jsx
              <span className="cycle-race-screen__roster-metric" style={{ color: r.color }}>{formatDistance(r.distanceM)}</span>
```

replace with:

```jsx
              <span className="cycle-race-screen__roster-metric" style={{ color: r.color }}>
                {r.finished ? `🏁 ${fmtRosterTime(r.finishTimeS)}` : formatDistance(r.distanceM)}
              </span>
```

- [ ] **Step 6: Style the finished row**

In `CycleRaceScreen.scss`, find the `&__roster-metric` rule:

```scss
  &__roster-metric { font-family: cg.$cg-mono; font-weight: 700; font-size: 0.95rem; color: cg.$cg-text; }
```

Add directly after it:

```scss
  &__roster-row.is-finished { background: rgba(255, 213, 74, 0.08); border-radius: 8px; }
  &__roster-row.is-finished &__roster-metric { color: cg.$cg-gold; }
```

- [ ] **Step 7: Run the screen suite to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx
git commit -m "feat(cycle-game): roster shows medal + finish time for distance-race finishers"
```

---

## Task 6: End-race / forfeit lifecycle (without cancel-and-delete)

After the leader finishes, stragglers may quit. Cancel throws the whole race away. Add a `finishNow()` controller method that marks every non-ghost, non-finished rider as a forfeit (DNF) and ends the race, then a "Finish race" button during racing that finalizes results so they save normally.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`

- [ ] **Step 1: Write the failing controller test**

Add to `CycleRaceController.test.js` (a new `describe` block at the end of the file):

```js
describe('CycleRaceController — finishNow (forfeit)', () => {
  it('marks unfinished non-ghost riders as DNF and ends the race; finishers + ghosts untouched', () => {
    const c = new CycleRaceController(distConfig({
      startCountdownS: 0, goalM: 21,
      riders: [
        { userId: 'a', wheelCircumferenceM: 2.1 },
        { userId: 'b', wheelCircumferenceM: 2.1 },
        { userId: 'g', ghostSeries: [2000], ghostIntervalS: 1 }
      ]
    }));
    c.startCountdown();
    // One tick: 'a' crosses the 21m line (finishes); 'b' barely moves; ghost replays.
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 1 } });
    const s = c.finishNow();
    expect(s.phase).toBe('finished');
    expect(s.dnf).toContain('b');     // unfinished real rider → forfeit
    expect(s.dnf).not.toContain('a'); // already finished → not a forfeit
    expect(s.dnf).not.toContain('g'); // ghost → never forfeits
  });

  it('is a no-op when not racing', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 3 }));
    expect(c.finishNow().phase).toBe('staged');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js -t "finishNow"`
Expected: FAIL — `c.finishNow is not a function`.

- [ ] **Step 3: Implement `finishNow()`**

In `CycleRaceController.js`, add this method right after the `tick(inputs)` method (before `_isFinished()`):

```js
  // Operator-driven end: mark every non-ghost rider who hasn't crossed the line
  // as a forfeit (DNF) and end the race. Distinct from cancel() — the race is
  // finalized and saved, not discarded. No-op outside the racing phase.
  finishNow() {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const s = this.engine.getState();
    Object.values(s.riders).forEach((r) => {
      if (this.ghosts.has(r.userId)) return;
      if (r.finishTimeS == null) this.dnf.add(r.userId);
    });
    this.phase = 'finished';
    return this.getState();
  }
```

- [ ] **Step 4: Run the controller test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js`
Expected: PASS.

- [ ] **Step 5: Add the container handler**

In `CycleGameContainer.jsx`, find the `onCancel` handler:

```jsx
  const onCancel = useCallback(() => {
```

Add this handler immediately before it:

```jsx
  // Operator-driven finish: forfeit any unfinished riders, finalize standings,
  // and roll to results so the race saves (unlike cancel, which discards it).
  const onFinishRace = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    log.info('cycle_game.finish_forced', {
      raceId: raceMetaRef.current?.raceId,
      elapsedS: controller.getState()?.engineState?.elapsedS ?? null
    });
    controller.finishNow();
    applySnapshot(controller.showResults());
  }, [applySnapshot, log]);
```

- [ ] **Step 6: Render the "Finish race" button during racing**

In `CycleGameContainer.jsx`, find the racing-phase return — its cancel button:

```jsx
        <CycleEventToast toast={eventToast} onDone={onEventToastDone} />
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
```

Add a Finish button right before the Cancel button:

```jsx
        <CycleEventToast toast={eventToast} onDone={onEventToastDone} />
        <button type="button" data-testid="cycle-game-finish" className="cycle-game-container__finish" onClick={onFinishRace}>
          Finish race
        </button>
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
```

- [ ] **Step 7: Style the Finish button**

In `CycleGameContainer.scss`, find the `.cycle-game-container__cancel` rule and add a sibling immediately after it that inherits its box but reads as the positive/primary action. Add:

```scss
.cycle-game-container__finish {
  position: absolute; top: 16px; right: 132px; z-index: 60;
  appearance: none; cursor: pointer;
  padding: 8px 16px; border-radius: 999px;
  font-family: cg.$cg-display; font-weight: 800; letter-spacing: 0.04em;
  color: cg.$cg-bg; background: cg.$cg-lane-1; border: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  &:hover { filter: brightness(1.08); }
}
```

(If `.cycle-game-container__cancel` is positioned differently, match its `top`/`right` family and offset this one leftward so they don't overlap — read the cancel rule first and mirror it.)

- [ ] **Step 8: Run the container + controller suites**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.scss
git commit -m "feat(cycle-game): Finish-race control forfeits stragglers without discarding the race"
```

---

## Final verification

- [ ] **Run the full CycleGame + Fitness suites**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/`
Expected: PASS (all files green; new tests added in Tasks 2, 4, 5, 6).

- [ ] **Deploy + tester smoke (operator):** rebuild the image and `deploy-daylight` (per CLAUDE.local.md, deploy-at-will on this host), then sanity-check each fix live: record-rail density, tapping anywhere on a slot opens the picker, the stoplight clears the rider strip, the tricycle gauge reaches past 120, a distance finisher shows medal+time, and "Finish race" ends a race with stragglers marked DNF and still saves.
