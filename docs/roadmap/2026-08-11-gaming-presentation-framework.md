# Gaming Presentation Framework Roadmap

> Implementation update (2026-08-12): Presentation V2 now lives in `shared/presentation` with strict catalog/scene validation, a deterministic top-down compiler, Node and browser Canvas executors, a neutral backend API, semantic host contracts, an explicit v1 migration adapter, and an 11-scene canonical acceptance suite. Top-down authoring now includes deterministic terrain shapes/routes and boolean exclusions, placement-referenced route anchors, declared off-screen continuation, material/surface/plane/biome/boundary-filtered composition zones, constrained placement groups, effective surfaces supplied by bridges and hazards, color-backed material commands, adjacency-aware component variation, visible-bounds avoidance, and semantic-role QA. The current candidate suite renders 4,806 draws into 102 QA PNGs with 67 resolved inner corners, 178 connector joins, zero clipping, zero non-uniform scale draws, and no catalog warnings. The approved baseline is independently stored; normal QA fails with pixel diffs, candidate mode preserves all non-baseline gates, and promotion remains explicit. See [Presentation Framework V2](../reference/gaming/presentation-framework-v2.md). Side-scroller, fixed-grid, and text modes have explicit adapter contracts but are not yet compiled by the top-down implementation.

## Implemented foundation (2026-08-11)

- `sprites/` remains the immutable vendor archive; the normalized runtime tree is `assets/`.
- The asset CLI inventories, plans and applies collision-free canonical copies, measures labeled sheet grids, validates standard manifests, and renders contact sheets, GIF clips, and assembly PNGs.
- Homeserver contains the 1,209-file canonical tree plus `catalog/default.yml`. The initial approved pack is grass, oak tree, wood house, and Farmer Bob, all SHA-256 pinned.
- The gaming API exposes `GET /api/v1/gaming/assets/:packId` and verified image URLs; only approved catalog entries are returned.

### Asset-readiness execution ledger (steps 1–14)

This is the concrete completion sequence for retiring `sprites/` as a runtime dependency while preserving it as immutable provenance. Steps 9–14 are executed through `cli/gaming-assets.cli.mjs`.

1. **Preserve raw provenance.** Keep `media/games/_common/sprites/` byte-stable and outside runtime resolution.
2. **Establish a working mirror.** Audit against a complete local mirror of the authoritative homeserver/Dropbox media root.
3. **Define source/license scopes.** Keep core, characters, desert, dungeons, free, Halloween, UI, and volcano separate; unresolved roots remain explicit issues.
4. **Define the physical taxonomy.** Use canonical `assets/<pack>/<category>/...` paths, with unknown material isolated from general packs.
5. **Normalize physical names.** Use lowercase kebab-case paths without flattening semantic source groups.
6. **Define stable semantic IDs.** Scenes name assets such as `npc.farmer-bob` and `terrain.desert-water-shoreline`, never files.
7. **Define reviewed metadata.** Pin hashes, geometry, frames, clips, tags, anchors, license scope, autotile polarity, and prefab parameters in YAML.
8. **Build the authoring CLI.** Provide inventory, migration, verification, validation, sheet/frame/GIF generation, derivation, prefab explanation/rendering, and scene rendering without `frontend/src/`.
9. **Generate the forensic inventory with the CLI.** `inventory` records 1,236 non-hidden files: 1,209 PNGs and 27 non-images, plus separate duplicate/issue/non-image reports.
10. **Generate the migration plan with the CLI.** `organize-plan` records hashes and canonical destinations for 1,209 PNGs with zero normalized-path collisions.
11. **Verify the canonical tree with the CLI.** `organize-verify` proves all 1,209 destinations match their reviewed raw-source SHA-256; Mega Man intentionally maps to `assets/side-scroller/players/megaman.png`.
12. **Generate visual review evidence with the CLI.** Labeled category/pack contact sheets show filenames, dimensions, candidate cells, and approval state; frame grids and GIFs prove Farmer Bob, Desert shoreline, and SideScroller geometry/animation.
13. **Validate and assemble with the CLI.** `validate`, `prefab-explain`, `prefab-render`, and `scene` prove approved catalogs, finite house variants, positive lake shoreline, negative island shoreline, anchors, and composition.
14. **Publish and retire runtime raw paths.** Publish `catalog/{default,desert,side-scroller}.yml`, generated reports, and reproducible previews beside private media; backend/frontend runtime code contains no `sprites/` or legacy static Mega Man reference.

Generated private-media evidence lives in:

```text
media/games/_common/catalog/generated/
  inventory.yml
  duplicates.yml
  issues.yml
  non-images.yml
  organization.yml

media/games/_common/previews/audit/
  default-*.png
  desert-*.png
  farmer-bob-frames.png
  farmer-bob-idle.gif
  side-scroller-player-frames.png
  side-scroller-player-run.gif
```

The inventory currently contains 294 explicit issues: one hidden-path exclusion and 293 unresolved-provenance records. These are quarantined audit findings, not approved runtime assets. They remain visible for later provenance work without preventing the reviewed catalogs from being used.

The remaining sections preserve the broader design and next implementation waves.

### Terrain/topology sweep (2026-08-11)

`$DAYLIGHT_BASE_PATH/media/games/_common/catalog/terrain-metadata-sweep.yml` records the preparation backlog for every canonical PNG beneath a `tiles/` path plus known off-tree topology systems. The CLI verifies measured dimensions and fail-closed coverage:

```bash
npm run gaming:assets -- terrain-sweep \
  --root "$DAYLIGHT_BASE_PATH/media/games/_common" \
  --manifest "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/terrain-metadata-sweep.yml"
```

Current result: 1,291 canonical PNGs scanned; all 113 PNGs beneath `tiles/` accounted for; 66 tile-path sheets plus 15 off-tree sheets assigned to 37 topology/join families; 47 tile-path PNGs explicitly excluded as non-topology material; zero unreviewed tile sheets. Thirty-six families are cataloged and QA-renderable. The two unattributed legacy cave sheets have a final hash-pinned quarantine disposition and remain unavailable at runtime.

Completed capability work:

1. Normalized 61 cardinal/compound-corner assets, including synchronized eight-phase water pages.
2. Generated corrected connector atlases for eleven fence variants and cataloged bridges/decks with measured visible-alpha ports.
3. Added ordered height-band metadata for sixteen cliff/wall systems and component metadata for pavement, volcano, and interior-wall atlases.
4. Added exhaustive topology, connector, height, component, and scene-assembly QA; catalog promotion is tied to checked sweep evidence.

### Ten-scene framework proof (2026-08-11)

`$DAYLIGHT_BASE_PATH/media/games/_common/catalog/showcase/scenes.yml` is the reproducible acceptance suite. It renders ten 640×384 scenes covering default village, lakeside, desert, dungeon, volcano, shroom, Halloween, free-pack coast, cave, and stone courtyard themes. Each scene contains at least three targeted review regions; the Halloween scene contains four.

The suite currently proves:

- 10 required themes and 31 targeted join/scale review regions;
- 3,314 concrete draws with zero viewport clipping and zero catalog warnings;
- 31 compound inside corners selected from metadata rather than direct frame placement;
- 156 exact connector-port joins;
- 18 terrain regions, 7 connector regions, 5 height regions, and 5 component regions;
- corrected 32×32 desert humanoid/mummy geometry, exact alpha bounds, and ground anchors;
- consolidated full-scene and close-up montages for human visual review;
- SHA-256 pins for all 93 generated PNG artifacts in the suite report.

The unit gates separately render all 61 autotile assets, 32 connector families, 16 height systems, and all three mixed component atlases. The scene-set gate enforces minimum scene/theme coverage, warning-free validation, review-region coverage, no clipping, subsystem use, inside-corner resolution, and connector counts.

```bash
npm run gaming:assets -- scene-qa-set \
  --root "$DAYLIGHT_BASE_PATH/media/games/_common" \
  --manifest "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/showcase/scenes.yml" \
  --out-dir "$DAYLIGHT_BASE_PATH/media/games/_common/previews/qa/showcase"
```

## Outcome

Create a reusable, YAML-authored presentation framework for DaylightStation games. It will compose pixel-art environments, boards, characters, NPCs, items, effects, and UI-adjacent scenery while leaving each game's rules, input, and state machine independent.

The framework must be CLI-first: asset authoring, validation, visual inspection, animation previews, scenario simulation, and screenshot regression testing must work without first integrating work into `frontend/src/`.

Canonical runtime assets live at:

```text
media/games/_common/assets/
```

The original `sprites/` import is retained only as immutable provenance while
cataloged runtime paths, derived atlases, and QA evidence use `assets/`.

The first pack is the privately held default collection. Its included licenses permit project use and modification but prohibit redistribution/resale. Keep its asset files and license texts in private media storage, not Git or a public package.

## Existing seams

- `shared/gaming/definitions/card-game.yml` is a versioned, backend-loaded game definition. The backend pins its content hash at session creation.
- `frontend/src/modules/Gaming/` hosts the Card Game runtime and Pokémon journey view.
- `frontend/src/modules/Piano/SideScrollerGame/` already separates its gameplay engine from a small YAML-driven visual theme.
- `backend/src/1_adapters/persistence/yaml/gaming/YamlGamingDefinitionStore.mjs` supplies the definition-loading and snapshot boundary.

The framework should extend these seams, rather than replacing the individual games with one generic game engine.

## Cross-application scope

Although the first consumers are games, scenes/prefabs are a reusable visual-presentation capability. They must be usable as an embedded surface in Fitness, School, Piano Kiosk, Gaming, and future applications without importing a gaming runtime, session API, reducer, MIDI provider, or input handler.

Examples:

| Host | Appropriate uses | Host remains responsible for |
| --- | --- | --- |
| Gaming/Card Game | Arena, board, encounter environment, damage/celebration effects | Rules, session persistence, player decisions |
| Piano Kiosk | SideScroller world, practice journey, animated reward scene | MIDI, low-latency input, game lifecycle |
| Fitness | Workout route, challenge progress world, achievement scene, animated exercise guide | Sensors, workout state, safety UX, session lifecycle |
| School | Lesson map, vocabulary world, timeline, quiz board, reward/feedback scene | Curriculum, assessment, student state, print/export policy |
| Other apps | Dashboard decorations, contextual explainer scenes, household progress boards | Their own state and navigation |

The renderer should therefore be named and located as a neutral presentation facility. `shared/gaming` may own the original schemas while they remain game-focused, but the browser package should not live under `frontend/src/modules/Gaming/`. Recommended locations:

```text
shared/gaming/
  assetCatalog.mjs
  prefab.mjs
  scene.mjs
  scenePlan.mjs
  sceneValidation.mjs
  animation.mjs

frontend/src/lib/presentation/
  SceneSurface.jsx
  Sprite.jsx
  TileLayer.jsx
  InstanceLayer.jsx
  ActorLayer.jsx
  sceneClock.js
  sceneStyles.scss
```

If scenes become clearly useful beyond gaming, move the pure contracts from `shared/gaming/` to a neutral `shared/presentation/` module in a deliberate follow-up, retaining compatibility exports. Do not prematurely duplicate the system in every application.

## Host contract

The public React surface should be a controlled, presentational component:

```jsx
<SceneSurface
  scene={resolvedScene}
  sceneState={sceneState}
  assetResolver={assetResolver}
  mode="inline"           // inline | contained | fullscreen | export
  paused={!isVisible}
  reducedMotion={prefersReducedMotion}
  className="fitness-route-scene"
  onAssetError={reportAssetError}
/>
```

It must not fetch game definitions, create sessions, install keyboard/MIDI listeners, navigate, own global timers, or emit authoritative state changes. The host supplies the definition/scene, a narrow `sceneState`, and all event handling.

Each host may wrap it with a small application adapter that converts its native state to the shared scene-state model. For example, Fitness can map distance and milestone state to route markers; School can map lesson progression and answer result to a scene; Piano can map the existing world state to runner/entity placement.

## Shared control interface

Reusable presentation also needs a reusable input boundary. Interactive games/scenes receive **semantic actions**, never raw keyboard codes, MIDI notes, touchscreen coordinates, or gamepad button numbers.

```text
Bluetooth gamepad ─┐
browser keyboard ─┼─> input provider ─> input router/context ─> semantic action ─> host/game handler
PianoKeyboard/MIDI ┤                                                                    |
touch controls ───┘                                                                    `-> replay/simulator
```

```js
{
  action: 'move.left',       // stable semantic identifier
  phase: 'start',            // start | change | end | repeat
  value: 1,                  // normalized 0..1, or -1..1 for analogue axes
  source: 'gamepad',         // keyboard | piano | touch | gamepad | automation
  sourceId: '8bitdo-pro-2',  // optional diagnostics/multiplayer identity
  at: performance.now(),
}
```

The host/game handler interprets actions. SideScroller maps `jump` and `duck` to its existing engine calls; a School quiz maps `navigate.next` and `confirm` to focus/answer behavior; Fitness maps `acknowledge` to dismiss a milestone. No experience needs to know whether a Bluetooth D-pad, touch arrow, Piano chord, or keyboard produced the action.

### Action manifests and mapping profiles

An experience declares the actions it supports, never hardware key codes:

```yaml
controls:
  actions:
    move.up:    { kind: digital, label: Move up, repeat: { delay_ms: 260, interval_ms: 90 } }
    move.down:  { kind: digital, label: Move down, repeat: { delay_ms: 260, interval_ms: 90 } }
    move.left:  { kind: digital, label: Move left, repeat: { delay_ms: 260, interval_ms: 90 } }
    move.right: { kind: digital, label: Move right, repeat: { delay_ms: 260, interval_ms: 90 } }
    confirm:    { kind: digital, label: Confirm }
    cancel:     { kind: digital, label: Back }
    jump:       { kind: digital, label: Jump }
  hints:
    primary: [move.left, move.right, jump]
```

Device mappings live in household/device configuration, not in a pinned game definition:

```yaml
profiles:
  gamepad-standard:
    move.up: { gamepad: dpad-up }
    move.down: { gamepad: dpad-down }
    move.left: { gamepad: dpad-left }
    move.right: { gamepad: dpad-right }
    confirm: { gamepad: south }
    cancel: { gamepad: east }
    jump: { gamepad: south }

  piano-side-scroller:
    jump: { piano: { action: chord-target, group: jump } }
    duck: { piano: { action: chord-target, group: duck } }
```

The Piano adapter continues to own target generation, staff matching, and chord recognition. The shared layer only receives its semantic `jump`/`duck` actions; piano input is not reduced to naive keybinding.

### Provider and routing architecture

```text
frontend/src/lib/controls/
  ControlContext.jsx        # active context, focus/priority and subscriptions
  useControlActions.js      # host/game consumer hook
  ControlOverlay.jsx        # optional accessible touch controls and action hints
  KeyboardProvider.js       # browser keyboard -> action events
  GamepadProvider.js        # Gamepad API, including Bluetooth controllers
  TouchProvider.js          # buttons/swipes/hit targets -> action events
  PianoProvider.js          # PianoKeyboard/MIDI/staff matcher -> action events
  ReplayProvider.js         # scenarios/replays -> action events
```

Bluetooth devices exposed through the standard Gamepad API use `GamepadProvider`; those that present as keyboards use `KeyboardProvider`. Add a WebHID provider only if a specific device needs capabilities unavailable through Gamepad.

Applications may contain an active game, modal, School text field, Fitness overlay, and global navigation simultaneously. `ControlContext` must route events by active context priority:

- the highest-priority eligible context receives an action first;
- text entry/modals can claim or suppress actions without breaking other contexts;
- deactivation releases held actions and cancels repeat timers, preventing stuck D-pad/piano input from leaking to the next screen;
- providers publish events only: they never navigate or mutate host state;
- all listeners and repeat loops are scoped to provider/context lifecycle.

The scene surface remains non-interactive by default. `ControlOverlay` provides optional touch buttons, while a future scene hit-map may emit named semantic actions only when explicitly enabled. Pixel-art clicks never directly run gameplay.

### Control modalities, accessibility, and replay

- Digital inputs issue `start`/`end`; the router may synthesize declared repeats.
- Held gamepad buttons and piano chords maintain their action while held.
- Analogue sticks issue normalized `change` events with a configurable dead zone, only to experiences declaring analogue actions.
- Touch/swipe gestures translate to the same semantic action events.
- Every required action needs an accessible keyboard/on-screen alternative unless explicitly piano-only.
- Control hints and accessible labels come from the action manifest and selected mapping profile.
- Structured logs record semantic action/source diagnostics, not raw HID payloads.
- CLI scenarios and replays record semantic actions, making them independent of the original physical device.

## Host-provided challenges and mini-games

Visual scenes and controls need a third reusable boundary: a **Challenge Context**. A scene, game, lesson, or workout can request a capability such as “play a scale,” “maintain this heart-rate zone,” “complete a short runner encounter,” or “make a control sequence,” while the surrounding host supplies the appropriate provider from its local context.

This is an extension of the existing Piano card-game provider pattern. `createPianoChordProvider` already declares capabilities, prepares an exercise through Piano policy, exposes a React surface, supports cancellation, grades an attempt, and returns evidence. Its direct attachment to `GamingRuntime` should eventually become a host-neutral provider contract; this roadmap does not require a risky immediate refactor of the working Piano/Card Game flow.

```text
Authored challenge request / host event
                 ↓
       ChallengeContext (selects a local provider)
                 ↓
  Piano provider | Fitness HR provider | mini-game provider | accessibility fallback
                 ↓
        normalized challenge result/evidence
                 ↓
  host decides what success/failure changes (never the renderer/provider)
```

### Requests, capability matching, and results

A challenge request is semantic and serializable:

```yaml
challenge:
  id: boss-scale
  kind: piano.scale
  requirements: { curriculum: pokemon-journey-foundations }
  timeout_ms: 90000
  presentation: { mode: modal, label: Play the scale to power the next attack }
```

Fitness can make a different request using the same lifecycle:

```yaml
challenge:
  id: summit-push
  kind: fitness.heart-rate-zone
  requirements: { zone: vigorous, hold_seconds: 45 }
  timeout_ms: 90000
  presentation: { mode: inline, label: Hold your target zone to reach the summit }
```

Providers advertise explicit capabilities (`piano.scale`, `piano.chord`, `fitness.heart-rate-zone`, `mini-game.runner`, `control.sequence`), versions, prerequisites, and whether they can provide a visual surface, an accessibility alternative, and deterministic simulation. The broker selects only a registered, eligible provider. A request must fail as `unavailable` rather than silently falling back to an unrelated challenge.

All providers settle with a common result:

```js
{
  challengeId: 'boss-scale',
  status: 'completed',       // completed | failed | cancelled | expired | unavailable
  score: 0.94,               // optional normalized score
  evidence: { /* provider-defined, serializable and bounded */ },
  metrics: { durationMs: 28104, attempts: 1 },
  provider: { id: 'piano', version: '5-virtual-keyboard-fallback' },
}
```

The provider produces a result; the host owns the consequence. Card Game passes a completed score to its existing reducer. School records an assessment attempt and decides advancement. Fitness Governance decides whether a safe, eligible HR objective is complete. A scene may play a success animation, but it neither determines nor persists completion.

### Provider contract

```text
frontend/src/lib/challenges/
  ChallengeContext.jsx        # provider registration, selection, lease/lifecycle
  useChallenge.js             # request/start/cancel and snapshot hook
  challengeContracts.js       # shared shapes and result validation
  ChallengeHost.jsx           # mounts an active provider Surface when requested
  ReplayChallengeProvider.js  # deterministic CLI/preview scenarios
```

Conceptually, a provider implements:

```js
{
  id: 'piano',
  version: '...',
  capabilities: () => [{ kind: 'piano.scale', modes: ['modal', 'inline'] }],
  canHandle: (request, context) => ({ eligible: true }),
  prepare: async (request, context) => preparedChallenge,
  createRuntime: async ({ preparedChallenge, context, controls, logger }) => ({
    Surface,             // optional React component
    start: async () => result,
    cancel: (reason) => {},
    dispose: () => {},
  }),
}
```

`context` is explicitly supplied by the host: user/participant identity, available device services, locale, permissions, and persistence callbacks. Providers must not reach into another app's React contexts or assume a `GamingRuntime` exists.

Challenge runs are leases: one has an ID, owner, status, start/deadline, cancellation path, and teardown. Starting a modal challenge claims an appropriately high-priority control context; closing/unmounting cancels it and releases held input. Background or inline challenges may continue only when the host explicitly permits it.

### Fitness governance is a protected provider boundary

Heart-rate and workout challenges require stricter ownership than a fun mini-game:

- The Governance Engine and its approved sensor/session data remain authoritative for HR-zone eligibility, targets, safety limits, pause/disconnect behavior, and completion.
- A `fitness.heart-rate-zone` provider may render progress and emit an evidence-backed completion candidate; it must not calculate a new target zone, override a safety pause, or encourage a user to exceed governance policy.
- Sensor loss, stale data, missing identity, pause, and workout termination produce explicit non-success outcomes. Never infer success from a decorative animation or client timer.
- Fitness owns whether a user can retry, skip, defer, or substitute an objective. Such policy must not be hidden in a generic challenge YAML expression.

### Mini-games as providers

A reusable mini-game is both a challenge provider and, optionally, a scene/control consumer:

```text
mini-game.runner
  SceneSurface       <- assets/prefabs/scene state
  ControlContext     <- jump, duck, pause actions
  challenge runtime  -> score/evidence/result
```

It can be hosted in Piano, School, or Fitness only if the host supplies its required controls and accepts its result contract. The mini-game never assumes MIDI, a particular route, or a specific app's persistence store.

Challenge manifests can declare presentation modes (`modal`, `inline`, `fullscreen`, `background`) and capability requirements, but hosts remain free to deny unsupported modes. Provide an accessible non-timed or alternate input path where the learning/fitness objective permits one.

### Simulation, audit, and tests

- CLI scenarios invoke challenge requests with `ReplayChallengeProvider` or a deterministic provider fixture; they never require a real MIDI device or HR sensor.
- Provider tests cover capability matching, prepare/start/cancel/dispose lifecycle, timeouts, sensor/device loss, and result-shape validation.
- Host integration tests assert consequences: the Card Game reducer receives the challenge result, School records the intended assessment event, Fitness Governance—not the display—accepts or rejects an HR completion candidate.
- Persist bounded, versioned challenge evidence with the host's existing session/attempt record when that host requires auditability; do not centralize all app data merely for framework convenience.

## Architectural boundary

```text
source PNGs -> asset catalog -> prefab catalog -> game scene YAML -> normalized scene plan
                                                                    |- CLI raster/SVG renderer
                                                                    |- authoring preview shell
                                                                    `- production React renderer
```

| Layer | Owns | Does not own |
| --- | --- | --- |
| Asset catalog | Source file, sheet geometry, named frames/clips, tags, license | Game state, gameplay logic |
| Prefab catalog | Reusable composition of assets/prefabs, typed parameters, anchors, footprint and slots | Rules or arbitrary executable conditions |
| Game scene YAML | Environment composition, layers, authored placements and semantic actor mapping | Collision, scoring, MIDI, input handling |
| Game adapter | Translates live game state into a narrow renderer model | Sprite sheet internals |
| Scene renderer | Paints a normalized plan and advances visual-only animation | Authoritative game state |

`shared/gaming` remains pure and portable: schemas, validation, resolution, layout normalization, and deterministic frame selection only. It must not depend on React, Express, filesystem access, or a specific game's implementation.

## Stable asset references

Game and scene YAML must never use a filesystem path or browser URL. They reference a pack/version/asset identifier:

```yaml
asset: npc.farmer-bob
```

The source file and pixel/sheet details are defined once in a versioned catalog:

```yaml
# media/games/_common/catalogs/default/v1.yml
pack:
  id: default
  version: 1
  license: licenses/core-commercial.txt
  native_cell: [16, 16]

assets:
  npc.farmer-bob:
    source: sprites/Cute_Fantasy/NPCs (Premade)/Farmer_Bob.png
    sheet: { cell: [16, 16], grid: [4, 4] }
    clips:
      idle.down: { frames: [[0, 0]], fps: 1 }
      walk.down: { frames: [[0, 0], [1, 0], [2, 0], [3, 0]], fps: 8 }

  terrain.grass:
    source: sprites/Cute_Fantasy/Tiles/Grass/Grass_Tiles_1.png
    sheet: { cell: [16, 16], grid: [16, 16] }
    frames:
      center: [0, 0]
      edge.north: [1, 0]

  effect.rain:
    source: sprites/Cute_Fantasy/Weather effects/Rain_Drop.png
    sheet: { cell: [16, 16], grid: [4, 1] }
    clips:
      fall: { frames: [[0, 0], [1, 0], [2, 0], [3, 0]], fps: 12, loop: true }
```

Do not inventory or reorganize every source asset before the system exists. Curate 30-50 useful assets first, with catalog entries pointing to existing source paths. Later physical reorganization only changes a catalog entry.

Catalog versions are immutable. A new mapping uses `v2.yml`, not an edit to `v1.yml`. A game definition pins its intended pack version:

```yaml
presentation:
  packs:
    default: 1
```

This mirrors pinned game-definition behavior and avoids silently changing old sessions when the art library evolves.

## Experience presentation modes

The primary target is a top-down RPG/adventure experience in the Zelda/Pokémon family. The framework must also support side-scrollers, fixed-grid games, and text-first games without contorting one mode into another.

The shared layer is the catalog/prefab/scene-plan, controls, and challenge contracts. Each mode has its own projection and state adapter:

| Mode | Primary visual/state model | Typical controls | Examples |
| --- | --- | --- | --- |
| `topdown-world` | Tile map, camera, entities, depth/occlusion, named transitions | move, interact, menu, confirm, cancel | RPG/adventure, exploration, Pokémon-style encounters |
| `side-scroller` | X/Y world, follow camera, parallax, pose/physics state, obstacles | left/right, jump, duck, action | Mega Man/Mario-like practice game |
| `grid-board` | Finite rows/columns, cell contents, turn/selection state, overlays | navigate, select, confirm, cancel | chess, Battleship, tactics, card-board hybrids |
| `narrative` | Text blocks, choices, flags, optional illustrations/background | previous/next, choose, confirm, cancel | text adventures, dialogue-first games, quiz narratives |

`SceneSurface` should receive a normalized scene plan, not attempt to infer which game model it is rendering. A small mode-specific adapter creates that plan from the host's state. For example, a `TopDownWorldSurface` can be composed from tile/actor/camera primitives, while `GridBoardSurface` lays out cells and selection overlays. A text-first game may use no pixel scene at all while still using the same controls and challenge lifecycle.

```text
top-down world state ─┐
side-scroller state ──┼─> mode adapter -> normalized scene plan -> SceneSurface
grid-board state ─────┤
narrative state ──────┘                         (optional for narrative)
```

This preserves a common authoring and tooling story but prevents, for example, side-scroller physics or chess turns from becoming fields in an RPG map schema.

### Top-down world: primary model

Top-down scenes need a first-class world/content contract beyond a static illustration:

```yaml
presentation:
  mode: topdown-world
  world:
    tile_size: 16
    maps:
      meadow:
        size: [40, 24]
        layers:
          ground: maps/meadow-ground.yml
          decor: maps/meadow-decor.yml
        spawns:
          start: { at: [5, 18], facing: down }
        portals:
          - { at: [38, 12], target: village, spawn: west-gate }
    actors:
      hero: { prefab: character.adventurer }
      ranger: { prefab: npc.ranger }
```

The rendering adapter resolves map tile IDs, static props, visible entities, y-sort/depth behavior, camera viewport, and visual clips. Game/domain logic retains collision, portal eligibility, dialog, inventory, combat entry, quest flags, and NPC behavior. The initial visual system may consume collision/interaction annotations, but never becomes the authority that applies them.

RPG-oriented asset metadata should include tile frame names, anchor, footprint, occlusion/depth convention, optional entrance/interaction points, and tags. This makes houses, trees, castles, NPCs, chests, doors, and map transitions authorable without hardcoding sprite details.

### Side-scroller

Side-scrolling uses the same assets/prefabs/clips but projects a moving viewport over an X/Y world. Its adapter supplies camera offset, parallax layers, runner pose, obstacle positions, and effects. The existing SideScroller physics and MIDI logic remain authoritative; the shared renderer does not acquire gravity/collision rules.

### Fixed grid/board

Grid games use named cell coordinates, a board geometry, and visual cell/entity mapping:

```yaml
presentation:
  mode: grid-board
  board: { columns: 8, rows: 8, cell: [32, 32] }
  palette:
    player-piece: { prefab: piece.knight }
    target: { asset: ui.target-ring }
```

The game adapter supplies cells, legal moves, selected cell, turn, and transient effects. Chess, Battleship, and tactics games retain their own rules, fog-of-war, secrecy, turn validation, and win condition. The renderer only projects them.

### Narrative/text-first

Narrative games are valid consumers even when no pixel scene is present. They use the shared action manifest, challenge context, deterministic scenario/replay infrastructure, and optional illustration/prefab background. Do not require a map, sprites, or `SceneSurface` to use the framework.

```yaml
presentation:
  mode: narrative
  backdrop: prefab.tavern-interior
```

The narrative engine owns text, choices, flags, pacing, and save state. A pixel scene is a presentation enhancement, not a prerequisite.

### Shared mode contract

Every mode may expose the same host-facing experience adapter shape:

```js
{
  mode: 'topdown-world',
  sceneState,          // optional for text-only mode
  controls,            // semantic action manifest
  challenges,          // requests/providers supplied by host context
  render: () => <ModeSurface />,
}
```

This contract lets a host embed a top-down adventure in Piano, a side-scroller in Fitness, a board in School, or a text adventure anywhere else—while selecting the correct mode-specific renderer and retaining host ownership of identity, persistence, safety, and navigation.

## Scene contract

Scenes use a small initial vocabulary: `fill`, `tilemap`, `instances`, `actors`, `particles`, and optionally `hud-slot`.

```yaml
presentation:
  packs: { default: 1 }
  scene:
    viewport: { width: 320, height: 180, scale: pixel-perfect }
    layers:
      - { id: backdrop, kind: fill, z: 0, color: '#83d2ee' }

      - id: grass
        kind: tilemap
        z: 10
        asset: terrain.grass
        frame: center
        cell: [16, 16]
        rows:
          - '....................'
          - '....................'
          - 'GGGGGGGGGGGGGGGGGGGG'
          - 'GGGGGGGGGGGGGGGGGGGG'

      - id: props
        kind: instances
        z: 20
        items:
          - { prefab: house.cottage, at: [80, 144] }
          - { asset: prop.flowers, frame: blue, at: [192, 144] }

      - id: actors
        kind: actors
        z: 30
        templates:
          player: { asset: npc.farmer-bob, anchor: bottom-center }
          rival: { asset: npc.miner-mike, anchor: bottom-center }

      - { id: weather, kind: particles, z: 100, asset: effect.rain, clip: fall, density: 18 }
```

The first renderer uses a 320x180 virtual coordinate space, scaled to fit its host with nearest-neighbor rendering. It should begin with DOM/CSS rendering for kiosk responsiveness, inspectability, and testability. A canvas renderer is an optional future backend for genuinely high-entity-count games.

## Composite prefabs

Prefabs are named, reusable scene fragments. They eliminate repeated asset, position, and z-order detail for houses, castles, bridges, trees, arena frames, dungeon rooms, and other broad visual concepts.

```yaml
prefabs:
  house.cottage:
    size: [64, 64]
    anchor: bottom-center
    parameters:
      roof: { type: enum, values: [red, blue, moss], default: red }
      door: { type: enum, values: [closed, open], default: closed }
      garden: { type: boolean, default: true }
    layers:
      - { asset: building.cottage-base, at: [0, 16], z: 0 }
      - select: roof
        variants:
          red: { asset: building.cottage-roof-red, at: [0, 0], z: 10 }
          blue: { asset: building.cottage-roof-blue, at: [0, 0], z: 10 }
          moss: { asset: building.cottage-roof-moss, at: [0, 0], z: 10 }
      - select: door
        variants:
          closed: { asset: prop.cottage-door-closed, at: [25, 38], z: 20 }
          open: { asset: prop.cottage-door-open, at: [25, 38], z: 20 }
      - when_parameter: garden
        prefab: prop.flower-garden
        at: [-8, 46]
        z: 30
    tags: [building, home, settlement]
    footprint: { width: 4, height: 3 }
    entrances:
      front: { at: [32, 60], direction: south }
```

Usage is concise:

```yaml
- prefab: house.cottage
  at: [80, 144]
  params: { roof: blue, door: open, garden: false }
```

Prefab kinds:

- **Static**: house, castle, bridge, tree, market stall.
- **Stateful visual**: door, chest, crop, campfire; external state chooses an authored visual variant.
- **Structural**: town block, dungeon room, arena, board frame; composes prefabs, tiles, and named actor slots.

Avoid arbitrary strings evaluated as conditions. Parameters and variants must use a finite declarative vocabulary, be typed and validated, and disallow cyclic nested-prefab references.

## State bindings

The renderer should receive a simple scene-state model from each game adapter:

```js
{
  entities: {
    player: { state: 'idle', x: 74, y: 136, facing: 'right' },
    opponent: { state: 'damaged', x: 246, y: 136, facing: 'left' },
  },
  effects: [{ id: 'hit-42', kind: 'spark', at: [246, 104] }],
}
```

The game adapter owns translation from its real state to this model. YAML maps semantic states such as `idle`, `running`, `damaged`, and `open` to visual clips or prefab variants. It must not read arbitrary game-state paths or execute expressions.

- SideScroller retains its existing physics engine and supplies runner pose, obstacle positions, world offset, and visual events.
- Card Game retains its Pokémon SVG figures, battle UI, and reducer. It can add a YAML arena/background/effect scene behind the existing view and later use named arena slots for partner and opponent figures.

Visual clocks only advance animations. They never participate in collision, scoring, MIDI timing, or authoritative transitions.

To support non-game applications, the model must also allow non-actor semantic data while staying renderer-safe:

```js
{
  entities: {
    learner: { state: 'celebrating', x: 74, y: 136, facing: 'right' },
    milestone: { state: 'complete', x: 246, y: 120 },
  },
  effects: [{ id: 'confetti-42', kind: 'confetti', at: [160, 48] }],
  values: { progress: 0.6, weather: 'sunny' },
}
```

`values` may select explicitly authored variants or fill declared visual meters, but it must not unlock arbitrary evaluation in YAML. Scene authors declare the available value name and supported variants/range; the host only supplies values.

## Backend serving

Use catalog-backed assets rather than direct media paths in browser-facing YAML:

```text
GET /api/v1/gaming/assets/:pack/:version/:assetId
```

The service resolves an asset ID through the catalog, verifies it remains under `media/games`, supplies correct MIME type, ETag, and immutable cache headers, and can change source image format/atlas implementation later without changing game YAML.

The authorization model must be designed before sharing scenes across applications. An asset route should only serve approved catalog assets, never arbitrary files below the media root. If user-specific or household-private scenes are added later, resolve them through a separate scoped catalog/authorization policy rather than weakening the common-pack route.

## Embedding, lifecycle, and accessibility requirements

The same scene will appear in a small dashboard card, a 1280x800 kiosk, a full-screen School activity, and static/export contexts. The renderer must provide these host-controlled behaviors:

- **Sizing:** fixed virtual viewport plus `contain`, `cover`, and `stretch` fit policies; no hardcoded page dimensions.
- **Pause/visibility:** suspend animation and particle work when hidden, off-screen, in an inactive tab, or explicitly `paused`; never leave unowned animation loops running after unmount.
- **Motion:** honor `prefers-reduced-motion` and host policy; render a stable representative frame when animation is reduced or disabled.
- **Performance tiers:** let a host choose `static`, `low`, or `full` effects. Fitness dashboard cards should not run a full particle field; Piano's active game may.
- **Accessibility:** treat decorative scenes as `aria-hidden`; require an authored text summary/alt description for informative scenes; keep application controls and reading order outside the pixel canvas.
- **Input isolation:** scenes are non-interactive by default. A future interactive mode needs a declared hit-map/action contract and must be opt-in, so it cannot intercept Fitness, School, or Piano keyboard/touch/MIDI input.
- **Theming:** expose a small CSS-variable palette and host class hook for framing/background, but do not recolor licensed pixel assets unexpectedly.
- **Offline/preload:** let hosts request/preload only the assets their scene uses; report loading/failure states without blocking the host application.
- **Export:** `mode="export"` produces a static frame suitable for School print/PDF or report generation; animated/browser-only effects degrade predictably.

## CLI-first authoring and verification

Implement `cli/gaming.cli.mjs`; it should operate on the same pure shared core as the backend and production renderer.

```text
npm run gaming -- catalog validate default@1
npm run gaming -- catalog browse default@1 --tag terrain --contact-sheet /tmp/terrain.png
npm run gaming -- asset inspect npc.farmer-bob
npm run gaming -- asset sheet npc.farmer-bob --out /tmp/farmer.png

npm run gaming -- prefab validate house.cottage
npm run gaming -- prefab render house.cottage --out /tmp/cottage.png
npm run gaming -- prefab render house.cottage --matrix roof=red,blue,moss door=open,closed
npm run gaming -- prefab explain house.cottage --param roof=blue

npm run gaming -- scene validate scenes/meadow-demo.yml
npm run gaming -- scene render scenes/meadow-demo.yml --out /tmp/meadow.png
npm run gaming -- scene animate scenes/meadow-demo.yml --seconds 4 --out /tmp/meadow.gif
npm run gaming -- scene test all

npm run gaming -- simulate card-game --scenario scenarios/card-game-first-win.yml
npm run gaming -- simulate side-scroller --scenario scenarios/side-scroller-jump-duck.yml
npm run gaming -- replay sessions/game_123.yml --frames /tmp/replay/
```

Asset inspection may infer dimensions, transparency, plausible frame sizes, and generate a contact sheet, but it only emits a draft catalog snippet. A human names frames and assigns semantic meaning.

Prefab matrix rendering and `prefab explain` are required authoring tools: they expose bad anchors, omitted variants, nested composition, and incorrect z-order before a game consumes the prefab.

## Preview studio

Provide a development-only preview shell outside production application code:

```text
tools/gaming-studio/
  index.html
  preview.mjs
  inspector.js
```

`npm run gaming -- preview scenes/meadow-demo.yml` opens a local page with YAML/image hot reload and supports:

- scene grid, object bounds, anchors, footprint, and z-order overlays;
- click inspection of resolved asset, frame/clip, parameters, and coordinates;
- visual-time scrubbing and animation controls;
- fixture selection (`idle`, `walking`, `damaged`, `night`, `rain`);
- PNG/GIF export plus normalized scene-plan inspection.

It is an authoring surface, not a product route and not a second frontend implementation. It consumes shared scene-plan code.

## Simulation and replay

Scenario files execute real deterministic gameplay logic—not duplicate test implementations:

```yaml
# shared/gaming/scenarios/card-game-first-win.yml
game: card-game
seed: 42
setup: { partner_id: bulbasaur }
commands:
  - { type: choose_action, card: vine-whip }
  - { type: resolve_challenge, score: 0.94 }
  - { type: continue }
expect:
  status: complete
  player_health_at_least: 1
  badges: [pidgey, meowth, snorlax]
```

The simulator prints its event timeline and final state, then emits a replay artifact the preview studio can render. SideScroller scenarios call the existing pure `sideScrollerEngine.js` functions rather than reimplementing physics.

## Testing

Validate both structure and pixels:

- missing IDs, invalid frames/clips, bad parameter types, invalid tiles, invalid anchors, and prefab cycles fail validation;
- assets must resolve under the approved media root;
- named scene fixtures render at a fixed size and compare to approved snapshot PNGs with a defined tolerance;
- failed visual snapshots produce diff images;
- scenario tests assert real reducer/engine state and can render replay checkpoints;
- every locomoting actor declares a complete facing scheme, records which facings are authored versus catalog-mirrored, and passes fixed-anchor clips plus semantic control simulations;
- every one-shot actor action returns to a registered state or is explicitly terminal;
- every modular body, wearable, hand, tool, held-item, and mount sheet maps all non-empty cells, declares reviewed transparent phases, and passes catalog-rig registration plus composite action/facing renders;
- animated items, props, mechanisms, and effects pass timing, stable-anchor, effect-envelope, state-endpoint, and transition QA even when no showcase scene currently places them;
- release reports count actors, objects/effects, animation layers, temporal clips, transitions, returns, terminals, composites, and control simulations separately, with zero runtime errors and zero deferred canonical sprite candidates before the library is called complete.

All render targets consume a normalized scene plan, for example:

```js
[
  {
    type: 'sprite',
    assetUrl: '/api/v1/gaming/assets/npc.farmer-bob',
    sourceRect: [0, 0, 16, 16],
    destinationRect: [66, 120, 32, 32],
    z: 30,
    opacity: 1,
  },
]
```

This shared plan is what makes CLI previews and visual tests representative of the production renderer.

## Delivery sequence

0. Audit and establish the private asset metadata layer described below. Do not use the current directory as a runtime library beforehand.
1. Define and test the pure asset-catalog, prefab, scene, and scene-plan schemas in `shared/gaming/`.
2. Curate a minimal default meadow pack: grass, path, water, tree, flowers, chest, two NPCs, rain, and enough building parts for one cottage.
3. Add catalog loading, validation, and the safe asset-serving endpoint.
4. Implement CLI catalog inspection, contact sheets, prefab validation/explanation, and static PNG rendering.
5. Author `house.cottage` and `meadow-demo.yml`; add visual snapshot testing. This is the first proof point.
6. Add the preview studio and animated rendering.
7. Migrate SideScroller from its bespoke theme contract to shared asset/scene primitives without changing physics or MIDI controls.
8. Add a Card Game arena scene behind the existing Pokémon battle UI; retain its SVGs and game-specific layout.
9. Grow the vocabulary only when a demonstrated game needs camera tracking, dynamic tiles, tile collision, atlases, or higher-throughput canvas rendering.

## Asset audit and metadata foundation

The normative YAML vocabulary is [Gaming Asset Metadata Standard](../reference/gaming/asset-metadata.md). The roadmap's early illustrative snippets are superseded by that standard where they differ.

`media/games/_common/sprites/` is presently an uncurated vendor-source archive, not a runtime asset library. The existing `sprite_manifest.json` is historical: it contains a stale `media/img/Sprites` base path, uses heuristic frame detection, predates files now present, and should not become a source of truth. The source tree also mixes multiple vendor packs with differing licenses, plus loose artifacts such as the Mega Man sheet and `river_render.png`.

### Preserve sources; add an overlay first

Do not move, rename, crop, optimize, or deduplicate the original PNG hierarchy during the audit. Its vendor paths and included readme/license files are provenance. Add a sibling metadata overlay:

```text
media/games/_common/
  sprites/                         # current raw vendor source; read-only by policy
  catalog/
    README.md                       # catalog conventions and authoring guide
    packs/
      default/
        pack.yml                    # identity, source roots, licensing and visibility
        provenance.yml              # vendor/readme mapping and import snapshot
        generated/
          inventory.yml             # machine facts; never edited by hand
          duplicates.yml            # hash-identical files and review candidates
          issues.yml                # unknown/corrupt/ambiguous files
        authored/
          terrain.yml
          structures.yml
          characters.yml
          npcs.yml
          props.yml
          effects.yml
          ui.yml
        review.yml                  # candidate -> approved/deferred/rejected status
    licenses/
      core-commercial.txt
      free-noncommercial.txt
      dungeons-commercial.txt
  previews/                         # reproducible contact sheets/animations; non-authoritative
  legacy/
    sprite_manifest.json            # preserved historical artifact, never loaded at runtime
```

Actual path details may be adjusted, but the policy matters: raw source, generated facts, curated semantic metadata, and derived previews are separate. The runtime reads only approved authored entries plus the relevant generated source facts; it never scans the entire tree as a catalog.

The application schema, parsers, validators, CLI, and synthetic unit-test data belong in Git. Production catalogs, provenance, scene manifests, QA manifests, and their real-asset test cases belong beside the private media assets so they travel with the licensed files and are available to the deployed media directory. Keep generated previews recreatable; do not treat them as source art.

### Audit passes

1. **Forensic inventory.** Create a read-only inventory of every non-hidden file: relative source path, SHA-256, byte size, MIME type, dimensions, colour mode, alpha, modified time, candidate grid sizes, and associated source-root/readme. Produce a separate report for `.DS_Store`, non-image files, unreadable images, filenames with unexpected extensions, and hash-identical duplicates.
2. **Provenance and license classification.** Treat `Cute_Fantasy`, `Cute_Fantasy_Dungeons`, `Cute_Fantasy_Volcano`, `Cute_Fantasy_Characters`, `Cute_Fantasy_Desert`, `Cute_Fantasy_UI`, and `Cute_Fantasy_Free` as separate source/license scopes until their terms are recorded. `Cute_Fantasy_Free` has a non-commercial restriction and must not be silently mixed into a general-use pack. Loose Mega Man and other non-vendor files require `source: unknown`/`review` status and cannot become approved shared assets until provenance is known.
3. **Visual review.** Generate contact sheets grouped by source pack and source category, with filename, dimensions, candidate cell size, and review status printed under each image. This is the practical way to identify usable terrain, structures, characters, NPCs, props, effects, and UI.
4. **Semantic curation.** A human assigns stable IDs, named frames/clips, tags, anchors, footprint/occlusion convention, and status. Automatic tooling may suggest a cell grid but cannot infer that a particular row is `walk.down`, identify tile adjacency, or determine whether a sheet is suitable for reuse.
5. **Approval gate.** Only entries marked `approved` are visible to the runtime catalog. Candidates/deferred/rejected assets remain searchable in audit tooling but cannot be referenced in scene YAML.

### Generated facts vs. authored semantics

Machine-generated inventory is useful but deliberately boring:

```yaml
generated:
  source: sprites/Cute_Fantasy/NPCs (Premade)/Farmer_Bob.png
  sha256: '...'
  bytes: 12345
  image: { width: 64, height: 64, mode: RGBA, has_alpha: true }
  candidate_cells: [[16, 16], [32, 32], [64, 64]]
  provenance: core-commercial
```

Authored metadata supplies meaning and runtime eligibility:

```yaml
assets:
  npc.farmer-bob:
    source: sprites/Cute_Fantasy/NPCs (Premade)/Farmer_Bob.png
    source_sha256: '...'
    status: approved
    license_scope: core-commercial
    tags: [npc, villager, farmer]
    sheet: { cell: [16, 16], grid: [4, 4] }
    anchor: bottom-center
    clips:
      idle.down: { frames: [[0, 0]], fps: 1 }
      walk.down: { frames: [[0, 0], [1, 0], [2, 0], [3, 0]], fps: 8 }
```

Pinning `source_sha256` catches accidental Dropbox replacement or source drift. A changed file forces an explicit review rather than silently changing a game.

### Stable ID and classification policy

Use semantic, lowercase dot IDs rather than vendor filenames:

```text
terrain.grass.basic
terrain.water.shallow
structure.cottage.basic
structure.castle.small
npc.farmer-bob
character.knight.swordsman
prop.chest.wood
effect.rain
ui.target-ring
```

Tags provide discovery (`terrain`, `water`, `village`, `npc`, `hostile`, `effect`, `ui`); an ID should not encode every tag. Use explicit aliases for renames and deprecations so authored scenes do not break.

### Reorganization after approval

After the overlay and a small curated pack are proven, create a canonical runtime-facing source hierarchy only when it provides a concrete benefit:

```text
assets/default/
  terrain/
  structures/
  characters/
  npcs/
  props/
  effects/
  ui/
```

Copy/move in small, hash-verified batches while retaining the original vendor source as provenance. Never perform an unverified bulk rename. The stable catalog ID remains unchanged; only its approved source mapping changes. Avoid duplicated binary files unless an intentionally derived/edited asset needs a distinct provenance entry.

### Source-tree naming migration

The current `sprites/` hierarchy is a download dump and should become a predictable physical source tree before it is curated. The goal of the migration is *filesystem hygiene*, not premature semantic authorship: catalog IDs retain the meaningful names used by games, while paths become stable, lowercase, portable, and readable.

Target source layout:

```text
sprites/
  default/
    animals/
    crops/
    nature/
    npcs/
    props/
    terrain/
    tiles/
    weather/
  characters/
  desert/
  dungeons/
  free/                           # remains separately licensed/restricted
  halloween/
  ui/
  volcano/
  legacy-unclassified/           # loose imports/unknown provenance; never approved by default
```

Rules:

- Directories and filenames are lowercase kebab-case ASCII; no spaces, underscores, parentheses, or vendor title casing.
- Preserve extensions in lowercase (`.png`, `.txt`, `.py`, `.json`).
- Normalize known structural paths rather than merely flattening them: `NPCs (Premade)` becomes `npcs/premade`, and vendor `read_me.txt` becomes a clearly scoped `license.txt` at its pack root.
- Retain source-pack separation. Do not merge `free` with the core pack simply because visuals look compatible.
- Loose files, old manifests, scripts, and unknown-source art go under `legacy-unclassified/` with `status: unresolved`; they cannot enter a runtime pack by accident.
- Do not embed semantic interpretations into every filename. For example, `grass-tiles-1.png` is a sensible physical name; the curated catalog later decides whether a particular frame is `terrain.grass.basic.center`.
- Do not silently resolve normalized-name collisions. A migration plan must list each collision and require an explicit disambiguator (`-01`, `-north`, `-variant-a`, etc.) chosen during review.

Examples:

```text
Cute_Fantasy/Tiles/Grass/Grass_Tiles_1.png
  -> default/tiles/grass/grass-tiles-1.png

Cute_Fantasy/NPCs (Premade)/Farmer_Bob.png
  -> default/npcs/premade/farmer-bob.png

Cute_Fantasy_Dungeons/Dungeon_1/Floor_spikes_1.png
  -> dungeons/dungeon-1/floor-spikes-1.png

megaman-sprites.png
  -> legacy-unclassified/megaman-sprites.png
```

Implement this as a two-step CLI migration:

```text
gaming-assets organize-plan --root <common-dir> --out <migration.yml>
gaming-assets organize-apply --root <common-dir> --plan <migration.yml> --apply
```

`organize-plan` is read-only. It emits source-to-destination mappings, file hashes, license scope, collision/error reports, and a reversible move manifest. Review and commit/archive that manifest before applying it. `organize-apply` accepts only a reviewed plan, verifies every source hash and destination absence, moves one file at a time, writes a journal after each successful move, and can resume or reverse a partial migration. It must require an explicit `--apply`; a default invocation is always dry-run.

### Audit completion criteria

- Every raw image has inventory/provenance/license classification or an explicit unresolved issue.
- Every approved asset has a stable ID, hash, source mapping, visible license scope, semantic type/tags, and reviewed geometry.
- All approved sheets have only human-confirmed frames/clips; no generated frame guess becomes runtime behavior by default.
- Contact sheets make the approved asset set explorable by category.
- The catalog validator rejects unapproved assets, unknown provenance, stale hashes, illegal references, duplicate IDs, and source paths outside the raw root.
- The current legacy manifest is preserved for comparison but is not loaded anywhere.

### Pixel-density gate learned from the showcase

The renderer must treat source density, object footprint, and display magnification as independent values. Asset metadata now uses integer `pixel_density`; scenes use `world_scale`. Production scene fixtures require explicit density and enforce one pixel scale so a large structure cannot be silently shrunk to `scale: 1` beside 2× terrain. Genuine high-density sources are reduced with nearest-neighbour sampling before world magnification, while native-density structures retain their full authored footprint.

Scene QA emits a per-asset `resolution_audit`. Promotion requires zero non-uniform draws, exact measured sheet geometry, and close-up review of representative actors, structures, animals, and terrain together. The initial free coastal fixture exposed both failure modes: ad hoc half-scale placements and an oak sheet incorrectly declared as two 48×48 cells instead of its measured three 32×48 cells.

## Non-goals for the first pass

- A generic RPG/gameplay engine.
- A full map editor or procedural world generator.
- YAML expressions, JavaScript hooks, or arbitrary state-path evaluation.
- Reorganizing every source asset upfront.
- Moving paid asset packs into the repository or public distribution.
- Replacing game-specific Card Game/Piano UI with generic visual components.
