# Gaming Asset Metadata Standard

> This document describes the v1 audit/catalog vocabulary. Production scene rendering now uses the strict [Presentation Framework V2](presentation-framework-v2.md); v1 remains available only for source audit, derivation recipes, migration input, and regression fixtures.

## Purpose

This standard defines the YAML vocabulary for private game-art assets: single images, sprite sheets, tilesets, animations, prefabs, and scene placement. It is renderer-neutral and is used by audit tooling, backend asset resolution, CLI previews, and browser renderers.

It describes visuals only. Gameplay rules, collision authority, scoring, interaction outcomes, and input handling remain in the owning game/application.

## Core rules

- Asset IDs and metadata names use lowercase dot notation: `npc.farmer-bob`, `walk.down`, `grass.center`.
- Filesystem paths use lowercase kebab-case, but authored YAML references asset IDs after curation.
- Pixel coordinates have a top-left origin: x increases rightward and y increases downward.
- A point is `[x, y]`; a size is `[width, height]`; a rectangle is `[x, y, width, height]`.
- A grid cell is `[column, row]`, zero-indexed. It is never an x/y pixel position.
- All source-image geometry is in native image pixels. Scene placement is in the scene's declared virtual coordinate system.
- Use named frames and clips in all new scene/prefab YAML. Numeric cell references are permitted only inside the asset's own manifest.
- Never infer runtime animation or tile meaning from filename, image dimension, or frame order.

## Pixel density and world scale

Source resolution, world footprint, and display magnification are separate facts. Do not use a placement `scale` override to make a large source sprite fit a scene.

```yaml
assets:
  structure.house:
    pixel_density: 1          # source pixels per logical art pixel
    geometry: { layout: freeform }
    frames: { default: { rect: [0, 0, 96, 128] } }

# Production scene
world_scale: 2                # display pixels per logical art pixel
require_explicit_pixel_density: true
enforce_uniform_pixel_scale: true
placements:
  - { asset: structure.house, at: [408, 250] }
```

`pixel_density: 1` means the source is native-resolution art. `pixel_density: 2` means two source pixels represent one logical art pixel; the renderer first reduces the crop with nearest-neighbour sampling, then applies `world_scale`. The rendered dimensions are therefore:

```text
rendered width  = source frame width  / pixel_density × world_scale
rendered height = source frame height / pixel_density × world_scale
```

`pixel_density` must be an integer from 1 through 8, and grid cells or freeform frame sizes must divide evenly by it. It defaults to `1` for compatibility, but production scenes should require it explicitly. A large 96×128 house from a native 16-pixel pack is normally still density `1`: it occupies six by eight source tiles and must be magnified exactly like the terrain. Density describes source sampling, not object size.

With `enforce_uniform_pixel_scale: true`, every concrete draw must use the scene's `world_scale`; a placement or prefab that sneaks in `scale: 1` fails. Use a separately reviewed asset/frame or a typed prefab size variant when an object genuinely needs a different world footprint. `resolution_audit` in every scene report records the density and pixel scale of every drawn asset, normalization counts, and any non-uniform draws.

## File shape

One asset manifest may contain one asset, or a pack manifest may contain an `assets` map of the same entries. The unit entry is:

```yaml
schema_version: 1
pack: { id: default }

assets:
  npc.farmer-bob:
    source: assets/default/actors/npcs/premade/farmer-bob.png
    source_sha256: '<sha256 from generated inventory>'
    status: approved
    license_scope: core-commercial
    kind: sprite-sheet
    tags: [actor, npc, humanoid, farmer]
    geometry: {}
    defaults: {}
    frames: {}
    clips: {}
```

Required audit fields are `source`, `source_sha256`, `status`, and `license_scope`. Runtime-eligible assets have `status: approved` and must pass geometry/frame validation.

`kind` is one of:

| Kind | Meaning |
| --- | --- |
| `image` | A single drawable image; may still define one named frame. |
| `sprite-sheet` | A sheet of independent sprites or animation frames. |
| `tile-sheet` | A sheet whose named frames are primarily map tiles. |
| `ui-sheet` | A sheet of UI pieces/icons/cursors. |
| `effect-sheet` | A sheet primarily used for effects/particles. |

Kinds guide discovery and validation defaults; they do not grant gameplay behavior.

## Geometry

Every asset declares one layout type.

### Grid layout

Use a grid when all cells have the same dimensions.

```yaml
geometry:
  layout: grid
  cell: [16, 16]
  grid: [4, 4]                # [columns, rows]
  margin: [0, 0]              # optional outer [x, y] pixels; default [0, 0]
  spacing: [0, 0]             # optional between-cell [x, y] pixels; default [0, 0]
```

The top-left pixel of `cell: [column, row]` is:

```text
x = margin.x + column × (cell.width + spacing.x)
y = margin.y + row × (cell.height + spacing.y)
```

Validation verifies the declared grid fits inside the image. It permits unused padding outside the final cell only when `allow_trailing_padding: true` is explicitly set.

### Freeform layout

Use a freeform layout for irregular atlases, composite art, or frames with unequal sizes.

```yaml
geometry:
  layout: freeform
```

Each named frame supplies its own native-pixel `rect`. Do not invent an artificial grid merely because image dimensions happen to divide evenly.

## Frames

A frame is one named source rectangle. It is the only thing a renderer crops from an asset.

```yaml
frames:
  idle.down.0:
    cell: [0, 0]              # grid assets only
    anchor: bottom-center
    content_bounds: [3, 4, 11, 12]
    tags: [idle, down]

  portrait:
    rect: [0, 0, 48, 64]      # freeform assets only
    anchor: bottom-center
```

Exactly one of `cell` or `rect` is allowed:

- `cell` is valid only for `geometry.layout: grid` and resolves to a source rectangle from declared geometry.
- `rect` is valid only for `geometry.layout: freeform` and must stay within source-image bounds.
- A frame inherits the asset default anchor/tags unless explicitly overridden.
- `content_bounds` is `[x, y, width, height]` inside the frame and must exactly match its non-transparent pixels. It makes padded animation cells auditable and gives scale review a visible size rather than a misleading crop size.
- `subject_bounds` is an optional reviewed `[x, y, width, height]` inside `content_bounds` for an opaque or effect-backed frame whose alpha envelope is not the subject silhouette. Scale-class QA uses it, while clipping and rendering continue to use exact decoded `content_bounds`. It must not be used on ordinary transparent sprites merely to conceal incorrectly sized art.

Frames tagged through an asset with `ground-contact` must use both exact `content_bounds` and a custom point anchor whose y coordinate equals the visible-alpha bottom. Visible alpha must also retain transparent padding on all four sides of the source frame. These are the hard checks for trees, actors, boats, and other silhouettes whose feet, trunk, or hull must reach their authored ground point without being truncated by a source-cell or viewport boundary.

Action frames may contain a tool, weapon, projectile, splash, or spell envelope below the actor's feet. In that case the visible-alpha bottom is not the world contact. Preserve the reviewed foot baseline explicitly instead of moving the actor anchor to the effect:

```yaml
anchor: { point: [32, 41] }
ground_contact:
  point: [32, 41]
  reason: fixed actor foot baseline; fishing splash extends below the feet
```

The contact point must equal the custom anchor and remain stable across the clip. This exception changes only the decoded visual envelope; it does not permit per-frame world-position drift.

When a tool, weapon, projectile, or effect makes `content_bounds` larger than the actor body, add `scale_reference: idle.right.0` (or the corresponding reviewed facing). Scale-class and cross-facing body comparisons use that referenced subject silhouette, while clipping, canvas sizing, fixed-anchor rendering, and silhouette-envelope QA continue to use the action frame's complete `content_bounds`. A scale reference must name another frame with decoded bounds; it cannot be used to hide a wrongly sized base sprite.

For animated grid assets, validation also scans internal cell seams for continuous alpha. This catches a 32-pixel actor mistakenly declared as two 16-pixel rows, or a 48-pixel actor split into two 24-pixel rows, even when the incorrect grid happens to cover the source dimensions exactly. If independently reviewed adjacent frames genuinely touch opposite cell edges, document only the affected axis:

```yaml
geometry:
  layout: grid
  cell: [32, 48]
  grid: [4, 1]
  cross_cell_alpha:
    allowed_axes: [vertical]
    reason: reviewed independent adjacent frames intentionally touch opposite vertical cell edges
```

This is an explicit geometry exception, not permission to suppress frame-edge or anchor QA.

Frame IDs are local to their asset. A consuming scene refers to `npc.farmer-bob#idle.down.0` only for inspection/debugging; normal gameplay-facing YAML should refer to a named clip.

## Anchors and offsets

An anchor is the point in a rendered frame positioned at a scene's `at` point. Use the following standard anchors:

```text
top-left       top-center       top-right
center-left    center           center-right
bottom-left    bottom-center    bottom-right
```

The default is `bottom-center` for actors/placed world objects and `top-left` for UI pieces/tiles. An asset may establish this once:

```yaml
defaults:
  anchor: bottom-center
```

For exceptional art, use a custom native-pixel anchor:

```yaml
anchor: { point: [8, 15] }
```

`point` is measured from the frame's own top-left, not the source image's top-left. Do not combine a named anchor and custom point in the same frame.

`offset: [dx, dy]` is a destination-space adjustment applied after anchoring. Use it sparingly for authored composition; do not use it to hide incorrect frame geometry.

## Clips and animation

A clip is a named ordered sequence of frames. Clip IDs use `state.direction` where direction applies: `idle.down`, `walk.left`, `attack.right`; non-directional clips use a plain semantic name such as `open` or `sparkle`.

```yaml
clips:
  idle.down:
    frames: [idle.down.0]
    loop: loop
    fps: 1

  walk.down:
    frames: [walk.down.0, walk.down.1, walk.down.2, walk.down.3]
    loop: loop
    fps: 8

  chest.open:
    frames:
      - { frame: chest.closed, duration_ms: 120 }
      - { frame: chest.opening.1, duration_ms: 120 }
      - { frame: chest.open, duration_ms: 700 }
    loop: once
    qa_profile: expressive
```

Clip rules:

- Use either a clip-level `fps` with string frame IDs, or per-frame `duration_ms` objects. Do not mix them.
- `fps` is positive and may be fractional; `duration_ms` is a positive integer.
- `loop` is `loop`, `once`, or `ping-pong`; default is `loop`.
- `once` holds its final frame until its host changes state or removes the clip.
- `qa_profile` is optional and is `tight`, `expressive`, `transform`, or `mechanism`. Fixed-anchor QA derives conservative silhouette-variance limits from the motion state by default. Use `transform` only for reviewed attacks, transformations, and explosions; use the broader but still finite `mechanism` envelope for doors, gates, spikes, and machinery that intentionally retract almost completely.
- Clips are visual timing only. They do not emit gameplay events, trigger sounds, or advance game state.
- A clip by itself is not a runtime animation contract. Every actor, every asset tagged `animated`, and every asset with clips declares `animation.mode` so unreviewed sheet cells cannot be mistaken for usable motion.

An intentionally empty registered cell in a wearable, tool, mount, or other `animation-layer` uses `transparent: true` instead of fabricated pixels or an omitted phase. Decoded QA requires zero visible alpha and forbids `content_bounds`; non-layer assets cannot use this marker. This preserves exact phase registration when, for example, a hat disappears during a roll or a hand layer has no pixels in one attack phase.

The animation state machine maps host state and logical cardinal facing to reviewed visual clips. Logical facing uses `north/east/south/west`; clip IDs may retain art-language names such as `run.right`. Mirroring belongs in this catalog mapping, never in a scene or input adapter.

```yaml
animation:
  mode: state-machine
  default_state: idle
  facing_scheme: four-way
  authored_facings: [south, north, east]
  control: { scheme: four-way, idle_state: idle, move_state: run }
  states:
    idle:
      motion: in-place
      facings:
        south: idle.down
        north: idle.up
        east: idle.right
        west: { clip: idle.right, flip_x: true }
    run:
      motion: locomotion
      facings:
        south: run.down
        north: run.up
        east: run.right
        west: { clip: run.right, flip_x: true }
```

`mode: static` requires `default_frame` and makes an explicit claim that this catalog asset has no reachable clips. `mode: deferred` requires a reviewed `preview_frame` and a reason; it permits static scene composition while correctly failing animation-readiness QA. `mode: state-machine` requires every clip to be reachable from a state or transition. State motion is `stationary`, `in-place`, `locomotion`, `kinematic`, or `airborne`. `kinematic` means the host translates a pose (for example a one-frame slide or projectile) without claiming that the art contains a multi-phase locomotion cycle. In-place and locomotion clips require at least two frames; kinematic clips may contain one. Every actor with directional states declares a `four-way` or `horizontal` `facing_scheme` (the control scheme may supply it), and every directional state must fulfill that complete set. A genuinely side-only action on a generally four-way actor declares state-level `facing_scheme: horizontal`, requiring east/west mappings without inventing absent north/south art. Every one-shot state—actor, object, or effect—declares exactly one of `return_to: <state>` or `terminal: true`, preventing attacks, reactions, mechanisms, and temporary effects from silently freezing on their last frame.

`authored_facings` records which logical directions have distinct source art. It may be declared once on `animation` or overridden on a state when a sheet mixes four-way locomotion with side-only actions. Each declared authored facing must exist, must reference its own clip, and cannot use `flip_x`; synthesized directions remain ordinary facing entries with an explicit catalog-owned flip. This makes direction provenance testable and prevents a separately drawn left-facing row from being silently discarded in favor of mirroring.

Stateful items and objects use stable states plus endpoint-checked visual transitions:

```yaml
animation:
  mode: state-machine
  default_state: closed
  states:
    closed: { motion: stationary, clip: closed }
    opened: { motion: stationary, clip: opened }
  transitions:
    open: { from: closed, to: opened, clip: opening }
```

An asset tagged `interactable`, `destructible`, or `stateful` needs at least two stable states and one explicit transition. Transition clips must use `loop: once`, begin with the source state's stable frame, and finish with the destination state's stable frame. `resolveAssetAnimationTransition` returns the reviewed clip and destination state. This describes visual continuity only; the host remains responsible for deciding that a gameplay event occurred.

`resolveAssetAnimation(asset, { moving, facing })` is the shared host-facing resolver. Keyboard, touch, gamepad, piano, Fitness, and School adapters all produce semantic movement state/facing and receive `{ clip, flip_x, motion }`; they never know sheet coordinates. Animation QA drives all four cardinal directions for `four-way` controls and only east/west for `horizontal` controls, so a side-scroller is not incorrectly rejected for lacking top-down facings.

Layered actors keep their state machine on the base asset and register catalog-owned visual layers explicitly:

```yaml
animation:
  mode: state-machine
  default_state: idle
  facing_scheme: four-way
  states: { ... }
  layers:
    - asset: layer.skeleton-bow
      role: weapon
      states: [idle, run, attack]
```

Each referenced asset is tagged `animation-layer` and owns reviewed frames, clips, and states for the listed subset. The validator requires matching style profile, pixel density, scale class, motion, facing/flip registration, phase count, timing, normalized frame geometry, anchors, and return/terminal semantics. Omit `states` only when the layer implements every base state. Nested layer graphs and scene-authored sprite overlays are rejected. `resolveLayeredAssetAnimation(catalog, assetId, options)` returns the ordered base-plus-overlay resolution, while animation QA emits `composite-*.gif` and `composite-*-strip.png` evidence, renders active layers in the controlled movement simulation, and reports `layered_assets`/`composite_clips` separately.

Runtime-selectable modular actors use a catalog-level animation rig rather than hard-coding a costume into the base actor:

```yaml
animation_rigs:
  player.default:
    base_slot: body
    slots:
      mount-under: { order: -10 }
      body: { order: 0, required: true }
      feet: { order: 10 }
      legs: { order: 20 }
      chest: { order: 30 }
      head: { order: 40 }
      hands: { order: 60 }
      tool-top: { order: 70 }
    qa_assemblies:
      - id: farmer-actions
        base: player.default
        equipment:
          feet: layer.player.default.feet.brown
          tool-top:
            states:
              attack: layer.player.default.tool.iron-sword
              axe: layer.player.default.tool.iron-tools

animation:
  rig: { profile: player.default, slot: body }
```

Every participant declares the same rig `profile` and a semantic `slot`. A full wearable implements the complete base state machine. An action-specific tool, held light, or mount declares `animation.rig.states`; validation requires an exact match for that reviewed subset and the runtime resolver omits it from unrelated states. Equipment may name one compatible asset, or `{default, states}` when a slot changes source by action. Slot order is deterministic and catalog-owned. Mounted `qa_assemblies` are production metadata, not Git test fixtures: animation QA renders every base state/facing for the representative costumes and runs their control simulations. This proves interchangeability and compositing before any frontend integration.

A legacy or vendor rig may store each action in a different base PNG. Its profile declares `state_bases: { idle: player.idle, run: player.running, attack: player.attack }`, and every base participant scopes itself with `animation.rig.states`. `resolveRiggedAnimationState` selects the correct base from the logical state, so input and gameplay code still operate on one semantic actor. A wider tool/effect sheet may use `registration: custom-anchor` on its slot only when every base and layer phase has a reviewed custom world anchor; ordinary body and wearable slots retain exact normalized canvas-and-anchor registration.

Coverage reports distinguish state-machine assets from genuinely temporal animation. `runtime_animated`/`animated_assets` count reviewed state machines, including useful one-frame kinematic states; `runtime_temporally_animated` and `temporally_animated_{assets,actors,objects,layers}` count only assets with a reachable multi-frame clip. Animation-only equipment/overlay sources are reported as `animation_layer_assets`, never as world objects. Report temporal counts when making claims about actual animation coverage.

Animation candidate discovery is path-assisted but catalog-aware. A PNG beneath `effects/` that is already approved solely as a tile/component asset remains governed by tile geometry/topology coverage and is excluded from the sprite-animation denominator; directory naming alone cannot turn it into deferred animation work.

Static composition may name an exact frame, a clip, or an animation state. A clip/state reference resolves to its first reviewed frame (and the state's south/default clip where directional) so scene YAML can say `frame: idle` without duplicating compatibility frames. Gameplay still uses `resolveAssetAnimation`; this fallback is only for deterministic still rendering.

Topology animation is declared on `autotile`, not as an unrelated sprite clip. A normalized atlas stores identical topology pages at a fixed cell offset:

```yaml
autotile:
  animation:
    mode: grid-offset
    frames: 8
    fps: 6
    loop: loop
    phase_stride: [4, 0]
```

Mask and compound-corner selection happens first; the phase offset is then applied to every resolved base and overlay frame. This keeps an entire lake synchronized and prevents an animated shoreline phase from using a different topology.

## Tile semantics

Tiles use named frames, with optional visual metadata that supports map authoring:

```yaml
tiles:
  grass.center:
    frame: grass.center
    tags: [ground, grass]
    connects: grass
  water.edge.north:
    frame: water.edge.north
    tags: [water, edge]
    connects: water
```

`connects` is a visual/autotile group only. It does not make a tile walkable, swimmable, damaging, or collidable. Those decisions belong to the map/game domain.

### Terrain regions and shoreline polarity

Scene authors paint logical cells; they never select an edge or corner frame.

```yaml
terrain:
  grid: { cell: [16, 16], scale: 3 }
  regions:
    # The listed cells are water painted over sand: a lake.
    - terrain: water
      asset: terrain.desert-water-shoreline
      polarity: positive
      cells: [[5, 3], [6, 3], [5, 4], [6, 4]]
      rects: [[10, 3, 6, 4]] # optional [x, y, width, height] shorthand
      continues: [east]      # material visibly continues through that viewport edge

    # The listed cells are sand carved from a water base: an island.
    - terrain: sand
      asset: terrain.desert-water-shoreline
      polarity: negative
      cells: [[14, 7], [15, 7], [14, 8], [15, 8]]
```

`positive` means the selected cells are the connected material. `negative` means the selected cells are the inverse island/hole material; the renderer still computes the same cardinal neighbour mask, but resolves it through the catalog's `negative` mapping. This keeps lake and island art correct without scene-level frame picking.

`cells` and `rects` may be combined. Rectangles expand to cells before neighbour masks are calculated and overlapping cells are deduplicated. This keeps broad paths, plazas, lakes, and islands concise while preserving explicit cells for irregular details.

`continues` may contain `north`, `east`, `south`, or `west`. The region must actually touch every named viewport edge. The renderer supplies the off-screen neighbour for mask selection, so a road or river crossing the viewport does not receive a visually closed end cap.

Bridge and dock frames may declare logical `landings` that require a compiled terrain `surface`. Bridge banks can also share a `material_group`, with `crossings` requiring the sampled span material to differ from that group. These fail closed during scene compilation, so a connector cannot silently terminate in water, use mismatched banks, or sit on a single undifferentiated material.

Assets that only make visual sense embedded in a raised structural band, such as dungeon doors and arches, declare `world.attachment: { system: height, minimum_overlap_ratio: <0..1> }`. Scene compilation measures the asset's visible-alpha bounds against compiled height-band art and fails when the required overlap is absent. This prevents a door from validating as an ordinary floor placement while rendering detached from its wall.

An interface atlas whose non-edge pixels are transparent declares an underlay contract. `underlay: inside-fill` draws the region material beneath a bank or rim overlay; `underlay: outside-fill` draws each contacted receiving material beneath a transparent crop, including clipped wedges at multi-material corners. The latter is appropriate for tilled soil, hedges, and other sparse edge art whose transparent pixels must reveal the actual neighbor rather than whichever scene base happens to be underneath.

Production QA decodes every terrain interface and requires a visible transition band on north, east, south, and west. The default minimum changed-pixel ratio is `0.1`; `transition_band.minimum_changed_ratio` may make a particular interface stricter. Merely having a complete frame map is insufficient when those frames render as an effectively raw color seam.

Scenes may tile one reviewed frame beneath all regions with `ground: terrain.grass#middle`. `ground`, terrain, structures, and actors share one declared `world_scale`. Production scenes should enforce it; object sizing belongs in reviewed asset metadata or prefab variants rather than per-placement scale overrides.

Catalogs declare the mappings explicitly:

```yaml
autotile:
  topology: cardinal-4+diagonal-corners
  supported_polarities: [positive, negative]
  outer_corner_mode: native
  outer_corner_style: rounded
  outer_edge_mode: native
  positive:
    nesw: water.center
    esw: water.edge.north
    es: water.corner.nw
  negative:
    nesw: sand.center
    esw: sand.edge.north
    es: sand.corner.nw
  inner_corners:
    positive: { nw: water.inner.nw, ne: water.inner.ne, se: water.inner.se, sw: water.inner.sw }
    negative: { nw: island.inner.nw, ne: island.inner.ne, se: island.inner.se, sw: island.inner.sw }
  inner_corner_mode: composite
```

`supported_polarities` is required. It is the asset's capability contract, not documentation: each declared polarity needs a map and diagonal-corner coverage, undeclared maps are rejected, and a terrain interface cannot request an unsupported polarity. Positive-only farmland or bank art therefore fails closed for inverse islands instead of quietly reusing incorrect artwork. Every mask that an authored region may produce must be declared, or `fallback` may be used only while a pack remains in curation.

Cardinal masks select the outside edge or corner. `cardinal-4+diagonal-corners` then checks the four diagonals. In legacy `replace` mode, `inner_corners` must contain every exact compound key. In `composite` mode, each polarity provides four transparent quadrant overlays; the renderer layers every missing corner over the selected base, so all fifteen non-empty compound combinations are representable. Missing overlays still fail closed.

Outer-corner mechanism and appearance are separate facts. `outer_corner_mode: quarter-composite` reconstructs a turn from four source quadrants; `native` copies the source sheet's full hand-drawn turn cell so detail may cross the quadrant seam. `outer_edge_mode` applies the same distinction to the four cardinal middle cells: `native` retains a continuous bank, curb, or foam run that quadrant reconstruction would otherwise reduce to two repeated corner halves. `outer_corner_style: square|rounded` records the reviewed visual result, not its provenance. A presentation interface that requires a rounded profile also pixel-compares `ne/es/sw/nw` against the center frame and fails if the active interior quadrant has insufficient cutback. A label alone cannot promote a square turn.

Inner-corner metadata is not sufficient when the source silhouette is wrong for the pack's authored scale. Review every concave frame at the intended `world_scale`: a quarter of a larger island can be topologically correct yet pinch a route nearly closed. Keep any corrected corner set reproducible as a derived atlas recipe, preserve the original edge colors, and pin the derived hash. Recipe layers may use `size: [width, height]` for nearest-neighbour reduction when a source corner needs a smaller visual radius.

### Terrain capability sweep

Before promoting terrain art into a runtime catalog, record it in `$DAYLIGHT_BASE_PATH/media/games/_common/catalog/terrain-metadata-sweep.yml` and run `gaming-assets terrain-sweep`. The sweep uses a deliberately smaller readiness vocabulary than the runtime catalog:

- `metadata-only`: the raw sheet appears to contain scale-correct outer and inner corners; it still needs named frames, mask maps, and topology QA.
- `derived-required`: required joins are missing, oversized, or packed as variable-size stamps; create a reproducible derivative before approval.
- `schema-required`: the source expresses height, temporal pages, or mixed systems that the current flat terrain schema cannot represent honestly.
- `partial`: one variant or static layer is cataloged, but sibling palettes, compact corners, or animated pages remain unfinished.
- `deferred`: provenance or duplication must be resolved before curation.
- `cataloged`: named runtime metadata, hashes, and required QA evidence exist; the sweep verifies catalog entries and source provenance.
- `quarantined`: investigation is complete but provenance is insufficient; hash-pinned entries remain `deferred` and `runtime_available: false`.

The sweep is exhaustive for canonical `tiles/` paths and explicitly adds known topology sheets outside that directory. It is not permission to infer frame coordinates automatically: dimensions and grids are measured facts, while corner polarity, visual radius, wall height, ports, collision, and animation stride remain reviewed semantics.

Production scenes should set `forbid_direct_autotile_frames: true`. With this gate, a placement cannot name any center, edge, outer-corner, or inner-corner frame used by an asset's autotile maps; the material must be authored as a terrain region. Other decorative frames from the same atlas remain valid placements.

Production scenes should also set `fail_on_frame_edge_contact: true`. A non-tile sprite whose visible alpha touches any source-frame edge is rejected because the renderer cannot prove it was not cropped from a larger sprite. Structural port-based assets are exempt—their edge contact is required for connection—and a reviewed exceptional frame may set `allow_edge_contact: true` explicitly.

Cardinal masks use stable `n/e/s/w` order; `isolated` names a cell with no cardinal neighbours. Thin routes may explicitly map `n`, `e`, `s`, `w`, `ns`, and `ew`, but those mappings are asset capabilities—not permission to author concave shapes when the reviewed sheet has no inner-corner art.

Opaque-backed effects must not be placed over tinted or translucent terrain. Derive an exact color-keyed transparent overlay atlas with the CLI, retain its YAML recipe, and pin the generated file's hash like any other runtime asset.

Generic atlas recipes may also declare an exact `color_map` from source `#rrggbb` values to normalized output colors. Palette normalization must remain deterministic and recipe-backed; do not tint individual scene placements.

For terrain interfaces, `color_map` also carries a compatibility invariant: opaque pixels on the receiving-material side must use that material's reviewed palette. Otherwise the interface creates a second, metadata-free boundary outside the topological edge. Pixel QA composites transparent interfaces over their declared underlay and compares every cardinal interface seam to the receiving material at the same tile-local coordinate. This preserves texture phase without misattributing a fill tile's own opposite-edge variation to the interface. The default `receiving-fill` mode permits zero mismatched pixels. An interface whose reviewed outline or bank intentionally reaches the cell boundary must say `seam: { mode: outlined }`; it remains subject to transition-band and corner QA but is no longer falsely treated as receiving fill. `maximum_mismatch_ratio` may tighten either mode. Palette substitution or a transparent receiving-side overlay remains the normal fix for ordinary paths and shores.

When one topology needs several receiving palettes, define each generated image as an asset variant with `extends: <base-asset-id>`. Asset inheritance recursively deep-merges a finite base descriptor, so geometry, frames, autotile masks, animation, scale, and world policy remain single-source while the variant overrides only tags, source, hash, and derivation provenance. Cycles and unknown bases are validation errors. Do not replace a material's base asset globally when only one interface requires the alternate palette.

Assets tagged `overlay` are rejected when a named frame is fully opaque. A genuinely solid interior tile may opt in with `opaque_overlay: true`; this exception must be frame-local. `forbidden_colors` provides a second hard gate for reviewed source-background colors that must not survive derivation:

```yaml
tags: [structure, dock, overlay]
forbidden_colors: ['#0095e9', '#006da8']
frames:
  top.middle: { cell: [3, 0], opaque_overlay: true }
```

Mixed prop atlases occasionally reuse a forbidden background color as intentional visible art—for example, an authored blue accent or a water-substrate prop. Keep the asset-level prohibition and declare a narrowly reviewed frame exception instead of weakening the whole asset:

```yaml
forbidden_colors: ['#006da8']
frames:
  lily.pad:
    rect: [48, 64, 16, 16]
    forbidden_color_exceptions:
      allowed: ['#006da8']
      reason: authored water substrate retained for water-only placement
```

Exceptions must be a subset of the asset policy, must include a review reason, and are rejected if the named color is absent from the frame. This makes exceptions exact and non-stale rather than a general palette bypass.

Use measured visible-alpha bounds when adjoining assemblies. Nominal 16×16 cells do not guarantee that a fence rail, bridge landing, hull, or dock plank reaches the cell boundary.

### Ports and checked assembly connections

Frames that form structural assemblies may name native-pixel connection ports. A port may sit on the frame boundary or inside transparent padding when that point represents the measured end of visible art:

```yaml
frames:
  horizontal.start:
    cell: [1, 0]
    ports: { east: [16, 8], south: [8, 14] }
  vertical.middle:
    cell: [0, 1]
    ports: { north: [8, 0], south: [8, 16] }
```

High-risk scene assemblies give their concrete placements stable IDs and declare every required join:

```yaml
connections:
  - { from: [garden.nw, east], to: [garden.north-1, west] }

placements:
  - { id: garden.nw, asset: prop.wood-fence#horizontal.start, at: [32, 188] }
  - { id: garden.north-1, asset: prop.wood-fence#horizontal.middle, at: [64, 188] }
```

The scene renderer transforms each port through anchor, scale, mirror, and rotation rules and rejects the render unless both world-space points coincide exactly. IDs and ports describe visual assembly only; they are not gameplay entity IDs or collision sockets.

An asset with `requires_all_ports: true` makes every port on every ID-bearing placement mandatory. Each must occur in exactly one scene connection. This is appropriate for structural sets such as fences: it rejects dangling continuation shafts, reused joins, and a corner frame incorrectly substituted for a capped endpoint.

Ports prove coordinate continuity, not silhouette quality. If a turn requires two straight sprites to overlap, derive a single junction frame and put both outgoing ports on that frame. A fence corner should therefore be one authored L-shaped sprite rather than a horizontal post plus a vertical post occupying the same pixels. Keep exact review crops for every junction orientation used by a production scene.

Derived junctions must compose the minimum necessary source pixels. If the horizontal corner cell already owns the post cap, do not overlay a complete vertical segment: doing so can replace the cap with a shaft or create a false spike above it. Extend only the missing seam pixels, then inspect both the isolated junction and its connection to the following segment.

Connector families additionally declare a canonical branch map:

```yaml
connector:
  topology: connector-graph
  pieces:
    ns: vertical.middle
    ew: horizontal.middle
    es: corner.nw
```

The key is ordered `n/e/s/w`; each referenced frame must expose the corresponding named ports. Unsupported T or cross masks are omitted and fail resolution rather than being assembled from overlapping posts.

### Height bands and mixed atlases

Cliffs and walls preserve depth as ordered three-part bands:

```yaml
height:
  topology: cliff-height
  rise_cells: 4
  bands:
    lip: [lip.left, lip.middle, lip.right]
    face.upper: [face.upper.left, face.upper.middle, face.upper.right]
    face.lower: [face.lower.left, face.lower.middle, face.lower.right]
    foot: [foot.left, foot.middle, foot.right]
  transitions:
    north: [lip, face.upper, face.lower, foot]
```

Mixed sheets use `components` to name independently consumable subsystems such as fills, borders, stairs, doorways, hazards, and decorations. This is an index, not a universal autotile: a host requests a component or combines it with a dedicated `autotile`, `height`, or `connector` asset.

### Semantic assembly arrays

Scenes use the same `cells` and `[x, y, width, height]` `rects` vocabulary for structural systems. The renderer selects concrete frames from catalog metadata:

```yaml
connectors:
  - id: garden-fence
    asset: connector.default.wood
    origin: [32, 64]
    rects: [[0, 0, 6, 1], [0, 3, 6, 1], [0, 1, 1, 2], [5, 1, 1, 2]]
    z: 12

heights:
  - id: south-ridge
    asset: height.default.grass-cliff-1
    direction: north
    origin: [320, 288]
    width: 10
    continues: [west, east]
    z: 6

components:
  - id: courtyard-floor
    asset: components.default.pavement
    component: floor
    rects: [[0, 0, 20, 12]]
    z: 0
```

Connector cells derive a canonical neighbor mask, select the corresponding named piece, and synthesize exact port-to-port connections. Unsupported branches and misaligned ports fail rendering. Height regions expand the catalog's ordered transition bands and choose left, middle, and right frames from the authored width. Optional `continues` names only the two sides along that span; a continued endpoint uses the seamless middle frame rather than a cap. Component fills deterministically vary approved frames; a border component with an `outline` map selects `nw/n/ne/w/e/sw/s/se` from region geometry and omits interior cells. One-cell-thick ambiguous outlines fail rather than layering arbitrary corners.

These arrays describe visual assembly only. Collision, traversal, hazards, and interaction remain separate gameplay metadata.

## Placement language

Scenes and prefabs use these terms consistently:

```yaml
- asset: npc.farmer-bob
  clip: idle.down
  at: [96, 144]               # destination point to receive the frame anchor
  scale: 3                    # uniform positive multiplier
  offset: [0, -2]             # optional destination-space adjustment
  z: 30                       # explicit draw order; higher draws later
  flip_x: false                # optional visual mirror
  opacity: 1                  # inclusive range 0..1
  depth_sort: true            # sort equal-z world objects by their ground point
  shadow: { size: [11, 4], offset: [0, 1], opacity: 0.35 }
```

| Term | Meaning |
| --- | --- |
| `at` | Destination point for the frame/prefab anchor. Never use `position` or `xy`. |
| `rect` | `[x, y, width, height]` source rectangle only, used by freeform frames. |
| `cell` | `[column, row]` source-grid address only. |
| `offset` | `[dx, dy]` destination adjustment after anchor resolution. |
| `scale` | Positive uniform visual multiplier; use `size: [width, height]` only when deliberate non-uniform sizing is required. |
| `z` | Stable, explicit draw ordering number. |
| `flip_x` | Horizontal visual mirror. Do not use it to mean logical facing. |
| `id` | Optional scene-local identifier used by checked visual `connections`. |

`depth_sort: true` uses the placement anchor as the ground point within its numeric `z` band. It is appropriate for actors, trees, and props, but not for terrain. `shadow` is a small destination-space contact ellipse drawn beneath the sprite; it must not be used to compensate for a wrong anchor. Scenes fail on visible-alpha viewport clipping by default and may opt out only with `fail_on_clipping: false` for an intentional crop.

An asset's visual `clip` may represent a direction; the host's game state retains logical facing and chooses the clip/flip rule through its adapter.

## Reusable prefab classes

Prefabs bundle reviewed assets behind one stable concept. Parameters are finite and typed; scenes may omit them to use defaults.

```yaml
prefabs:
  settlement.house:
    parameters:
      size: { type: enum, values: [small, large], default: small }
      banner: { type: boolean, default: false }
    layers:
      - select: size
        variants:
          small: { asset: structure.desert-house-2, at: [0, 0], z: 0 }
          large: { asset: structure.desert-house-3, at: [0, 0], z: 0 }
      - when_parameter: banner
        asset: prop.settlement-banner
        at: [8, -24]
        z: 10
```

```yaml
placements:
  - { prefab: settlement.house, at: [120, 216] }
  - { prefab: settlement.house, params: { size: large, banner: true }, at: [330, 216] }
```

Supported parameter types are `enum` and `boolean`. `select` must cover every enum value. `when_parameter` includes a concrete layer when its parameter is `true`; `equals` may select another declared value explicitly. Layers may reference another prefab, but validation rejects missing references and composition cycles. Arbitrary expressions and JavaScript hooks are not part of this vocabulary.

## Example: reviewed actor sheet

```yaml
schema_version: 1
pack: { id: default }
assets:
  npc.farmer-bob:
    source: assets/default/actors/npcs/premade/farmer-bob.png
    source_sha256: '<sha256>'
    status: approved
    license_scope: core-commercial
    kind: sprite-sheet
    tags: [actor, npc, humanoid, farmer]
    geometry:
      layout: grid
      cell: [16, 16]
      grid: [4, 4]
    defaults:
      anchor: bottom-center
    frames:
      idle.down.0: { cell: [0, 0], tags: [idle, down] }
      walk.down.0: { cell: [0, 1], tags: [walk, down] }
      walk.down.1: { cell: [1, 1], tags: [walk, down] }
      walk.down.2: { cell: [2, 1], tags: [walk, down] }
      walk.down.3: { cell: [3, 1], tags: [walk, down] }
    clips:
      idle.down: { frames: [idle.down.0], loop: loop, fps: 1 }
      walk.down:
        frames: [walk.down.0, walk.down.1, walk.down.2, walk.down.3]
        loop: loop
        fps: 8
```

## Validation requirements

The CLI and runtime validator must reject:

- invalid/duplicate IDs, unapproved source status, missing license scope, or hash mismatch;
- source paths outside the approved private asset root;
- a frame containing both/neither `cell` and `rect`;
- grid cells or freeform rectangles outside source bounds;
- bad grid geometry, non-positive dimensions, invalid anchor, invalid scale, or opacity outside `0..1`;
- unknown frames referenced by a clip;
- mixed clip timing styles, invalid timing, or invalid loop mode;
- missing animation disposition, unreachable clips, animated frames without decoded bounds, one-frame in-place/locomotion clips, undeclared/incomplete actor facing schemes, one-shot actor/object/effect states without return/terminal semantics, stateful objects without endpoint-checked transitions, mismatched layered-animation registration, or scene-authored logical mirrors;
- visual metadata that attempts to declare collision rules, executable expressions, input bindings, scoring, or gameplay-event conditions.

## Migration compatibility

The current audit CLI accepts a simplified interim shape using `sheet` rather than `geometry`. New metadata must use this standard. Update the CLI validator to accept `geometry`, `frames`, and `clips` before the first curated runtime pack is approved; remove the interim shorthand only after catalog migration is complete.
