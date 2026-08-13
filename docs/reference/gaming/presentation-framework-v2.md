# Presentation Framework V2

Presentation V2 is the reusable visual layer for RPG-style worlds and future side-scroller, fixed-grid, and text modes. It is neutral infrastructure under `shared/presentation`; Piano, Fitness, School, and Gaming are hosts, not dependencies of the renderer.

The production contract is strict `schema_version: 2`. V1 files are accepted only by the explicit, read-only migration adapter and the legacy CLI renderer. They are not valid production presentation inputs.

Use `scene-legacy` only for regression evidence. The normal `scene` command rejects v1 rather than auto-upgrading or silently retaining old escape hatches.

## Architecture

```text
catalog YAML + scene YAML
          |
          v
shared/presentation compiler
  - validates metadata
  - builds material/elevation grids
  - resolves edge/corner topology
  - expands connectors, heights, components, and prefabs
  - validates footprints, surfaces, boundaries, and solid overlap
  - generates shadows and deterministic depth order
          |
          v
immutable presentation-draw-plan
          |
          +-- Node Canvas -> PNG/QA artifacts
          +-- browser Canvas -> SceneSurface
```

The plan contains logical geometry, stable asset/frame IDs, ordered draw commands, and diagnostics. It never contains filesystem paths, URLs, game rules, input devices, or host-specific state.

## Catalog vocabulary

Every approved asset declares exact source geometry, named frames, `pixel_density`, `style_profile`, and world metadata. High-density art is reduced to the style profile's logical raster with nearest-neighbor sampling. Neither scenes nor assets may apply a second visual-scale multiplier: larger objects need appropriately sized normalized source geometry, preventing pixel grain from silently changing between actors, trees, and buildings.

Each style profile also owns reusable `scale_classes` such as `humanoid`, `creature`, `building`, `building-small`, `foliage`, and `terrain`. An asset declares `world.scale_class`; migration measures visible alpha for every isolated frame, and both catalog validation and Node QA reject normalized content outside the class's logical-height range. These are pack-wide semantic ranges, not scene-specific scale exceptions.

```yaml
schema_version: 2
kind: presentation-catalog
pack: { id: village, style_profile: pixel16.topdown, logical_cell: [16, 16] }
style_profiles:
  pixel16.topdown:
    logical_cell: [16, 16]
    sampling: nearest
    base_pixel: 1
    palette_family: default
    scale_classes:
      humanoid: { logical_height: [12, 36] }
      terrain: { logical_height: [1, 64] }
    composition:
      sector_grid: [3, 3]
      minimum_occupied_sectors: 4
      visual_coverage: [0.1, 0.5]
      minimum_navigation_connectivity: 0.75
      maximum_repeat_ratio: 0.5
      minimum_role_diversity: 3
      maximum_role_ratio: 0.75
shadow_profiles:
  soft-small: { size: [8, 3], offset: [0, 1], color: '#000000', opacity: 0.22 }
materials:
  material.grass:
    style_profile: pixel16.topdown
    plane: ground
    biome: temperate
    surface: solid
    fill_mode: solid
    fill: { asset: terrain.grass, frame: middle }
  material.water:
    style_profile: pixel16.topdown
    plane: ground
    biome: temperate
    surface: liquid
    fill: { asset: terrain.water, frame: base.nesw }
terrain_interfaces:
  interface.water-to-grass:
    inside: material.water
    outside: material.grass
    asset: terrain.water
    polarity: positive
    transition_band: { minimum_changed_ratio: 0.25 }
assets:
  npc.farmer:
    source: assets/default/actors/farmer.png
    source_sha256: '<sha256>'
    status: approved
    license_scope: core-commercial
    kind: sprite-sheet
    tags: [actor, npc]
    pixel_density: 1
    style_profile: pixel16.topdown
    geometry: { layout: grid, cell: [32, 32], grid: [4, 4] }
    world:
      footprint: { size: [8, 4] }
      allowed_materials: [material.grass]
      allowed_surfaces: [solid]
      allowed_planes: [ground]
      allowed_biomes: [temperate]
      boundary_policy: forbid
      render_layer: actor
      collision: solid
      shadow_profile: soft-small
    frames:
      idle.down: { cell: [0, 0], anchor: { point: [16, 27] }, content_bounds: [9, 5, 13, 22] }
```

Terrain interfaces own boundary selection. A scene names materials only; it cannot name a corner or shoreline frame. At a multi-material join, every applicable interface must resolve to the same reviewed asset/polarity or compilation fails as ambiguous. Off-screen continuation is explicit and validated against the edge it claims to touch.

`fill_mode` distinguishes complete terrain from sparse decoration. It defaults to `solid`; QA decodes every solid fill and requires the entire logical cell to be opaque. `overlay` requires both visible and transparent pixels and is forbidden as a scene base or terrain region—overlay art belongs in a component or placement layer above a real material. This prevents a perforated planting or fringe frame from silently masquerading as soil or ground.

Interfaces that declare `transition_band.minimum_changed_ratio` are decoded against their outside material on all four cardinal half-cell bands. QA fails if a selected north/east/south/west edge does not visibly differ enough from the outside fill. Correct topology is necessary but not sufficient: a shoreline whose bank palette disappears into its grass cannot pass as a reviewed transition.

The converse is also required: any opaque landward fill baked into an interface must match the receiving outside material. A full-cell bank color that differs from the field creates an unresolved second boundary even when the waterline mask is correct. Normalize that baked fill with a hash-pinned derivation, or use a genuinely transparent fringe; scenes must not author a compensating terrain halo.

Palette compatibility belongs to the material pair, not to the water material globally. A target-specific interface asset may `extend` the canonical source asset and override its generated PNG, hash, tags, and provenance. The inherited geometry, masks, corner semantics, animation, scale, and world policy cannot drift between variants, while different outside materials can receive different exact palette mappings.

At a multi-material junction, the compiler accepts distinct interface assets only when they share one inherited asset root, identical pixel density/geometry/frames/autotile metadata, and one polarity. It renders the canonical topology once, then clips alternate target-palette variants into deterministic cardinal contact wedges (and corner quadrants for diagonal concavities). Thus a water cell can meet path and grass without choosing one receiving palette for the whole tile. Unrelated assets, divergent topology, or mixed polarity remain hard errors.

Interfaces may additionally declare `corner_profile: { style: rounded, minimum_cutback_ratio: 0.25 }`. The referenced autotile must advertise the same reviewed `outer_corner_style`, and QA decodes all four convex masks. Each turn is compared with the center frame inside the quadrant that would otherwise remain square; insufficient pixel cutback fails the bundle. The derivation recipe separately records whether the turn was quarter-composed or copied from a native full-cell corner, preventing provenance from being confused with appearance.

Connector, height, and component profiles provide the same indirection for fences, walls, bridges, cliffs, floors, and borders. Compound prefabs own a footprint, boundary policy, collision policy, and declared slots in addition to their layers and finite parameters. V2 forbids layer and placement `scale`, `z`, `depth_sort`, and hand-authored shadows.

Connector derivation is measured metadata, not a universal source-layout assumption. Recipes may declare `top_corner_row_offset` when a sheet places top corners below a cap row; seam-extension metadata repairs transparent edge pixels separately. Connector QA must prove each corner is a continuous two-axis piece before a derived atlas is approved.

Terrain derivation likewise supports measured `outer_stride` for non-contiguous 3×3 source blocks, `outer_corner_mode: native` for sheets whose full-cell hand-drawn turns carry detail across the quadrant seam, and exact `color_map` substitutions for palette normalization. This keeps all-cardinal interface geometry and biome palette decisions reproducible without modifying vendor art; topology and decoded corner-profile QA remain mandatory after any operation.

Materials may declare deterministic visual detail without requiring every scene to enumerate cells:

```yaml
details:
  - profile: components.water-ripples
    density: 0.2
    seed: 41
    interior_only: false
```

Each entry references a decoration-style component profile whose allowed surfaces include the material surface. `density` is a reproducible per-cell selection rate, `seed` changes the stable distribution, and `interior_only: true` limits opaque texture variants to cells surrounded on all four sides by the same material. Outline components are rejected because their topology belongs to terrain interfaces, not material detail.

Component profiles may declare `opacity` in `(0, 1]`. The compiler applies it uniformly to authored component regions and automatic material details, which permits texture atlases to harmonize with a material palette without scene-level draw overrides.

Component profiles may also declare `interior_only: true`. Every authored component cell must then have the same material on all four cardinal sides and may not touch the viewport edge. Use this for ripples, floor speckles, and other full-cell overlays whose pixels must never cross an autotiled interface wedge even though the logical cell still belongs to the source material.

A component role is approved only after its frames assemble into the named object. Grid adjacency is not evidence that thin source fragments form a curb, railing, or enclosure. Profiles whose assembly lacks thickness, caps, posts, or terminations must remain unexposed until corrected art or a reproducible derived assembly exists.

A mixed component atlas may also expose reviewed height bands when the same source sheet contains a curb or face course. Register that asset through `height_interfaces` and let the height compiler select left/middle/right frames across the authored span; raised platforms should not be simulated with shadows or per-scene z offsets. A height spanning through a viewport edge declares `continues: [west, east]` for a north/south transition, or `[north, south]` for an east/west transition. Continued ends select the seamless middle frame instead of a transparent or terminating cap, so a full-width ridge cannot expose the base material at either edge.

## Scene vocabulary

All authored coordinates are logical. `pixel_scale` controls only final viewport magnification.

```yaml
schema_version: 2
kind: top-down-scene
id: lakeside-task
catalog: village
style_profile: pixel16.topdown
logical_size: [320, 192]
pixel_scale: 2
grid: { cell: [16, 16] }
terrain:
  base: material.grass
  regions:
    - id: lake
      material: material.water
      rects: [[12, 1, 8, 3], [11, 4, 9, 3]]
      continues: [east]
placements:
  - { id: farmer, asset: npc.farmer, frame: idle.down, at: [120, 96] }
  - { id: home, prefab: settlement.house, params: { size: small }, at: [220, 88] }
```

The compiler produces complete material, effective-surface, elevation, and structural-occupancy grids; rejects overlapping terrain authorship; enforces footprints and material/surface constraints; detects solid-object overlaps; generates catalog-owned shadows; and sorts world objects by render pass and ground-contact Y. Connector cells contribute exact world-space occupied rectangles even when a connector uses a half-cell origin; authored placements, generated groups, and nested prefab children may not intersect them. Every asset and prefab declares `world.allowed_surfaces`. Bridges and docks may declare `world.provides_surface: solid`, while hazards or pools may provide `liquid`; later placement and navigation checks use that effective surface rather than guessing from pixels. Actors and structures share the same world-depth pass, so a tree or house does not sit permanently above every character.

The style profile also owns the production composition grammar. QA measures occupied screen sectors and visible logical-grid coverage from authored placement content only, so repeated terrain fills and tiled floors cannot make an empty room pass. It also measures the largest connected walkable component after excluding liquid/void materials and solid footprints, plus the dominance of the most repeated placement frame. These limits are pack-wide rather than scene-specific.

## Semantic landscape and composition authoring

Literal `cells` and `rects` remain available for exact maps, but production scenes can describe terrain with deterministic shapes:

```yaml
terrain:
  base: material.grass
  regions:
    - id: road
      material: material.path
      shapes:
        - kind: route
          points: [[0, 9], [9, 9], { placement: hall }]
          width: 2
    - id: lake
      material: material.water
      shapes:
        - { kind: blob, center: [17, 6], radius: [2, 5], roughness: 0.45, seed: 29 }
      exclude:
        shapes:
          - { kind: ellipse, center: [17, 6], radius: [1, 2] }
      continues: [east]
```

`rounded-rect`, `ellipse`, `blob`, and `route` expand to ordinary material cells before topology resolution, so edge and inner-corner metadata remains the sole authority for sprite selection. A blob may declare `edge_step: 1..4`; forward and reverse constraint passes bound how far each left/right edge can move between adjacent rows. A terrain region may additionally declare `minimum_thickness: 1..4`; after viewport clipping, deterministic row/column passes grow undersized contiguous runs toward the region center while preserving explicit exclusions. This prevents a one-cell water fringe from selecting opposing shoreline layers that conceal the liquid. `exclude` subtracts cells, rectangles, or shapes, which supports islands, lakes, moats, clearings, and cave-water inversions without enumerating coordinates. A shape may cross the east or south viewport edge only when its region declares that side in `continues`; the compiler clips the off-screen portion while still requiring the in-view material to touch the declared edge. Route placement references resolve to the named placement's ground-contact grid cell, keeping roads attached when a landmark moves.

Color-backed materials are emitted as explicit renderer-neutral fill commands; the scene clear color is never accepted as terrain. Component profiles may provide a replacement logical surface, may define a separate `interior` frame for bordered pools, and choose fill variants deterministically while avoiding immediate north/west repetition. Render layers remain catalog metadata: base floors belong below connector and structure layers rather than relying on scene command order.

Reusable placement groups distribute authored candidates inside semantic zones:

```yaml
composition:
  seed: 20260812
  zones:
    shoreline:
      rects: [[14, 0, 6, 12]]
      materials: [material.water]
      boundary: true
      adjacent_materials: [material.grass]
  groups:
    - id: shoreline-life
      role: detail
      zone: shoreline
      layout: scatter
      count: 3
      minimum_distance: 2
      visual_fit: anchor
      overlap: allow
      candidates:
        - { asset: prop.cattails, frame: still }
        - { asset: prop.water-rock, frame: still }
```

Zones may filter material IDs, surfaces, planes, biomes, boundary status, and adjacent materials. Groups support `center`, `cluster`, `scatter`, and `grid` layouts; weighted candidates are balanced before repetition. The solver rejects viewport clipping, occupied footprints, disallowed material/plane/biome combinations, structural connector/height/component overlap, visible bounds outside the zone, and unfulfillable counts. `visual_fit: anchor` and `overlap: allow` are explicit tools for reviewed boundary overlays—not silent fallbacks.

Every placement/group carries a semantic role (`focal`, `support`, `detail`, `actor`, `reward`, or `hazard`). Style-profile QA enforces role diversity and maximum role dominance in addition to screen use, coverage, repetition, and navigation. Acceptance suites can require `minimum_semantic_scenes`, ensuring the generator itself remains exercised by canonical renders.

## Host and mode contracts

`SceneSurface` is the browser Canvas executor. Hosts load `/api/v1/presentation/catalogs/:packId`, compile locally with the shared pure compiler, and render the returned plan without image smoothing. The Node CLI executes the same commands and pins the plan hash in QA output.

Input is upstream of presentation. Keyboard, touch D-pad, Bluetooth gamepad, piano keys, or a Fitness sensor adapter emits semantic actions such as `move.north`, `action.primary`, or context-specific `challenge.*`. Context-owned challenge providers expose lifecycle/snapshot methods and can translate a scale, heart-rate target, lesson task, or school challenge into game progress without coupling those domains to the renderer.

Top-down is the implemented adapter. `side-scroller-scene`, `fixed-grid-scene`, and `text-scene` are reserved contracts and fail explicitly until their compilers exist; consumers cannot silently fall through to top-down assumptions.

## Migration and acceptance

Create reviewed v2 candidates without modifying v1 inputs:

```bash
node cli/gaming-assets.cli.mjs migrate-v2 --root /path/to/_common \
  --catalog /path/to/_common/catalog/showcase/showcase-assets.yml \
  --scenes /path/to/_common/catalog/showcase/showcase-scenes \
  --out-dir /tmp/presentation-v2
```

Migration measures isolated frames against the hash-pinned PNG and emits exact `edge_contact.allowed` sides. Runtime QA decodes the PNG again and rejects any contact not represented by that metadata. Tile sheets and topology systems instead declare `edge_policy: seamless`; standalone sprites remain `isolated`.

Run the production showcase gate:

```bash
node cli/gaming-assets.cli.mjs scene-qa-set --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase-v2/scenes.yml \
  --out-dir /tmp/presentation-v2-qa
```

Promotion requires all required themes, deterministic plan hashes, zero clipping, zero per-scene scale exceptions, valid pinned source hashes, opaque solid material fills, visible declared transition bands, connector/placement separation, required terrain/connector/height/component/shadow coverage, style-profile composition compliance, and review crops. Passing these systemic gates means the framework contract is sound; aesthetic scene arrangement remains a separate art-direction review.

### Approved visual artifacts

A production suite sets `baseline` to a relative `presentation-artifact-baseline` YAML manifest and enables `requirements.require_approved_artifacts`. The baseline manifest maps every expected PNG path to a SHA-256 and points to a separate mounted artifact root. QA independently verifies those stored PNGs before comparing them with the newly rendered set; this detects baseline-file drift as well as renderer drift.

`scene-qa-set` cannot update the baseline. On any missing, unexpected, or changed artifact it records the regression in `report.yml`, emits a red pixel-diff PNG under the QA output's `diffs/` directory, and fails. The only promotion path is an explicit reviewed command:

```bash
node cli/gaming-assets.cli.mjs scene-qa-set --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase-v2/scenes.yml \
  --out-dir /path/to/reviewed-qa \
  --candidate true

node cli/gaming-assets.cli.mjs scene-qa-approve --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase-v2/scenes.yml \
  --report /path/to/reviewed-qa/report.yml \
  --artifacts-dir /path/to/_common/previews/baselines/showcase-v2
```

Candidate mode still runs every catalog, compilation, composition, clipping, determinism, and artifact-hash gate; it only marks the intentional visual delta as reviewable instead of comparing it with the old baseline. Approval accepts only a valid completed report, re-hashes every source PNG before copying, and writes portable relative paths. A normal non-candidate run must then match the promoted baseline exactly. Catalog YAML and approved pixels remain in mounted media; Git contains the framework and adversarial approval/regression tests only.

Terrain QA counts diagonal concavities only when the compiler actually selects their reviewed inner-corner layers. A cell with four matching cardinal neighbors is not automatically interior: missing diagonals are resolved before the fill fast-path. Connector counts similarly represent unique graph adjacencies, not merely the number of connector tiles drawn.

The current exhaustive topology run covers 67 approved autotile assets, 3,528 polarity/mask/corner cases, and 1,177 compound inner-corner cases. Fallback-only legacy declarations and incomplete negative-polarity maps are stripped during migration instead of being counted as reviewed topology.

Canonical catalogs, scenes, migration inputs, recipes, and QA manifests live under `$DAYLIGHT_BASE_PATH/media/games/_common/catalog/`. Git contains framework code and tests, but no duplicate production catalog tree. The mounted v1 showcase remains under `catalog/showcase/`; strict production v2 lives under `catalog/showcase-v2/`.
