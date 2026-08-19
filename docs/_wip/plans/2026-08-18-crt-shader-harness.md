# CRT shader harness — evaluating a real phosphor-mask CRT effect for the Player

**Date:** 2026-08-18
**Status:** shipped into the Player; pre-blur radius and render scale still to confirm on the real display
**Supersedes (if adopted):** the CSS scanline overlay in `frontend/src/modules/Player/styles/Player.scss:562-625`

---

## Why

`useUpscaleEffects.js` currently paints a `repeating-linear-gradient` over any video whose
source height is ≤480px (`CRT_MAX_HEIGHT`), plus an SVG turbulence flicker. That is a
screen-door texture laid on top of the picture. It does not resemble a CRT, because a CRT's
look comes from two things the overlay cannot do:

1. **Beam/scanline resampling** — the source is resampled into simulated scanlines with a
   brightness falloff curve, not multiplied by a fixed stripe pattern.
2. **A phosphor mask** — the picture is multiplied by a per-channel R/G/B cell grid
   (shadow mask, aperture grille, slot mask). This needs per-channel math at output-pixel
   resolution, i.e. a fragment shader.

## What was surveyed

| Option | Phosphor triads | `<video>` source | Deps | License | Traction |
|---|---|---|---|---|---|
| `crt-fx` (npm) | yes, 10 masks | **no** — images/canvas only | zero | MIT | 1 release, 3 stars, 21 dl/mo |
| `glitch-gl` (npm) | no (glow only) | yes | three.js | **paid commercial** | 92 stars, 104 dl/mo |
| `pixi-filters` `CRTFilter` | no | yes | pixi.js v8 | MIT | 378k dl/mo |
| `gingerbeardman/webgl-crt-shader` | no (rgbShift only) | canvas | three.js | MIT | 177 stars, not on npm |
| **libretro `glsl-shaders`** | **yes** | n/a — raw GLSL | none | public domain / GPL | decade of emulator use |

Conclusion: nothing on npm both handles video and draws a real mask. The libretro shaders do
the hard part and are dependency-free; what we supply is ~150 lines of texture-upload
boilerplate.

## The harness

`frontend/public/crt-lab/` — a standalone page, no build step, no app dependency.

```
crt-lab/
  index.html            the lab (self-contained)
  shaders/*.glsl        crt-lottes, crt-easymode, crt-aperture, crt-pi, crt-geom
                        (verbatim from libretro/glsl-shaders, unmodified)
  vendor/shaka.js       shaka-player 4.16.12 DASH build, lazy-loaded, only for Plex sources
  media/*.mp4           two generated 640×480 clips (committed)
  media/real-sd.mp4     a 24s real SD clip pulled from Plex — GITIGNORED, never commit
```

### Opening it

**The URL must end in `/index.html`.** A bare `/crt-lab/` is swallowed by Vite's SPA
fallback and serves the Daylight Station app instead.

- dev (from this machine): `http://localhost:{env.ports.app}/crt-lab/index.html`
- dev (from another device on the LAN): `http://{dev-machine-ip}:{env.ports.app}/crt-lab/index.html`
- Shield TV: push the URL through the FKB REST API (`loadUrl`), see the FKB section of `CLAUDE.md`

### What it does

- **Renderer picker** — the five libretro shaders, a raw passthrough, and `CURRENT`, which
  reproduces the shipping CSS overlay (including the element blur) for A/B.
- **Auto-generated parameter sliders.** Every libretro `.glsl` declares its tunables as
  `#pragma parameter <name> "<label>" <default> <min> <max> <step>`; the page parses those
  and builds the UI, so all five shaders are fully tweakable with no per-shader code.
- **Compare modes** — shader / raw / draggable split. Hold `space` to flash raw.
- **Render scale** — the mask is drawn in *output* pixels (`gl_FragCoord`), so this is both
  the look control and the main perf lever. On a 4K panel, 2.0 gives a 1:1 mask.
- **Stats HUD** — fps, dropped frames, source/output size, upscale ratio, GPU string.
- **Copy JSON** — dumps the tuned parameter set so a chosen look can be handed back as data.
- State persists in localStorage and round-trips through the URL, so a tuned look can be sent
  to another screen as a link.

### How the loader works

A libretro `.glsl` holds both stages in one file behind `#if defined(VERTEX)` /
`#elif defined(FRAGMENT)`, and collapses its parameters to hard-coded `#define`s unless
`PARAMETER_UNIFORM` is defined. The page compiles each stage by prepending the right pair of
defines to the same source, strips the `#pragma parameter` lines (metadata for RetroArch, and
some drivers are noisy about unknown pragmas), and supplies the standard libretro uniform set:
`MVPMatrix` (identity), `Texture`, `TextureSize`, `InputSize`, `OutputSize`, `FrameCount`,
`FrameDirection`. Video frames go up via `texImage2D` on `requestVideoFrameCallback`.

## Findings (headless, SwiftShader — relative only)

All five shaders compile and run clean in WebGL1 with no page errors. Absolute fps from a
software rasterizer is meaningless, but the *ratios* are informative:

| Shader | fps (SwiftShader, 640×480 → 950×713) |
|---|---|
| crt-easymode | 25.6 (source rate) |
| crt-aperture | 25.5 |
| crt-pi | 25.3 |
| crt-geom | 25.5 |
| **crt-lottes** | **9.3** |

crt-lottes costs roughly 3× the others — its `DO_BLOOM` path samples the source many extra
times. It also has the richest mask (`shadowMask` 1–4: compressed TV, aperture grille,
stretched VGA, VGA). If it proves too heavy on the Shield, crt-aperture is the closest
substitute with mask colors/size/strength exposed, and crt-pi was written specifically for
weak GPUs.

## Real-content result — the texture path is clear

Verified 2026-08-18 against a 640×360 clip taken from the Movies library. `texImage2D` from
the video succeeds, split-screen compare renders raw and shader from one decode, and the
phosphor mask reads correctly over real footage. **No tainted-canvas or DRM problem** on our
library — question 2 is answered yes.

### Side finding: Plex DASH does not work in the lab (and may not be a lab problem)

The `plex:<ratingKey>` source resolves correctly through `/api/v1/play/plex/{id}` and gets
`mediaUrl: /api/v1/proxy/plex/stream/{id}` with `format: dash_video`. Shaka loads the
manifest, then **404s on the first init segment**
(`…/transcode/universal/session/{uuid}/0/header`). Two things were found on the way:

- `/api/v1/proxy/plex/...` **ignores `Range` requests** — it answers a ranged GET with
  `200 OK` and the whole file rather than `206 Partial Content`. For a 608 MB movie that means
  no seeking and unbounded buffering.
- The 404 persists with a single player, so it is not two shaka instances racing for one
  transcode session (that was the first theory, and the lab was restructured to a single
  decode anyway — worth keeping regardless, since comparisons now cost one Plex session
  instead of two).

Unresolved whether this is a shaka-vs-dash.js difference (the Player uses
`dash-video-element`) or a real defect in the proxy. **Worth checking separately whether the
shipping Player can currently direct-play SD Plex items** — if it can't, this is a live bug
that has nothing to do with CRT shaders. Not chased here.

Also noted: rating key 2465 (`1952-06-00 Gates Family Silent Films (Part 1)`) 404s on its
part URL directly against Plex — its file appears to be missing from disk. Unrelated to the
above, but someone should look.

## Design intent — this is a faux-HD trick, not nostalgia

The mask and scanlines exist to make upscaled SD read as *denser* than it is. The eye reads
the fine phosphor grid as detail, so the picture gains apparent resolution instead of showing
its blocks. Three consequences for tuning:

- **Mask pitch must be fine relative to the output.** A coarse mask reads as stripes laid over
  a soft picture; a fine one reads as texture. Pitch is fixed in output pixels
  (`gl_FragCoord`), so the render-scale control decides this. On a 4K panel that means 2.0.
- **Artifacts must go first.** Blocking and DCT mosquito noise are also high-frequency, and
  they compete with the mask for the same perceptual channel. Removing them is what makes the
  mask read as detail rather than as more noise. Hence the pre-filter below.
- **Resample crisply after softening.** crt-geom's `SHARPER` (1–3) controls its own sampling.
  Pre-blur plus a higher `SHARPER` is the combination worth trying: kill the artifacts, then
  let the shader resample tightly and lay a fine mask on top.

## The pre-filter

Added to the lab as a stage *ahead* of the CRT shader:

```
video → [H gaussian] → [V gaussian + mix back toward source] → CRT shader → canvas
        \_____________ source resolution, two FBOs ____________/
```

Separable 9-tap gaussian run at the source's own resolution, so **radius is in source pixels**
— it dissolves block edges without smearing the phosphor mask, which a blur applied after the
shader would. Radius 0 bypasses both passes and touches no render targets. `Blur mix` blends
the result back toward the untouched source for a partial effect; the blend happens on the
final pass against the original texture, so it stays correct rather than compounding.

In split mode the left half stays the untouched source, so the comparison shows original
against the full pipeline, pre-filter included.

Cost measured on SwiftShader at 640×360: 26.3 fps at radius 0 vs 25.6 fps at radius 3.5 — the
two source-resolution passes are close to free next to the CRT pass itself, which runs at
output resolution.

## Chosen look — settled 2026-08-18

`crt-geom`, with these deltas from the shader's own defaults:

| Parameter | Default | Chosen |
|---|---|---|
| `CRTgamma` | 2.4 | **1.9** |
| `INV` | 0 | **1** |
| `R` (curvature radius) | 2.0 | **1.8** |
| `cornersize` | 0.03 | **0.041** |

Everything else at default, notably `DOTMASK` 0.3, `scanline_weight` 0.3, `SHARPER` 1,
`CURVATURE` 1, `d` 1.6, `monitorgamma` 2.2, `SATURATION` 1, `interlace_detect` 1.

Baked into the lab as the built-in preset for crt-geom, so a fresh browser — or the Reset
button — lands here rather than on the shader's defaults.

**Pre-blur radius is not yet recorded.** `Copy JSON` was only dumping shader parameters, so
the pre-filter and render scale were being dropped on every hand-off. Fixed — the payload now
carries `preFilter.blurRadiusSourcePx`, `preFilter.blurMix`, and `renderScale`.

## Open questions remaining

1. **Does it hold frame rate on the Shield TV WebView at output resolution?** Deferred by
   decision — assumed acceptable for now. Watch fps and dropped frames when it is checked.
2. **Final pre-blur radius**, judged at the render scale the real display will use — the
   right radius at scale 1.0 in a window is not the right radius at scale 2.0 on the 4K panel.
3. **Does `SHARPER` 2–3 plus pre-blur beat `SHARPER` 1 plus no pre-blur?** Both routes aim at
   the same faux-HD result from opposite directions.

## Shipped into the Player — 2026-08-18

### Files

| File | Role |
|---|---|
| `frontend/src/modules/Player/shaders/crt-geom.glsl` | vendored libretro shader, unmodified |
| `frontend/src/modules/Player/lib/crtRenderer.js` | framework-free WebGL renderer + pre-filter |
| `frontend/src/modules/Player/lib/crtRenderer.test.js` | 14 unit tests |
| `frontend/src/modules/Player/hooks/useCrtShader.js` | React lifecycle around the renderer |
| `frontend/src/modules/Player/renderers/VideoPlayer.jsx` | mounts the canvas, hides the source video |
| `frontend/src/modules/Player/styles/Player.scss` | `.upscale-crt-canvas`, `.video-element.crt-source` |

### What did not change

`useUpscaleEffects.js` is untouched. It still owns the entire decision — the ≤480p
`CRT_MAX_HEIGHT` gate, the 1500 ms stabilize timer, the looped-video carve-out, the
letterbox-aware upscale ratio, and the `upscaleEffects` preset resolution in
`Player.jsx:259-265`. Only `overlayProps.showCRT` is consumed differently: it now mounts a
canvas rather than a div.

### Fallback ladder

The CSS overlay was kept, not deleted. `useCrtShader` reports `fellBack` and `VideoPlayer`
puts the old `.upscale-crt-overlay` up instead when any of these happen:

- no WebGL context, or `getContext` throws
- shader compile or link fails
- `texImage2D` from the video is refused — a protected/DRM surface. This only shows up on the
  first draw, so the hook polls `renderer.failed` rather than assuming construction success
  means the effect is running.
- WebGL context loss

The source `<video>` is dimmed with `opacity: 0`, never `display: none` — it has to stay laid
out and decoding to keep feeding `texImage2D`. The CSS blur in `effectStyles` is dropped while
the shader is active, since the pre-filter supersedes it and the filter would otherwise cost
GPU time on an invisible element.

### Verification performed

- 14 unit tests on the renderer: pragma parsing against the real shader (18 parameters),
  preset layering, `fitContain` letterbox math, and every unsupported path returning inert
  no-op controls rather than throwing.
- Full Player suite: **66 files, 470 tests, all passing.**
- Browser check of the *shipped module* (not the lab's copy) via
  `frontend/public/crt-lab/verify.html`, which imports `modules/Player/lib/crtRenderer.js`
  straight out of Vite's module graph. Renders correctly with the preset and a 1.25 px
  pre-blur; logs `crt.renderer-created` and `crt.started` through the logging framework.
  Dev-server only — the `/src/` import is not part of any build.
- ESLint: zero findings on both new files.

### Licensing — read before this repo ever goes public

`crt-geom` is **GPL v2 or later** (© 2010-2012 cgwg, Themaister and DOLLS). It is vendored
verbatim, header intact. For a private household deployment there is no distribution and so no
obligation, but if this repository is ever published or the app distributed, the GPL applies
to the combined work. The license-clean alternative is `crt-lottes`, which is public domain
and carries the richer mask, at roughly 3× the GPU cost.

### Still open

- Pre-blur ships at **1.25 px** (`DEFAULT_PRE_FILTER` in `crtRenderer.js`) — a placeholder,
  since `Copy JSON` was dropping the value at the time the look was chosen. Confirm against
  the real display and change the one constant.
- `renderScale` is wired through the renderer but pinned to 1 by the hook. The mask pitch is
  fixed in output pixels, so a 4K panel likely wants 2. Exposing it means adding a prop.
- Frame rate on the Shield TV WebView remains unmeasured, by decision.
