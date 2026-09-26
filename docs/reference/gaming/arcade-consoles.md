# Arcade Consoles — adding a system to the EmulatorJS arcade

The in-browser arcade (the Video Games widget on the fitness display) is a
different system from the Shield's RetroArch. This page is about the browser
one. For the boot contract and fault handling see
[emulator resilience](emulator-resilience.md); for how play is metered see
[arcade game sessions](arcade-game-sessions.md).

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

Not every console has its own system key: EmulatorJS has no `gbc`, because
gambatte switches on the cartridge header, so the Game Boy Color declares
`ejs_core: gb` and shares the Game Boy's core file. It is still its own system
here — that is what gives it a tab, a bezel, a screen geometry and a save
namespace of its own.

Fetch the `-legacy-wasm.data` variant too. EmulatorJS asks for it whenever
WebGL2 is unavailable, and if it is missing the engine **silently falls back to
the public CDN** — a kiosk that quietly depends on the internet. It logs only
`File was not found locally, but was found on the emulatorjs cdn`.

**3. A tab** in `media/emulation/consoles.yml`. Slots are ordered and `{}` is a
deliberate blank placeholder. A system with a manifest but no slot is invisible.

**4. Native resolution** in `CORE_NATIVE` (`loadEmulatorConfig.mjs`), keyed by
the **lowercased** `ejs_core`. The screen box is derived from it (see the next
section), so a missing entry silently falls back to the Game Boy's 160×144 and
the picture is sized and positioned for the wrong console inside the right hole.

**5. Bezel art** at `media/emulation/{system}/bezel.png`, plus
`presentation.screen` and `chrome: {system}-bezel`. The chrome CSS matches any
`chrome-*-bezel`, so no stylesheet change is needed.

Optional but usually wanted: `cover_aspect` (width/height) when the console's
box art is not square. Cover tiles are square by default because Game Boy
cartridge labels are; a Genesis box is a tall rectangle and a square tile crops
half of it away.

## Sizing the picture inside the cutout

`presentation.screen` is the cutout; `presentation.screen_scaling` says how the
picture uses it.

The default, `integer`, takes the largest whole multiple of the framebuffer
that fits and centres it. Any console drawing a pixel grid needs this, or the
grid moirés — that includes the Game Boys' Harlequin core shader, whose 2013
GLSL computes its dot pitch from `floor(viewport / framebuffer)`. It costs up to a full step: the Game Boy Color's aperture happens
to be exactly 6x160x144 and wastes nothing. When the art's hole falls just
short of the next step, enlarge the hole rather than switching to `fill`: the
Advance's current bezel shipped a 916x580 hole that only fit 3x (720x480), so
its alpha was cut out to exactly 960x640 in the dark glass, same centre, and
the picture now locks to 4x.

`fill` takes the whole cutout. Use it where there is no grid to align to *and*
the console's pixels were not square. The Genesis is the case: it drew 320x224
across a 4:3 television, so its cutout is measured at 4:3 and filling it
reproduces the real geometry. Integer-locking it had wasted a quarter of the
aperture and letterboxed the picture into the wrong shape besides.

So measure the cutout at the console's **display** aspect, not its framebuffer
aspect. They differ whenever the pixels were not square.

## Deriving the bezel and its cutout

The bezels come from the Shield's RetroArch overlays. Read the overlay's `.cfg`
first, because two shapes of them exist and only one needs work.

Most are a single full-screen PNG with `overlay0_descs = 0` — `gbc-grape` and
`gba_animated` are both this, and the file is copied to `bezel.png` verbatim.

The Genesis is the other kind: `genesis2_animated_border` is a set of tiles
composited at runtime. Only the descs carrying `_alpha_mod = 1` are visible —
the overlay's own `alpha_mod` is `0.0`, which is how the art shows while the
touch-button descs stay invisible — and for that one it is eight 1200×540 tiles
plus two logos. Each desc gives a centre and a half-extent in normalised
coordinates; composite them at 1920×1080 and the cutout falls out of the alpha
channel.

Either way, take the largest rectangle **of the console's display aspect** that
fits entirely inside the transparent area. Do not ray-scan outward from the
centre: some apertures are rounded rectangles, so a single row or column runs
past the corners and overstates the box.

Cross-check the answer against the same console's entry in
`data/household/gaming/games.yml`, which carries an independent measurement of
the same art for the Shield's own countdown placement. On the Advance the two
agree exactly — 1260×840 at (330,120) from both — and on the Genesis to the
pixel in `y`.

A console's `bezel.zones` toast rects in that file are measured negative space —
the flattest patch in each band of chrome — and are the right coordinates to
reuse for `presentation.overlays`. Check them against `presentation.hotspots`
before using them: the Genesis bottom band's toast rect overlaps the wordmark
that carries the exit hotspot, so the coins slot is trimmed to sit beside it.

Where an overlay `.cfg` declares button positions, convert those rather than
hunting for engravings in the art — they are the authored coordinates of the
D-pad and face buttons, and they land on the artwork by construction.
