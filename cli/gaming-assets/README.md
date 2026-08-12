# Gaming Asset Audit CLI

`cli/gaming-assets.cli.mjs` is the authoring and verification tool for the private game-art library. It preserves `sprites/` as the raw vendor source and can create a separately named canonical `assets/` copy only from an explicit, collision-free plan.

The default root is `$DAYLIGHT_BASE_PATH/media/games/_common`. Pass `--root` explicitly for fixtures, another media mount, or a temporary working copy.

Production catalogs, scenes, recipes, and QA manifests belong under that mounted root's `catalog/` directory. They are data, not repository fixtures; Git contains the compiler, validators, renderers, and mount-aware tests only.

## Audit loop

```bash
# Generate a source-of-facts inventory (explicit output; no source writes).
npm run gaming:assets -- inventory \
  --out "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/generated/inventory.yml" \
  --reports-dir "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/generated"

# Browse source art as a deterministic PNG contact sheet.
npm run gaming:assets -- sheet \
  --out /tmp/default-terrain.png --source assets/default/environment/tiles \
  --catalog /path/to/catalog/default.yml --columns 6

# Validate a curated manifest against source files, hashes, geometry, and clips.
npm run gaming:assets -- validate \
  --manifest "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/default.yml"

# Re-run the fail-closed terrain/topology capability sweep.
npm run gaming:assets -- terrain-sweep \
  --manifest "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/terrain-metadata-sweep.yml"
```

Inventory records every non-hidden file with source-relative path, SHA-256, byte size, detected MIME type, modified time, source pack, nearest readme/license, and license scope. PNG records add dimensions, colour mode, alpha, and candidate square cell sizes. The optional reports directory receives separate `duplicates.yml`, `issues.yml`, and `non-images.yml` reports. Contact sheets label filename, dimensions, candidate cells, and catalog review status. Candidate frame sizes are hints only; authors must explicitly define sheet geometry and named clips.

`terrain-sweep` verifies the curated topology backlog against the canonical tree. Every PNG below a `tiles/` directory must be assigned to a reviewed family or match an explicit non-topology exclusion; a newly added, unclassified tile sheet makes the command fail. It also measures topology sheets found outside `tiles/`, including sewer, autumn, legacy cave, interior-wall, fence, and bridge systems. `cataloged` families name approved, hash-pinned evidence whose provenance points back to measured sources. `quarantined` families name deferred entries and explicitly remain unavailable at runtime.

## Unit previews

Measure a suspected sheet before declaring its frame geometry. This emits a labeled frame grid, so sparse atlases and non-square cells are apparent:

```bash
npm run gaming:assets -- frames \
  --source 'assets/default/actors/npcs/premade/farmer-bob.png' \
  --cell 64x64 --out /tmp/farmer-bob-grid.png --scale 4
```

Render a human-confirmed animation clip from a raw sheet:

```bash
npm run gaming:assets -- animate \
  --source 'assets/default/actors/npcs/premade/farmer-bob.png' \
  --cell 64x64 --frames '0,0;1,0;2,0;3,0' --fps 4 --scale 4 \
  --out /tmp/farmer-bob.gif
```

The result is an animated GIF with nearest-neighbour scaling. The tool fails when a requested frame is outside the source sheet.

## Assembly previews

`render` composes a small, raw-source layout before prefabs or application UI exist:

```yaml
# /tmp/meadow-layout.yml
viewport: [320, 180]
background: '#83d2ee'
sprites:
  - source: assets/default/environment/tiles/grass/grass-1-middle.png
    cell: [16, 16]
    frame: [0, 0]
    at: [0, 132]
    scale: 3
  - source: assets/default/actors/npcs/premade/farmer-bob.png
    cell: [16, 32]
    frame: [1, 0]
    at: [96, 96]
    scale: 3
```

```bash
npm run gaming:assets -- render --manifest /tmp/meadow-layout.yml --out /tmp/meadow.png
```

This is intentionally a tiny pre-prefab assembly format. It tests source paths, crop geometry, pixel scaling, and composition before a host application is involved.

## Semantic scenes and prefabs

Use `scene` for framework scenes. A scene never carries a source path or a sheet cell: it names approved catalog frames and prefabs. Terrain regions carry logical cells; the catalog owns the neighbour-mask-to-frame mapping.

```yaml
# scene.yml
viewport: [960, 540]
background: '#dca66b'
world_scale: 3
require_explicit_pixel_density: true
enforce_uniform_pixel_scale: true
terrain:
  grid: { cell: [16, 16] }
  regions:
    - terrain: water
      asset: terrain.desert-water-shoreline
      polarity: positive
      origin: [704, 230]
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]]
placements:
  - { prefab: settlement.house, params: { size: large }, at: [120, 216] }
  - { asset: npc.desert-person-1#idle.down, at: [350, 360] }
```

```bash
npm run gaming:assets -- scene --catalog /path/to/desert.yml \
  --manifest /path/to/scene.yml --out /tmp/desert.png
```

Before publishing, generate the production-review bundle. It renders the same scene once, then writes a half-size thumbnail and four nearest-neighbor 2× quadrants so joins, baked backgrounds, anchors, and one-pixel seams cannot hide in a whole-scene glance:

```bash
npm run gaming:assets -- scene-qa --catalog /path/to/desert.yml \
  --manifest /path/to/scene.yml --root /path/to/_common \
  --out-dir /tmp/desert-scene-qa
```

The report includes `inside_corners_resolved`. This is the number of concave path/shoreline corners selected through diagonal metadata; unsupported inside corners abort rendering and therefore can never be counted as resolved. It also includes `resolution_audit`, which records every asset's declared source `pixel_density`, the scene pixel scale, normalized draws, and non-uniform scale draws. Production scenes should set both `require_explicit_pixel_density: true` and `enforce_uniform_pixel_scale: true` so a layout cannot hide a mismatched source resolution with ad hoc placement scaling.

Gate a whole scene collection with one reproducible command:

```bash
npm run gaming:assets -- scene-qa-set \
  --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase/scenes.yml \
  --out-dir /tmp/showcase-scenes
```

A `scene-qa-set` manifest names one relative catalog, each scene's stable ID, theme, and relative manifest, plus fail-closed requirements. It can require a minimum scene count, named themes, review regions per scene, zero clipping, a warning-free catalog, minimum resolved inside corners and checked connections, and coverage of the terrain, connector, height, and component systems. The output contains every normal scene QA bundle, `report.yml`, a labeled full-scene `montage.png`, and a consolidated `review-montage.png` of all authored high-risk crops. The report pins a SHA-256 for every generated PNG so later runs can distinguish intentional visual changes from renderer drift.

Production suites should also name an independent approved-artifact manifest and require it:

```yaml
baseline: approved-artifacts.yml
requirements:
  require_approved_artifacts: true
```

Normal QA never updates that baseline. It verifies the approved PNG files themselves, compares the exact artifact path set and SHA-256 values, writes red pixel-diff images under `diffs/`, and fails if an artifact is missing, unexpected, changed, or no longer matches its own baseline hash. After a human has reviewed an intentional complete QA run, promote it with the separate command:

```bash
node cli/gaming-assets.cli.mjs scene-qa-approve \
  --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase-v2/scenes.yml \
  --report /path/to/_common/previews/qa/showcase-v2/report.yml \
  --artifacts-dir /path/to/_common/previews/baselines/showcase-v2
```

Approval re-hashes the completed report's artifacts before copying them and writes a portable relative baseline manifest. Keep this command outside regeneration scripts: review, approval, and comparison are deliberately separate operations.

Scenes may add `review_regions` with a stable `id`, `[x, y, width, height]` rectangle, and integer `scale`. `scene-qa` emits those targeted assembly crops alongside the automatic quadrants; production fixtures should name every high-risk join such as a shoreline, bridge landing, fenced bed, or dock. Structural pieces may additionally declare frame `ports`, placement `id` values, and scene `connections`; rendering fails when connected ports do not resolve to the same world-space point. `requires_all_ports: true` additionally rejects every unconnected or multiply connected structural port. Assets tagged `ground-contact` fail catalog validation unless each frame's custom anchor lands exactly at its measured visible-alpha bottom and the silhouette retains transparent source-frame padding on every side.

The independently reviewed adventure-scene fixture is reproducible without a frontend:

```bash
npm run gaming:assets -- scene \
  --catalog "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/default.yml" \
  --manifest "$DAYLIGHT_BASE_PATH/media/games/_common/catalog/scenes/adventure-hill-scene.yml" \
  --root "$DAYLIGHT_BASE_PATH/media/games/_common" \
  --out "$DAYLIGHT_BASE_PATH/media/games/_common/previews/adventure-hill-scene.png"
```

That scene uses one `world_scale`, content-aware custom ground anchors, a tiled `ground`, viewport-edge `continues` declarations, deterministic terrain variants, y-depth ordering, explicit contact shadows, and visible-alpha clipping enforcement. A render is rejected when visible pixels leave the viewport unless the scene deliberately sets `fail_on_clipping: false`.

`autotile` declares `topology: cardinal-4` for simple shapes or `cardinal-4+diagonal-corners` for bends and junctions, with a `positive` map for a lake plus an optional `negative` map for an island. Each map names every reviewed neighbour mask (`n`, `ne`, `nes`, ..., `nesw`) or an explicit `fallback`. Diagonal topology additionally requires `inner_corners`; a cell with a missing shared diagonal fails instead of silently rendering a square center tile. A fallback is acceptable only during curation and must not be used as evidence that shoreline corners are reviewed.

Run exhaustive unit evidence before promotion:

```bash
npm run gaming:assets -- topology-qa-set --root /path/to/_common \
  --catalog /path/to/_common/catalog/terrain-autotiles.yml --out-dir /tmp/topology
npm run gaming:assets -- connector-qa-set --root /path/to/_common \
  --catalog /path/to/_common/catalog/fence-connectors.yml --out-dir /tmp/connectors
npm run gaming:assets -- height-qa-set --root /path/to/_common \
  --catalog /path/to/_common/catalog/terrain-heights.yml --out-dir /tmp/heights
npm run gaming:assets -- component-qa --root /path/to/_common \
  --catalog /path/to/_common/catalog/terrain-components.yml \
  --asset components.volcano.atlas --out /tmp/volcano-components.png
```

Topology QA renders every cardinal mask, both declared polarities, all fifteen compound concavities, and every temporal phase. Connector matrices mark measured ports; height matrices assemble ordered bands; component matrices expose each mixed-atlas subsystem.

Reproducible normalization regenerates PNGs and catalog hashes together:

```bash
npm run gaming:assets -- derive-blob-catalog --root /path/to/_common \
  --manifest /path/to/_common/catalog/recipes/terrain-blob-atlases.recipe.yml \
  --catalog-out /path/to/_common/catalog/terrain-autotiles.yml
npm run gaming:assets -- derive-fence-catalog --root /path/to/_common \
  --manifest /path/to/_common/catalog/recipes/fence-connectors.recipe.yml \
  --catalog-out /path/to/_common/catalog/fence-connectors.yml
```

Raw vendor files are never modified.

Inspect and render reusable prefab classes without a frontend:

```bash
npm run gaming:assets -- prefab-explain --root /path/to/_common \
  --catalog /path/to/desert.yml --id settlement.house --params size=large
npm run gaming:assets -- prefab-render --root /path/to/_common \
  --catalog /path/to/desert.yml --id settlement.house --params size=large \
  --viewport 320x240 --scale 2 --out /tmp/desert-house-large.png
```

Use `derive` only when a source needs a reproducible, explicitly recorded atlas crop; it never modifies source art. An optional exact `transparent_colors` list removes opaque backing colors after all layers are composed, which is useful for water/effect overlays that must work over a tinted terrain render:

```yaml
# shoreline-derivation.yml
canvas: [48, 48]
transparent_colors: ['#0095e9']
layers:
  - source: assets/desert/tiles/desert-water-tiles-1.png
    rect: [48, 0, 48, 48]
    at: [0, 0]
    size: [48, 48] # optional nearest-neighbour destination size
```

Color keys are strict `#rrggbb` values, not fuzzy tolerances. A layer's optional `size` resamples its source rectangle with nearest-neighbour scaling, which is useful for scale-correct pixel-art join silhouettes. Catalog the generated PNG with its own pinned SHA-256 and retain the recipe beside the reviewed fixture so the derivative can be reproduced byte-for-byte.

```bash
npm run gaming:assets -- derive --root /path/to/_common \
  --recipe shoreline-derivation.yml --out /tmp/shoreline-water.png
```

## Canonical-tree migration

Generate and inspect the plan first. `organize-apply` refuses plans with collisions and copies only PNGs; it is idempotent and preserves every file under `sprites/`.

```bash
npm run gaming:assets -- organize-plan --source sprites --target assets --out /tmp/gaming-organization.yml
npm run gaming:assets -- organize-apply --plan /tmp/gaming-organization.yml
npm run gaming:assets -- organize-verify --plan /tmp/gaming-organization.yml
```

The generated hierarchy uses pack roots (`default`, `characters`, `desert`, `dungeons`, `free`, `halloween`, `ui`, `volcano`, `legacy-unclassified`) and normalized kebab-case semantic folders. The plan retains the original source path, byte size, SHA-256, and source-derived license scope for later catalog provenance. `organize-verify` is read-only and proves every destination still matches its reviewed raw source.

## Curated manifest format

Production scene work uses strict Presentation V2. See the [Presentation Framework V2 reference](../../docs/reference/gaming/presentation-framework-v2.md). The v1 format below remains documented for raw-asset audit and mounted migration sources; it is not the production scene contract.

```bash
node cli/gaming-assets.cli.mjs migrate-v2 --root /path/to/_common \
  --catalog /path/to/_common/catalog/showcase/showcase-assets.yml \
  --scenes /path/to/_common/catalog/showcase/showcase-scenes \
  --out-dir /tmp/presentation-v2

node cli/gaming-assets.cli.mjs scene-qa-set --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase-v2/scenes.yml \
  --out-dir /tmp/presentation-v2-qa
```

Migration is read-only with respect to v1 inputs. Its output includes an unresolved report and is rejected unless the strict catalog and every generated scene validate.

When `--root` is available, migration decodes every isolated approved frame and records its exact visible-alpha edge contacts in v2 metadata. The Node renderer independently remeasures those contacts, so stale hashes, stale bounds, or undeclared edges still fail the visual gate.

The same measurement populates exact `content_bounds` and checks each frame against its style profile's semantic `scale_class`. Production v2 forbids `world.visual_scale`; normalization must come from source geometry plus `pixel_density`, so an asset cannot pass QA by enlarging already-normalized pixels.

Generated v2 style profiles also carry production composition limits. `scene-qa-set` enforces placement-sector use, visible placement coverage, walkable connectivity, and repeated-placement dominance for every scene, then records the suite envelope in `report.yml`. Terrain fills, interface tiles, connectors, heights, and component tiling remain topology evidence and do not inflate subject coverage.

V2 scenes may replace long literal cell/coordinate dumps with deterministic `rounded-rect`, `ellipse`, `blob`, and `route` terrain shapes plus seeded semantic placement groups. `exclude` performs boolean subtraction for islands, lakes, moats, and clearings; declared `continues` edges may clip a semantic shape at the viewport without hand-authoring its boundary cells. Zones filter materials, surfaces, planes, biomes, boundaries, and adjacent materials; groups choose balanced candidates using `center`, `cluster`, `scatter`, or `grid` layout. The compiler fails closed on clipping, forbidden surfaces, visual/structural overlap, or an unfulfillable count. Routes may terminate at a named placement so roads remain attached to landmarks. QA also records role diversity/dominance and can require `minimum_semantic_scenes`.

Assets/prefabs declare `world.allowed_surfaces`; bridges and docks may set `world.provides_surface: solid`, and component profiles may replace the effective surface for pools or hazards. Color materials render as explicit fill commands. Bordered components can use a distinct `interior` frame, and fill variants are selected deterministically without immediate horizontal or vertical wallpaper repetition.

The canonical mounted v2 suite additionally requires an approved visual baseline. Its baseline manifest lives with the mounted YAML catalog and its reviewed PNGs live under the mounted preview baseline tree; neither belongs in Git fixtures.

For an intentional visual revision, render a fully gated review candidate before explicit promotion:

```bash
node cli/gaming-assets.cli.mjs scene-qa-set --root /path/to/_common \
  --manifest /path/to/_common/catalog/showcase-v2/scenes.yml \
  --out-dir /path/to/reviewed-qa \
  --candidate true
```

Candidate mode bypasses only comparison with the old approved pixels. It does not bypass validation, deterministic compilation, composition limits, clipping checks, or artifact hashing. Pass its valid `report.yml` to `scene-qa-approve`, then rerun ordinary `scene-qa-set` to prove the new baseline matches.

The validator implements the shared [asset metadata standard](../../docs/reference/gaming/asset-metadata.md):

```yaml
schema_version: 1
pack: { id: default }
assets:
  npc.farmer-bob:
    source: assets/default/actors/npcs/premade/farmer-bob.png
    source_sha256: '<from inventory.yml>'
    status: approved
    license_scope: core-commercial
    kind: sprite-sheet
    geometry: { layout: grid, cell: [64, 64], grid: [6, 13] }
    frames:
      idle.down.0:
        cell: [0, 0]
        content_bounds: [23, 19, 17, 22]
        anchor: { point: [32, 41] }
      idle.down.1:
        cell: [1, 0]
        content_bounds: [23, 19, 17, 22]
        anchor: { point: [32, 41] }
    clips:
      idle.down: { frames: [idle.down.0, idle.down.1], fps: 4 }
```

Approved assets must supply a matching source hash, `kind`, geometry, and named frames. `content_bounds` records the exact visible-alpha rectangle inside a padded frame; validation decodes the source and rejects stale values. Custom actor anchors use the reviewed ground-contact point rather than the padded cell edge. Clip frames refer only to named frames. Candidate/deferred/rejected entries may be recorded before their geometry is known, but they cannot become runtime assets later until approved.

## Command safety

- `inventory`, `sheet`, `frames`, `animate`, and `render` write only to their explicit `--out` destination.
- `organize-plan` writes only the explicit plan; `organize-apply` only copies files named in that plan and never changes raw `sprites/`.
- `validate` is read-only and exits `1` for catalog failures; invocation errors exit `2`.
- Every asset path is resolved beneath `--root`; traversal outside the private game-media root is rejected.
- Raw art is never moved, renamed, recompressed, or overwritten by this tool.
