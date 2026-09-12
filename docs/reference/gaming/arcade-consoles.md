# Arcade Consoles — adding a system to the EmulatorJS arcade

The in-browser arcade (the Video Games widget on the fitness display) is a
different system from the Shield's RetroArch. This page is about the browser
one. For the boot contract and fault handling see
[emulator resilience](emulator-resilience.md); for how play is metered see
[play sessions](play-sessions.md).

Everything about a console is data. A system exists because a manifest exists,
and nothing in the code names a console.

## The five things a console needs

**1. A manifest** at `media/emulation/{system}/{system}.yml`. This is what makes
the system exist: `loadEmulatorConfig` discovers systems by reading manifests,
so a folder without one contributes nothing, however many ROMs it holds. Use
`gb/gameboy.yml` or `genesis/genesis.yml` as the model — both split their claims
into a CONFIRMED tier and a PROVISIONAL one, which is worth keeping.

**2. A core**, at `media/emulation/_engine/cores/{core}-wasm.data`. Two names are
involved and they are not the same:

- `core.ejs_core` in the manifest is EmulatorJS's **system key** — `gb`,
  `segaMD`. The engine maps it to an ordered core list in `getCores()` and picks
  the first (`segaMD` → `genesis_plus_gx`, with `picodrive` as the alternative
  that matters only for 32X and Sega CD).
- The **file** is named for the resolved core, not the system key.

Fetch it at the version the bundle reports, never "latest":

```bash
V=$(node -e "console.log(require('media/emulation/_engine/version.json').version)")
curl -O "https://cdn.emulatorjs.org/$V/data/cores/<core>-wasm.data"
```

Fetch the `-legacy-wasm.data` variant too. EmulatorJS asks for it whenever
WebGL2 is unavailable, and if it is missing the engine **silently falls back to
the public CDN** — a kiosk that quietly depends on the internet. It logs only
`File was not found locally, but was found on the emulatorjs cdn`.

**3. A tab** in `media/emulation/consoles.yml`. Slots are ordered and `{}` is a
deliberate blank placeholder. A system with a manifest but no slot is invisible.

**4. Native resolution** in `CORE_NATIVE` (`loadEmulatorConfig.mjs`), keyed by
the **lowercased** `ejs_core`. The screen box is integer-locked — the largest
whole multiple of the native framebuffer that fits the bezel cutout — so a
missing entry silently falls back to the Game Boy's 160×144 and the picture is
sized and positioned for the wrong console inside the right hole.

**5. Bezel art** at `media/emulation/{system}/bezel.png`, plus
`presentation.screen` and `chrome: {system}-bezel`. The chrome CSS matches any
`chrome-*-bezel`, so no stylesheet change is needed.

Optional but usually wanted: `cover_aspect` (width/height) when the console's
box art is not square. Cover tiles are square by default because Game Boy
cartridge labels are; a Genesis box is a tall rectangle and a square tile crops
half of it away.

## Deriving the bezel and its cutout

The bezels come from the Shield's RetroArch overlays, which are not single
images: the art is a set of quadrant tiles composited at runtime. Read the
overlay's `.cfg` and honour it rather than eyeballing the result.

Only the descs carrying `_alpha_mod = 1` are visible — the overlay's own
`alpha_mod` is `0.0`, which is how the art shows while the touch-button descs
stay invisible. For the Genesis that is eight 1200×540 tiles plus two logos.
Each desc gives a centre and a half-extent in normalised coordinates; composite
them at 1920×1080 and the cutout falls out of the alpha channel.

Take the largest rectangle **of the console's native aspect** that fits entirely
inside the transparent area. Do not ray-scan outward from the centre: these
apertures are rounded rectangles, so a single row or column runs past the
corners and overstates the box.

Cross-check the answer against the same console's entry in
`data/household/gaming/games.yml`, which carries an independent measurement of
the same art for the Shield's own countdown placement. The two agreed on the
Genesis to the pixel in `y` and within five pixels in height.

A console's `bezel.zones` toast rects in that file are measured negative space —
the flattest patch in each band of chrome — and are the right coordinates to
reuse for `presentation.overlays`. Check them against `presentation.hotspots`
before using them: the Genesis bottom band's toast rect overlaps the wordmark
that carries the exit hotspot, so the coins slot is trimmed to sit beside it.

Where an overlay `.cfg` declares button positions, convert those rather than
hunting for engravings in the art — they are the authored coordinates of the
D-pad and face buttons, and they land on the artwork by construction.
