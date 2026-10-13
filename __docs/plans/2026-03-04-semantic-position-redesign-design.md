# Semantic Position Redesign

## Problem

The current SemanticPosition system in `poseSemantics.js` has several issues:

1. **Missing joints:** No hip flexion angle, no shoulder/arm elevation, no stance width — critical for distinguishing exercises.
2. **Sloppy derived booleans:** `lungePosition` only checks if one knee is bent (false positives from casual standing). `squatPosition` doesn't check hip flexion (matches sitting in a chair).
3. **Layer confusion:** Exercise-specific booleans (`squatPosition`, `lungePosition`) are mixed into the joint extraction layer.
4. **Unused properties:** `leftFoot`/`rightFoot` classifiers are never referenced by any pattern.
5. **Inconsistent torso detection:** `bodyUpright`/`bodyProne` use a crude dx-vs-dy comparison instead of actual torso angle.

## Design Decisions

- **Target exercises:** Bodyweight basics — squats, lunges, push-ups, planks, jumping jacks, burpees.
- **Precision:** Discrete states (HIGH/MID/LOW), not raw angles.
- **Architecture:** Layer 1 = joints only. Compound booleans move to Layer 1.5 combos on the same object.
- **2D only:** BlazePose z-depth is too noisy from a single camera. Stay 2D.
- **No negative combos:** Layer 2 patterns use `combo: false` with guard combos (e.g. `upright: true`) to constrain return phases. Avoids false positives from meaningless negative states.

---

## Layer 1: Joint States

All classified as `HIGH` / `MID` / `LOW` / `null` (null = insufficient confidence).

| Property | Measurement | LOW | MID | HIGH |
|----------|-------------|-----|-----|------|
| `leftHand` / `rightHand` | Wrist Y vs shoulder/hip Y | Below hip | Between shoulder & hip | Above shoulder |
| `leftElbow` / `rightElbow` | Shoulder→elbow→wrist angle | ≥150° (straight) | 80–150° (bent) | <80° (tight) |
| `leftKnee` / `rightKnee` | Hip→knee→ankle angle | ≥160° (straight) | 90–160° (bent) | <90° (deep) |
| `leftHip` / `rightHip` | Shoulder→hip→knee angle (hip flexion) | ≥160° (open/standing) | 90–160° (partial flexion) | <90° (deep flexion) |
| `leftShoulder` / `rightShoulder` | Hip→shoulder→elbow angle (arm elevation) | <45° (arm at side) | 45–135° (arm raised) | ≥135° (arm overhead) |

### Torso (discrete)

| Property | Values | Method |
|----------|--------|--------|
| `torso` | `UPRIGHT` / `LEANING` / `PRONE` / `null` | Torso angle from vertical: <30° upright, 30–60° leaning, >60° prone |

### Stance (new)

| Property | Values | Method |
|----------|--------|--------|
| `stance` | `NARROW` / `HIP` / `WIDE` / `null` | Ankle-to-ankle distance / hip-to-hip distance ratio. <0.8 narrow, 0.8–1.3 hip, >1.3 wide |

### Removed from Layer 1

- `leftFoot` / `rightFoot` — unused, ankle position is captured implicitly by knee angle + hip angle.
- `handsUp`, `bodyUpright`, `bodyProne`, `squatPosition`, `lungePosition`, `armsExtended` — move to Layer 1.5 or dropped.

---

## Layer 1.5: Multi-Joint Combo States

Boolean states derived from Layer 1 joints. Computed inside `extractSemanticPosition` alongside joint states, returned on the same object.

| Combo | Joints Used | TRUE When |
|-------|-------------|-----------|
| `upright` | torso | `torso === 'UPRIGHT'` |
| `prone` | torso | `torso === 'PRONE'` |
| `squatting` | leftHip, rightHip, leftKnee, rightKnee, torso, stance | Both hips `MID`+, both knees `MID`+, upright, stance `HIP` or `WIDE` |
| `lunging` | leftHip, rightHip, leftKnee, rightKnee, torso | One hip `MID`+/other `LOW`, matching knee asymmetry, upright |
| `armsOverhead` | leftShoulder, rightShoulder | Both shoulders `HIGH` |
| `armsAtSides` | leftShoulder, rightShoulder | Both shoulders `LOW` |
| `armsExtended` | leftElbow, rightElbow | Both elbows `LOW` (straight) |
| `wideStance` | stance | `stance === 'WIDE'` |
| `narrowStance` | stance | `stance === 'NARROW'` or `stance === 'HIP'` |

---

## Layer 2: Exercise Patterns

Patterns match against any combination of Layer 1 joints and Layer 1.5 combos. No changes to the `createActionDetector` / `createCustomActionDetector` API — only the pattern definitions change.

### Jumping Jack (cyclic)

```js
{
  id: 'jumping-jack',
  phases: [
    { name: 'open',   match: { armsOverhead: true, wideStance: true } },
    { name: 'closed', match: { armsAtSides: true, narrowStance: true, upright: true } },
  ],
  timing: { minCycleMs: 400, maxCycleMs: 3000, maxPhaseMs: 2000 },
}
```

### Squat (cyclic)

```js
{
  id: 'squat',
  phases: [
    { name: 'down', match: { squatting: true } },
    { name: 'up',   match: { squatting: false, upright: true, narrowStance: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
}
```

### Lunge (cyclic)

```js
{
  id: 'lunge',
  phases: [
    { name: 'down', match: { lunging: true } },
    { name: 'up',   match: { lunging: false, upright: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
}
```

### Push-up (cyclic)

```js
{
  id: 'push-up',
  phases: [
    { name: 'down', match: { prone: true, leftElbow: 'MID' } },
    { name: 'up',   match: { prone: true, armsExtended: true } },
  ],
  timing: { minCycleMs: 500, maxCycleMs: 4000 },
}
```

### Plank (sustain)

```js
{
  id: 'plank',
  sustain: { prone: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
}
```

### Burpee (custom)

Custom detector that tracks a state machine: `upright` → `squatting` → `prone` → `squatting` → `upright` + `armsOverhead`.

---

## Hysteresis

The existing hysteresis wrapper (`createSemanticExtractor`) applies to Layer 1 joint states. Layer 1.5 combos are recomputed from stabilized joints, inheriting stability.

New properties need hysteresis config:

| Property | minHoldMs |
|----------|-----------|
| `leftHip` / `rightHip` | 120ms |
| `leftShoulder` / `rightShoulder` | 80ms |
| `torso` | 150ms |
| `stance` | 100ms |

---

## Codebase Changes

1. **`poseSemantics.js`** — Rewrite `extractSemanticPosition`: add `classifyHip`, `classifyShoulder`, `classifyTorso`, `classifyStance`. Remove old derived booleans. Add Layer 1.5 combo derivations.
2. **`poseActions.js`** — No structural changes. Update example patterns in JSDoc.
3. **`SemanticMoveDetector.js`** — No changes (pattern-agnostic).
4. **Hysteresis config** — Add entries for `leftHip`, `rightHip`, `leftShoulder`, `rightShoulder`, `torso`, `stance`.
5. **Tests** — Update to new property names and new pattern definitions.
6. **`semantic-pose-pipeline.md`** — Update reference doc to match new design.

---

## Output Shape Example

```js
extractSemanticPosition(keypoints)
// → {
//   // Layer 1: Joint states
//   leftHand: 'LOW', rightHand: 'HIGH',
//   leftElbow: 'LOW', rightElbow: 'MID',
//   leftKnee: 'LOW', rightKnee: 'LOW',
//   leftHip: 'LOW', rightHip: 'LOW',
//   leftShoulder: 'LOW', rightShoulder: 'HIGH',
//   torso: 'UPRIGHT',
//   stance: 'HIP',
//
//   // Layer 1.5: Combo states
//   upright: true,
//   prone: false,
//   squatting: false,
//   lunging: false,
//   armsOverhead: false,
//   armsAtSides: false,
//   armsExtended: true,
//   wideStance: false,
//   narrowStance: true,
// }
```
