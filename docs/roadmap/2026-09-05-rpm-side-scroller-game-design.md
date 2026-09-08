# RPM Side-Scroller Fitness Game

**Status:** Proposed; product direction established, implementation details still to validate  
**Created:** 2026-09-05  
**Owners:** Fitness, shared game platform  
**Decision:** Build an authored side-scrolling fitness game in which equipment cadence selects target screen altitude. Extract only genuinely reusable simulation and game-lifecycle concepts from the Piano side-scroller; keep sensor interpretation, course rules, and presentation replaceable through explicit policies and YAML configuration.

---

## 1. Summary

The RPM side-scroller is a replayable fitness game controlled by a bicycle or other cadence-producing equipment. The player travels automatically through an authored course. Low RPM selects a low target altitude and high RPM selects a high target altitude. The craft eases toward that target rather than tracking sensor values instantaneously, so the rider must anticipate mountains, cave ceilings, tunnels, buildings, and branching passages.

Themes are interchangeable. A course may present the player as a hang glider, helicopter, spaceship, bird, swimmer, or another suitable character without changing its control model. Theme definitions select sprites, tiles, backgrounds, effects, and sounds; they do not implement physics or scoring.

Courses are recognizable and learnable rather than primarily random. They are described in YAML using a constrained vocabulary of course segments and reusable assets. Obstacles must be visible early enough for a rider to respond through a slow physical input.

Heart-rate zones continue to award the Fitness system's existing rings. The game may additionally use heart-rate state to apply individual or group assists, but the first implementation must expose this as a configurable policy rather than hard-code one final effect.

---

## 2. Product Contract

### 2.1 Core loop

```text
read the course ahead
    -> choose a suitable cadence
    -> cadence selects target altitude
    -> flight physics approaches target altitude
    -> clear terrain, passages, and collectibles
    -> reach checkpoints and finish the authored level
    -> earn normal HR-zone rings plus configured completion bonuses
```

The primary skill is anticipation and cadence control. It is not rapid button timing. The player should learn a course over repeated attempts and improve at reaching the right altitude early and holding a useful cadence.

### 2.2 Control promise

- Lower RPM means lower target altitude.
- Higher RPM means higher target altitude.
- RPM at or above the configured maximum caps the target at the top of the playable range; it does not produce extra altitude.
- RPM below the configured minimum progressively loses lift.
- Zero RPM or lost cadence does not teleport the player downward. The craft coasts briefly, then descends according to the motion policy.
- Sensor noise is smoothed before it affects target altitude.
- The same relationship remains legible when a course changes its fictional elevation or camera baseline.

The default mapping is linear within the configured cadence range:

```text
normalized_rpm = clamp((smoothed_rpm - low_rpm) / (high_rpm - low_rpm), 0, 1)
target_screen_altitude = lerp(low_altitude, high_altitude, normalized_rpm)
```

The mapping function is a policy. Future courses may select a tested curve, but arbitrary course-authored functions are out of scope.

### 2.3 Three altitude concepts

The engine must not collapse these values into one coordinate:

| Value | Meaning |
|---|---|
| Course elevation | Large-scale fictional climb or descent through the level. |
| Screen altitude | The player's current normalized vertical position in the viewport. |
| Target altitude | The screen position requested by the current smoothed RPM. |

Course elevation and camera transforms may change between segments—for example, climbing a mountain and then entering a cave—without reversing or redefining the basic low-RPM/low-screen, high-RPM/high-screen control promise.

---

## 3. Configuration Ownership

### 3.1 Cadence calibration

Cadence calibration belongs primarily to the physical equipment because equipment geometry and sensor installation affect its useful range. A rider may have an optional override for a particular piece of equipment.

Resolution order:

```text
rider + equipment override
    -> equipment game calibration
    -> game default
```

An illustrative extension to the existing Fitness equipment catalog is:

```yaml
equipment:
  - id: bike_001
    name: Exercise Bike
    type: bike
    cadence_device: "54321"
    game_calibration:
      rpm_altitude:
        low_rpm: 40
        high_rpm: 100

users:
  primary:
    - id: rider_1
      equipment_overrides:
        bike_001:
          rpm_altitude:
            low_rpm: 45
            high_rpm: 105
```

This schema is directional, not yet normative. It must be reconciled with the canonical Fitness configuration parser before implementation. Invalid ranges must fail validation rather than silently creating an inverted or zero-width control range.

### 3.2 Course definition

Courses should be declarative and finite:

```yaml
id: mountain-pass
title: Mountain Pass
theme: alpine-glider

motion:
  profile: forgiving-flight
  response_seconds: 1.5
  coast_seconds: 1.0
  descent_rate: 0.08
  max_climb_rate: 0.30
  max_descent_rate: 0.22

rules:
  lives: 3
  collision_policy: bounce-and-damage
  checkpoint_policy: group-restart
  failed_rider_policy: ghost
  ghost_revival:
    policy: checkpoint
    lives_restored: 3
  completion_ring_bonus: 20

heart_rate_effect:
  policy: none

segments:
  - at: 0
    type: open
    background: alpine-morning
  - at: 18
    type: lower-obstacle
    top: 0.48
    skin: snow-peak
  - at: 42
    type: corridor
    ceiling: 0.25
    floor: 0.72
    skin: ice-cave
  - at: 66
    type: split-corridor
    upper: { ceiling: 0.10, floor: 0.36 }
    lower: { ceiling: 0.57, floor: 0.84 }
  - at: 90
    type: checkpoint
  - at: 180
    type: finish
    skin: sky-portal
```

The eventual schema should use author-friendly units and be validated for playability. The example's coordinates and names demonstrate intent only.

### 3.3 Theme definition

A theme maps semantic roles to presentation assets:

```yaml
id: alpine-glider
player:
  sprite: glider-blue
  ghost_sprite: glider-blue-ghost
terrain:
  snow-peak: assets/terrain/snow-peak.png
  ice-cave: assets/terrain/ice-cave.png
backgrounds:
  alpine-morning: assets/backgrounds/alpine-morning.png
effects:
  collision: snow-burst
sounds:
  checkpoint: checkpoint-chime
  collision: soft-impact
```

The asset resolver, animation metadata, and fallback procedural rendering can build on the Piano side-scroller's theme work, but themes must not depend on Piano concepts such as staffs, notes, jump, or duck.

---

## 4. Motion and Sensor Semantics

### 4.1 Input pipeline

```text
FitnessSession.getEquipmentCadence(equipmentId)
    -> freshness and connection classification
    -> cadence smoothing and deadband
    -> calibration resolution
    -> RPM-to-altitude policy
    -> desired altitude
    -> rate-limited flight integrator
    -> player screen altitude
```

The engine consumes an input snapshot; it must not read Fitness context or sensor devices directly. A snapshot should contain at least equipment identity, raw RPM, smoothed RPM, sample timestamp, and connection/freshness state.

### 4.2 Coasting and descent

When RPM falls below the configured minimum, target altitude trends below the normal flight band. The motion integrator applies inertia and rate limits so the craft loses altitude gradually. When cadence reaches zero or becomes stale:

1. retain momentum for a configured coast window;
2. begin a predictable descent;
3. preserve sufficient UI indication to distinguish intentional slowing from sensor loss;
4. do not count a transport failure as a clean player failure without a protection window.

Exact smoothing constants must be tuned using recorded cadence traces, not only synthetic UI input.

### 4.3 Reaction-time budget

Every mandatory maneuver must be reachable from every valid entry state allowed by the preceding segment. Course validation should account for:

- obstacle preview distance;
- scroll speed;
- sensor sampling and smoothing latency;
- configured maximum climb and descent rates;
- the equipment's default cadence range;
- corridor height and player hitbox;
- multiplayer regroup/restart placement.

The initial validator may conservatively reject questionable transitions. It need not prove optimal play, but YAML must not make obviously impossible courses easy to publish accidentally.

---

## 5. Course, Collision, and Checkpoint Rules

### 5.1 Authored and learnable courses

The first release uses explicit courses with stable geometry. A seeded or procedural segment assembler may be added later, but random generation is not the default experience.

The course vocabulary should start small:

- open segment;
- lower obstacle or terrain rise;
- upper obstacle or ceiling drop;
- corridor;
- split corridor;
- collectible path;
- checkpoint;
- finish;
- camera/elevation transition;
- presentation trigger.

Recognizable courses require stable identifiers and versions. Historical results must retain which version was played.

### 5.2 Collisions and lives

Collision response is configured through a rule policy. The initial recommended policy is forgiving:

- a hit removes one life;
- the player bounces away from the colliding surface;
- temporary invincibility prevents repeated damage from one geometry contact;
- losing the final life fails the rider for that attempt;
- level completion may award an idempotent ring bonus through the existing Fitness ring ledger.

Lives, attempts, checkpoints, level completion, and game-over projection are cross-game concepts. They should live in a shared game runtime rather than in the Fitness UI or the RPM motion engine.

### 5.3 Checkpoint restart

When a multiplayer attempt fails, the whole active group restarts from the most recent checkpoint. The checkpoint snapshot includes the course clock/position and any rule state declared checkpoint-persistent. It must not serialize live sensor objects or React state.

Collectible and ring semantics at restart must be explicit and exploit-resistant:

- ordinary HR-zone rings already earned remain earned;
- idempotent checkpoint or completion bonuses cannot be farmed by restarting;
- course collectibles may either remain collected for the attempt or reset according to the course rule;
- a final result records restarts and lives lost.

---

## 6. Multiplayer and Ghost State

All riders share one course clock, geometry, and checkpoint boundary. Each has independent input, target altitude, physical state, hitbox, lives, ring accumulation, and HR effects.

Riders should render in a readable formation using small stable horizontal offsets while navigating the same geometry. The renderer must remain comprehensible at the supported maximum rider count; it may switch to lanes or another layout policy when formation overlap becomes excessive.

When a rider loses all lives before the group reaches the checkpoint outcome:

- that rider enters a non-colliding `ghost` state;
- their craft remains visible and may continue responding to cadence as practice;
- the ghost cannot collect gameplay collectibles or trigger course outcomes;
- normal Fitness HR-zone ring earning continues because exercise effort is still real;
- the configured revival policy determines whether and when the rider returns to active play;
- when the attempt resolves as failed, the whole group restarts at the checkpoint and riders return according to the configured checkpoint and revival policies.

This runtime ghost is distinct from CycleGame's existing recorded ghost opponent. Names and types should make that distinction explicit, for example `eliminated-practice` internally even if the UI calls it a ghost.

### 6.1 Configurable revival

Ghost revival is a reusable game rule, not RPM motion or Fitness UI behavior. The shared rules runtime should support a small registry of validated revival policies rather than arbitrary callbacks in YAML.

| Policy | Revival condition |
|---|---|
| `checkpoint` | An active teammate reaches the next checkpoint; recommended default. |
| `group-restart` | The group restarts from its most recent checkpoint. |
| `timeout` | A configured amount of game time elapses while at least one rider remains active. |
| `collectibles` | The active team earns a configured number of revival collectibles. |
| `effort` | The ghost rider or active team satisfies a configured, safe effort condition. |
| `none` | The rider remains a ghost until the attempt or level ends. |

```yaml
# Cooperative default
ghost_revival:
  policy: checkpoint
  lives_restored: 3

# Teammate rescue mechanic
ghost_revival:
  policy: collectibles
  required: 5
  collectible: rescue-ring
  lives_restored: 1

# Practice-oriented mode
ghost_revival:
  policy: timeout
  seconds: 20
  lives_restored: 1
```

Revival must be deterministic, visible, and idempotent. A revival event records the rider, policy, cause, course position, and restored resources. A ghost cannot accidentally satisfy collision- or course-object-based revival conditions. Effort-based revival uses resolved participant zones and the same safety constraints as other heart-rate effects; raw BPM thresholds do not belong in course YAML.

---

## 7. Rings and Heart-Rate Policies

### 7.1 Rings

The game reuses the existing Fitness ring economy:

- heart-rate zone policy awards rings continuously through `TreasureBox`;
- the game displays current session rings without maintaining a second balance;
- configured checkpoint or level-clear bonuses use `TreasureBox.awardBonus` with stable idempotency keys;
- collision, ghost state, and restart do not erase rings already earned;
- visual collectible rings must not imply a durable award unless they actually call the canonical ring ledger.

A course may place visual ring paths as guidance or bonuses. The roadmap must decide whether each collected object is itself a ledger award or whether collectibles contribute to a single idempotent checkpoint bonus. The latter is likely safer and less noisy.

### 7.2 Heart-rate effect extension point

Heart rate may affect gameplay continuously, but no single effect is selected yet. The engine should accept resolved modifiers rather than know HR-zone meanings.

Candidate policy scopes:

```yaml
heart_rate_effect:
  policy: passage-assist
  activation:
    scope: any-rider       # rider | any-rider | all-riders | group-highest
    minimum_zone: hot
  effect:
    corridor_clearance_multiplier: 1.15
```

Other possible effects include scroll-speed reduction, collision cushioning, shield regeneration, or lift stabilization. Policies may be individual or shared. `any-rider` behavior parallels the existing ambient LED idea: one qualifying participant can change the shared environment.

Safety and legibility constraints:

- higher HR must not be required to escape an otherwise impossible obstacle;
- effects use the participant's resolved zone, not a global raw BPM threshold;
- sensor dropout removes an assist gracefully rather than snapping geometry into the player;
- a shared effect must have deterministic aggregation when riders occupy different zones;
- the UI must communicate which effect is active and why;
- assists should reward real effort without encouraging unsafe escalation.

---

## 8. Shared Game-Platform Boundary

The Piano `SideScrollerGame` is a useful extraction source, not the target abstraction. Its current engine embeds a ground runner, jump/duck states, random low/high obstacles, health, score, and level evaluation.

The shared layer should be assembled from narrow packages:

| Package | Owns | Does not own |
|---|---|---|
| Simulation clock | Clamped delta time, pause/resume, deterministic stepping | React lifecycle, sensors |
| Scrolling world | Normalized coordinates, course position, moving/static entities | Piano notes, RPM |
| Collision geometry | Hitboxes, overlap/contact queries, collision events | Damage or bounce policy |
| Course runtime | Authored segment activation, checkpoints, finish, version | Theme assets, rider calibration |
| Game rules runtime | Lives, attempts, elimination/ghost, checkpoint restore, result | Fitness ring ledger |
| Presentation contract | Semantic entities and animation states | Specific sprites and CSS |

Game adapters then provide:

- Piano: note matching, jump/duck motion, obstacle generator, Piano host/session integration.
- Fitness RPM side-scroller: equipment cadence input, altitude motion, authored terrain, multiplayer, rings, and Fitness session integration.

The existing `Piano/game-platform` is Piano-owned and cannot simply become the global package by naming convention. The extraction must establish an application-neutral ownership location consistent with the full-stack application-module roadmap. Piano-specific hosts remain Piano-specific.

---

## 9. State Model

A minimal lifecycle projection is:

```text
ready -> countdown -> playing <-> paused
                         |
                         +-> checkpoint-restart -> countdown
                         +-> completed -> result
                         +-> game-over -> result
```

Per-rider state is separate:

```text
active -> invincible -> active
   |
   +-> eliminated-practice ("ghost")
               |
               +-> active when configured revival policy resolves
```

The host-facing lifecycle can reuse the small canonical vocabulary already used by the Piano host (`ready`, `countdown`, `playing`, `paused`, `result`, `exiting`) while retaining richer game-owned substates internally.

---

## 10. Persistence and Results

An RPM side-scroller run belongs to the active Fitness session and should record:

- course ID and immutable version;
- theme ID;
- equipment and rider assignments;
- resolved calibration snapshot per rider;
- start, checkpoint, restart, collision, elimination, revival, and finish events;
- lives lost and checkpoint restarts;
- course collectibles and idempotent bonus awards;
- completion state and elapsed wall/game time;
- cadence quality flags needed to explain an outcome;
- the selected HR-effect policy and relevant activation events.

Do not persist frame-by-frame world snapshots. Store sufficient events and periodic checkpoints for recovery and audit. Existing CycleGame race persistence and Fitness timeline conventions should be reused where their contracts fit.

---

## 11. Delivery Roadmap

### Phase 0 — Contracts and tuning harness

- Define and validate the course, theme, equipment calibration, and HR-effect schemas.
- Build a deterministic simulation harness with synthetic and recorded cadence traces.
- Establish reaction-time budgets and tune smoothing/coasting behavior on real equipment.
- Decide the neutral names and ownership location for shared game packages.

### Phase 1 — Shared primitives

- Extract simulation clock, coordinate/entity types, and collision queries without changing Piano behavior.
- Add authored course traversal and checkpoints behind pure tests.
- Add generic lives, attempt, checkpoint, result, and eliminated-practice rules.
- Add configurable ghost-revival policies to the generic rules runtime.
- Keep Piano adapters around its existing jump/duck and random spawning behavior.

### Phase 2 — Single-rider vertical slice

- Consume equipment cadence through the existing Fitness session contract.
- Implement calibration resolution, smoothing, target altitude, coasting, and descent.
- Render one interchangeable theme and one authored course.
- Implement collision, lives, immediate checkpoint restart, completion, and ring bonus.
- Expose a simulator mode for testing without physical hardware.

### Phase 3 — Multiplayer

- Add independent rider physics over the shared course clock.
- Add readable formation/layout behavior.
- Add eliminated-practice ghost state and group checkpoint restart.
- Add and visually communicate the selected revival process.
- Exercise sensor loss, different calibration ranges, rider reassignment, and simultaneous collisions.

### Phase 4 — Heart-rate policies and authoring breadth

- Add the policy resolver with `rider`, `any-rider`, `all-riders`, and aggregate scopes as justified by tested mechanics.
- Ship at least one accessible, clearly communicated assist.
- Expand the validated course vocabulary, themes, collectible paths, and camera/elevation transitions.
- Add authoring preview and playability diagnostics.

---

## 12. Acceptance Criteria for the First Playable Release

1. A rider on configured equipment can control vertical target position predictably across the useful RPM range.
2. RPM above the maximum cannot move the target beyond the top of the playable band.
3. Zero or stale cadence produces a visible coast followed by descent and does not teleport the craft.
4. One YAML-authored course can be completed without code changes and contains at least a lower obstacle, ceiling/corridor, checkpoint, and finish.
5. The same course can swap between two themes without changing physics or course YAML.
6. Every mandatory maneuver satisfies the conservative reaction-time validator.
7. Collision consumes lives with bounce and temporary invincibility; final-life failure restarts from the checkpoint.
8. Multiplayer riders share the course and checkpoint restart while retaining independent motion and lives.
9. An eliminated rider remains able to pedal in a visible, non-colliding practice state until the configured revival or terminal condition resolves.
10. Revival is deterministic, visible, persisted, and cannot be awarded twice for the same cause.
11. Normal HR-zone rings continue accruing in active and ghost states.
12. Level-clear ring bonuses are durable and idempotent across restart, remount, or persistence retry.
13. All important results retain the course version and resolved calibration used by the attempt.

---

## 13. Open Decisions

The following decisions should remain explicit rather than being hidden in the first implementation:

1. Which revival policies ship in the first release beyond the default checkpoint revival?
2. Are visual course rings individually durable awards, or inputs to one checkpoint/level bonus?
3. Which heart-rate assist ships first, and is its initial scope individual or `any-rider` shared?
4. What is the maximum supported simultaneous rider count, and when does formation rendering switch to lanes?
5. Which state survives checkpoint restart or revival: collectibles, score, shields, temporary assists, and course-specific switches?
6. Does exhausting all configured lives ever produce a terminal game-over, or can a fitness session always continue through repeated checkpoint attempts?
7. What authoring unit is most usable for segment placement: seconds, normalized course distance, world units, or musical-style measures?

---

## 14. Non-Goals for the First Release

- Directly converting RPM into horizontal speed or claimed real-world distance.
- A general-purpose physics engine.
- Arbitrary scripts embedded in course YAML.
- Primarily random or endless courses.
- Requiring a high HR zone to complete mandatory geometry.
- Replacing the existing CycleGame races, cadence pipeline, Fitness session, or ring economy.
- Reusing Piano-specific note, staff, jump, duck, or host concepts in Fitness.
