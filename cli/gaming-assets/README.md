# Gaming Asset Audit CLI

`cli/gaming-assets.cli.mjs` is the authoring and verification tool for the private game-art library. It preserves `sprites/` as the raw vendor source and can create a separately named canonical `assets/` copy only from an explicit, collision-free plan.

The default root is `$DAYLIGHT_BASE_PATH/media/games/_common`. Pass `--root` explicitly for fixtures, another media mount, or a temporary working copy.

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
```

Inventory records every non-hidden file with source-relative path, SHA-256, byte size, detected MIME type, modified time, source pack, nearest readme/license, and license scope. PNG records add dimensions, colour mode, alpha, and candidate square cell sizes. The optional reports directory receives separate `duplicates.yml`, `issues.yml`, and `non-images.yml` reports. Contact sheets label filename, dimensions, candidate cells, and catalog review status. Candidate frame sizes are hints only; authors must explicitly define sheet geometry and named clips.

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
  --cell 16x16 --frames '0,0;1,0;2,0;3,0' --fps 12 --scale 6 \
  --out /tmp/rain.gif
  --source 'assets/default/actors/npcs/premade/farmer-bob.png' \
  --cell 64x64 --frames '0,0;1,0;2,0;3,0' --fps 4 --scale 4 \
  --out /tmp/farmer-bob.gif
  --cell 16x16 --frames '0,0;1,0;2,0;3,0' --fps 12 --scale 6 \
  --out /tmp/rain.gif
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
terrain:
  grid: { cell: [16, 16], scale: 3 }
  regions:
    - terrain: water
      asset: terrain.desert-water-shoreline
      polarity: positive
      origin: [704, 230]
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]]
placements:
  - { prefab: settlement.house, params: { size: large }, at: [120, 216] }
  - { asset: npc.desert-person-1#idle.down, at: [350, 360], scale: 2 }
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

Scenes may add `review_regions` with a stable `id`, `[x, y, width, height]` rectangle, and integer `scale`. `scene-qa` emits those targeted assembly crops alongside the automatic quadrants; production fixtures should name every high-risk join such as a shoreline, bridge landing, fenced bed, or dock.

The independently reviewed adventure-scene fixture is reproducible without a frontend:

```bash
npm run gaming:assets -- scene \
  --catalog shared/gaming/fixtures/default-assets.yml \
  --manifest shared/gaming/fixtures/adventure-hill-scene.yml \
  --root "$DAYLIGHT_BASE_PATH/media/games/_common" \
  --out "$DAYLIGHT_BASE_PATH/media/games/_common/previews/adventure-hill-scene.png"
```

That scene uses one `world_scale`, content-aware custom ground anchors, a tiled `ground`, viewport-edge `continues` declarations, deterministic terrain variants, y-depth ordering, explicit contact shadows, and visible-alpha clipping enforcement. A render is rejected when visible pixels leave the viewport unless the scene deliberately sets `fail_on_clipping: false`.

`autotile` declares `topology: cardinal-4` and a `positive` map for a lake plus an optional `negative` map for an island. Each map names every reviewed neighbour mask (`n`, `ne`, `nes`, ..., `nesw`) or an explicit `fallback`. A fallback is acceptable only during curation and must not be used as evidence that shoreline corners are reviewed.

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
```

Color keys are strict `#rrggbb` values, not fuzzy tolerances. Catalog the generated PNG with its own pinned SHA-256 and retain the recipe beside the reviewed fixture so the derivative can be reproduced byte-for-byte.

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
