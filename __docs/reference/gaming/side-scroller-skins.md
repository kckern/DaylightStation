# Side-scroller skins

A game-independent pixel-art system for side-scrolling games, built on the
`gaming-assets` library (`__capabilities/gaming/cli/gaming-assets/`). Art lives
once in the library, the catalog names and validates every asset, a game
publishes the slots it can draw, and a **skin** says which assets fill them.
Skyline Glider is the first game to use it.

```text
media/games/_common/
  sprites/<pack>/            raw vendor sources, untouched, with PROVENANCE.yml
  assets/side-scroller/...   derived sources (keyed transparent copies of ripper sheets)
  catalog/<pack>.yml         catalog: every asset's source, hash, geometry, frames, clips, licence
  catalog/skins/<game>/*.yml skins: slot → catalog asset
        │
        │  gaming-assets skin-export (validates first; fails closed)
        ▼
media/<game folder>/<zone>/  images/*.png, sprites/sheet.png + sheet.json, export.json
        │
        │  game adapter (Skyline: cli/skyline-skin.cli.mjs build)
        ▼
the game's own zone/level file
```

The repository holds the code (slicer, validator, exporter, contracts,
adapters). Catalogs, skins and art are data on the media mount.

## Catalog conventions

Side-scroller assets use the ordinary catalog format (`source`, `source_sha256`,
`status`, `license_scope`, `kind`, `pixel_density`, `geometry`, `frames`,
`clips`) plus the tag `side-scroller`, which switches on these checks in
`gaming-assets validate`:

| Rule | What it rejects |
|---|---|
| `distribution: private-only \| shippable` | anything else. A missing value counts as `private-only`. |
| Measured `pixel_density` | a frame whose `pixel_density`-sized blocks are not ≥ 99.9 % one colour (resampled or off-grid art), or whose origin is off that grid. Art that is uniform at twice the declared density gets a warning. |
| One canvas per clip | clip frames with different sizes (the game draws a clip into one box; mixed sizes pulse and drift). |
| Keyed backdrop | sprite frames whose border is ≥ 60 % opaque: the ripper's backdrop or panel colour was never keyed out. Set `opaque_background: true` for a deliberately opaque sprite. |
| `palette: { max_colors, rgb555 }` | a frame with more opaque colours than `max_colors`, or (with `rgb555: true`) any pixel off the SNES 15-bit grid (a channel not a multiple of 8). Emulator captures pass; fan redraws usually do not, so declare it only where it is true. One SNES sub-palette is `max_colors: 15`. |
| `repeat: [x]` / `[x, y]` on a frame | a frame that does not tile on that axis. The wrap step must look like the image's own steps: within 1.5× the 90th percentile or the typical non-zero column step, like the steps right beside it, or the same transition as one inside the image. |
| tag `parallax-layer` | a missing `scroll: { parallax, band: [y, height] }`, or a `default` frame that does not repeat on x. |
| tag `terrain-strip` | no `fill` / `edge` / `ceiling_edge` frame; `fill` not repeating on x and y; an edge not repeating on x. |

Placeholder art from fan rips is catalogued `license_scope: private-use`,
`distribution: private-only`, with a `provenance` line naming the source. The
first such catalog is `catalog/side-scroller-snes.yml` (Super Mario World sheets
and Super Mario Construct backgrounds), used only to build and prove the system.

## Getting art in: `slice`

Ripper sheets have no frame data: frames sit on a key colour, often on coloured
panels, among labels and credits.

```bash
node cli/gaming-assets.cli.mjs slice --source sprites/<pack>/<sheet>.png \
  --key '#009e00,#ff00ff' --out /tmp/frames.yml --review /tmp/review.png \
  --keyed-out assets/side-scroller/<pack>/<sheet>.png
```

- The key is detected (real transparency, or the commonest border colour) unless
  `--key` lists colours. Extra colours are panel colours: measure them, since
  sheets differ (`#ff00ff`, `#f800f8`, `#00c0c0` …).
- **Frames** are connected non-key regions (8-neighbour), merged within `--gap`,
  with long thin or sparse regions reported as dividers. **Panels** are regions of
  an extra key colour plus the sprite on them: a panel is the frame's real
  canvas, fixed across an animation and enclosing particles (explosions).
- Ids are positional (`f-216-224`, `p-11-82`), so they stay the same when the
  key list changes. Select frames by position, never by order.
- `--keyed-out` writes the sheet with every key colour transparent; catalog the
  keyed copy, with `derived_from` naming the raw sheet.

Always look at `--review` and at a skin preview: a frame can be valid and still
the wrong frame.

## Skins

A game publishes a **slot contract** (`schema: game-skin-contract/v1`):

```yaml
schema: game-skin-contract/v1
game: skyline-glider
units: { width: 1000, height: 600, art_pixel: 3 }
slots:
  layers:       { type: parallax-layers, max: 8 }
  terrain.fill: { type: texture, repeat: [x, y], scale: 3 }
  terrain.edge: { type: strip, repeat: [x] }
  craft:        { type: sprite, animated: true }
  entities.*:   { type: sprite }        # one level of wildcard
```

Slot types: `parallax-layers` (a list), `texture`, `strip`, `sprite`. `animated`
requires a clip, `required` makes a slot mandatory, `scale` enlarges on export.

A **skin** (`schema: game-skin/v1`) fills any subset of the slots; the rest stay
the game's built-in art:

```yaml
schema: game-skin/v1
id: smw-placeholder
game: skyline-glider
distribution: private-only
catalog: catalog/side-scroller-snes.yml
slots:
  layers:
    - { id: sky, asset: backdrop.smc-blue-sky }
    - { id: far, asset: backdrop.smc-snow-mountains }
  terrain.fill: { asset: terrain.smw-grass, frame: fill }
  craft:        { asset: actor.smw-cloud, clip: fly }
  finish:       { asset: prop.smw-goal, frame: default }
```

`skin-validate` is fail-closed: an unknown slot, unknown asset or frame, an
unapproved asset, an asset of the wrong role (a sprite in a layer slot), an
animated slot without a clip, a missing required slot, or **a private-only asset
in a `shippable` skin** is an error.

`skin-export` writes, at native art resolution (`pixel_density` undone):

| File | Content |
|---|---|
| `images/layers.<id>.png` | each parallax layer |
| `images/<slot>.png` | each texture and strip (with the contract's `scale`) |
| `sprites/sheet.png`, `sprites/sheet.json` | every sprite frame, shelf-packed, TexturePacker hash JSON; names `<slot>.<frame>` |
| `export.json` | `game-skin-export/v1`: each slot's files or frames (+ fps, loop), the skin's distribution, and every used asset's source, hash, licence and provenance |

`skin-preview` draws an export without any game code, as a quick check.

## Skyline Glider

- Contract: `__app_modules/wellness/fitness/server/adapters/skylineGlider/skin-contract.yml`
- Adapter: `skinZone.mjs` turns `export.json` into a zone. Art comes from the
  skin; gameplay (entity classes, roles, sizes, vulnerabilities, sounds, palette)
  comes from the base zone, so a skin cannot change how a course plays.
- One pixel grid: the adapter sets `pixel_scale: art_pixel` (3 units), derives
  every layer's height and the terrain `edge_height` from their pixel sizes, and
  `FlightScene` draws every sprite at exactly that grain, aligned in its box,
  instead of stretching it. Collision boxes do not change.

```bash
# build media/fitness/skyline-glider/<zone-id>/ (export + zone.yml)
node __app_modules/wellness/fitness/cli/skyline-skin.cli.mjs build \
  --skin $DAYLIGHT_BASE_PATH/media/games/_common/catalog/skins/skyline-glider/<skin>.yml \
  --zone-id <zone-id> --name "<Name>"

# copy zone.yml into the household zones folder (read on every request: no restart)
node __app_modules/wellness/fitness/cli/skyline-skin.cli.mjs install \
  --zone-id <zone-id> --zones-dir $DAYLIGHT_BASE_PATH/data/household/fitness/skyline-glider/zones
```

`install` refuses a private-only skin unless `--private-dev true`: installed zones
appear on every rider's world map.

### Seeing it in the real renderer

`tests/_scratch/skyline-skin-harness/` renders the real `FlightScene` for any
act and zone, with the server's own `resolveAct` and the game's own
`loadZoneAssets`, and no backend:

```bash
MEDIA_DIR=$DAYLIGHT_BASE_PATH/media node_modules/.bin/vite \
  --config tests/_scratch/skyline-skin-harness/vite.harness.config.mjs      # 127.0.0.1:5198
SHOTS='mountain-pass:alpine:12,mountain-pass:<zone-id>:12,cloud-ridge:<zone-id>:65' \
  node tests/_scratch/shoot-skyline-skin.mjs                                # → tests/_scratch/out/skyline-skin/
```

The shooter fails on a page error, console error, failed request or missing
zone file. The server runs with file watching off: restart it after a code change.

### Known gaps

- Slopes (`profile` terrain) take the fill texture but still draw their top edge
  as the SVG line; lava has no image slot.
- Gate posts and shutters change height per placement and stay SVG until the
  renderer can 3-slice a sprite (cap + repeating body).
- Frames change by time only: no damage-state, boost or hurt frames, and kill
  bursts, bell pops and the boost streak have no sprite slot.
