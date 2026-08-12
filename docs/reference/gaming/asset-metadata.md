# Gaming Asset Metadata Standard

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
```

Clip rules:

- Use either a clip-level `fps` with string frame IDs, or per-frame `duration_ms` objects. Do not mix them.
- `fps` is positive and may be fractional; `duration_ms` is a positive integer.
- `loop` is `loop`, `once`, or `ping-pong`; default is `loop`.
- `once` holds its final frame until its host changes state or removes the clip.
- Clips are visual timing only. They do not emit gameplay events, trigger sounds, or advance game state.

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

Scenes may tile one reviewed frame beneath all regions with `ground: terrain.grass#middle`. `ground`, terrain, structures, and actors still share one declared `world_scale`; per-placement scale overrides are reserved for reviewed exceptions.

Catalogs declare the mappings explicitly:

```yaml
autotile:
  topology: cardinal-4
  positive:
    nesw: water.center
    esw: water.edge.north
    es: water.corner.nw
  negative:
    nesw: sand.center
    esw: sand.edge.north
    es: sand.corner.nw
```

Every mask that an authored region may produce must be declared, or `fallback` may be used only while a pack remains in curation.

Cardinal masks use stable `n/e/s/w` order; `isolated` names a cell with no cardinal neighbours. Thin routes may explicitly map `n`, `e`, `s`, `w`, `ns`, and `ew`, but those mappings are asset capabilities—not permission to author concave shapes when the reviewed sheet has no inner-corner art.

Opaque-backed effects must not be placed over tinted or translucent terrain. Derive an exact color-keyed transparent overlay atlas with the CLI, retain its YAML recipe, and pin the generated file's hash like any other runtime asset.

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
- visual metadata that attempts to declare collision rules, executable expressions, input bindings, scoring, or gameplay transitions.

## Migration compatibility

The current audit CLI accepts a simplified interim shape using `sheet` rather than `geometry`. New metadata must use this standard. Update the CLI validator to accept `geometry`, `frames`, and `clips` before the first curated runtime pack is approved; remove the interim shorthand only after catalog migration is complete.
