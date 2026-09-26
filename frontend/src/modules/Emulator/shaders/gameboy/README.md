# Harlequin Game Boy dot-matrix shader

Five-pass RetroArch GLSL shader that draws a Game Boy picture as an LCD: each
dark pixel becomes a dot on a paper background, with a light gap around it, a
soft drop shadow beneath it, and a short response-time trail when it moves.
Blank pixels draw nothing, so empty screen is plain paper.

The arcade runs it *inside* the EmulatorJS core (`presentation.ejs_shader` in a
console manifest), which is the only place a shader can read the game pixels —
see `docs/reference/gaming/emulator-resilience.md`, "Picture shaders".

## Origin and licence

`gb-pass0.glsl` … `gb-pass4.glsl`, `paper-bg.png` and `gbp-palette.png` come
from [libretro/glsl-shaders](https://github.com/libretro/glsl-shaders)
`handheld/shaders/gameboy/` — Harlequin's 2013 "Game Boy" shader, GPL-3.0.
The files keep their licence headers; the GPL applies to them, not to the rest
of this MIT repository. The Shield TV in this household runs the same shader's
slang v1.1 (Matt Akins, 2025) through RetroArch; this is the web port of its look.

## Local patches (diff against upstream)

- **pass0 — snap near-zero dot opacity to zero.** Gambatte's DMG "white" is
  (255, 251, 255), not pure white, so every blank pixel carried ~0.5% opacity
  and pass4 treated it as a dot: the paper under it was flattened and a grid
  appeared over empty screen. Opacity below 3% is now zero.
- **pass0 + pass4 — `color_toggle` parameter** (from v1.1). At 1 the dot takes
  the game's own colour instead of the palette foreground, and pass4 stops
  tinting it with the palette background. Used by the Game Boy Color preset.
  Its `#pragma parameter` is in pass0 only: declared in both passes, the web
  core's RetroArch honoured the pragma default but dropped the preset's
  override (verified 2026-09-25). Parameters are set on every pass by name,
  so pass4 still receives it through its plain `uniform` declaration.

## Presets

| File | For | Overrides |
|---|---|---|
| `gameboy-harlequin.glslp` | Game Boy (`gb`) | `baseline_alpha 0`, `screen_light 1.15` |
| `gameboy-harlequin-color.glslp` | Game Boy Color (`gbc`) | the above + `color_toggle 1` |

Paths inside the presets are flat: EmulatorJS writes every resource straight
into the core's `/shader/` directory. The PNG textures are written by
`EmulatorEngine.applyShader` as raw bytes, not through EmulatorJS's resource
list — its path UTF-8-encodes the data and corrupts binaries.

## Scaling

This version needs the picture at a whole-number scale (`video_scale_factor =
floor(viewport / framebuffer)` in pass0), so the Game Boys keep
`screen_scaling: integer`. v1.1's fullscreen mode would lift that; it has not
been ported.
