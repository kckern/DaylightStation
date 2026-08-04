# SchoolCalc TI-86 GUI bitmaps

[`screens.yml`](./screens.yml) is the reviewable GUI source. Every `pixels`
entry is an array of strings using only:

- `.` — blank LCD cell
- `█` — filled LCD cell

Every screen is authored at the TI-86's complete **128×64 framebuffer** with
`pixel_scale: 1`. One character in YAML is one physical LCD pixel. The
renderer rejects lower-resolution or cropped sources.

Render all screens and the contact sheet from the repository root:

```sh
node _extensions/ti86-app/tools/lint-gui.mjs
node _extensions/ti86-app/tools/render-gui.mjs
```

[`design-system.yml`](./design-system.yml) is the machine-readable registry of
regions, component categories, components, layouts, required templates, key
rules, and QR geometry. The standalone linter and renderer both enforce that
contract. Rendering fails before writing previews when a template is uncovered,
a component is unknown or missing, an F-key duplicates a physical key, body
content is improperly boxed, a fixed region moves, or QR geometry loses its
quiet zone or uniform module scale.

The renderer also validates the schema, exact 128×64 dimensions, row width,
and character set before writing PNG previews under `docs/gui/`. The default
PNG preview is enlarged 4× for inspection, but it always contains the entire
128×64 canvas and uses nearest-neighbor scaling. `--preview-scale 1` writes a
native 128×64 PNG.

The 31-screen suite covers every one of the 25 required view templates and the
product loop:

```text
profile claim/Guest → home → Catalog → lesson modules → quiz → result → My Progress → Tutor → sync/retry
```

`SHOW QR` changes to a dedicated full-framebuffer QR view. Its module
geometry is generated directly from the immutable result record.

The layout rules, component taxonomy, key behavior, scrolling, wrapping, and
truncation contracts are defined in
[`gui-design-system.md`](../docs/gui-design-system.md).
