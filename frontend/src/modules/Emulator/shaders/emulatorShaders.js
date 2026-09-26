// emulatorShaders.js — the picture-shader presets the arcade registers with
// EmulatorJS at boot. A manifest names one in `presentation.ejs_shader`.
//
// Asset imports live here, and only here: `?raw` for shader text, `?inline`
// for the textures (a data: URI, decoded to bytes by buildShaderEntry).

import { buildShaderEntry } from './customShaders.js';
import presetMono from './gameboy/gameboy-harlequin.glslp?raw';
import presetColor from './gameboy/gameboy-harlequin-color.glslp?raw';
import pass0 from './gameboy/gb-pass0.glsl?raw';
import pass1 from './gameboy/gb-pass1.glsl?raw';
import pass2 from './gameboy/gb-pass2.glsl?raw';
import pass3 from './gameboy/gb-pass3.glsl?raw';
import pass4 from './gameboy/gb-pass4.glsl?raw';
import paperBg from './gameboy/paper-bg.png?inline';
import gbpPalette from './gameboy/gbp-palette.png?inline';

/** Harlequin dot matrix, palette mode — the Game Boy. */
export const GAMEBOY_HARLEQUIN = 'gameboy-harlequin.glslp';
/** Harlequin dot matrix, colour mode — the Game Boy Color. */
export const GAMEBOY_HARLEQUIN_COLOR = 'gameboy-harlequin-color.glslp';

const GAMEBOY_PASSES = [
  ['gb-pass0.glsl', pass0],
  ['gb-pass1.glsl', pass1],
  ['gb-pass2.glsl', pass2],
  ['gb-pass3.glsl', pass3],
  ['gb-pass4.glsl', pass4],
];
const GAMEBOY_TEXTURES = [
  ['paper-bg.png', paperBg],
  ['gbp-palette.png', gbpPalette],
];

export const EMULATOR_SHADERS = Object.freeze({
  [GAMEBOY_HARLEQUIN]: buildShaderEntry({ preset: presetMono, passes: GAMEBOY_PASSES, textures: GAMEBOY_TEXTURES }),
  [GAMEBOY_HARLEQUIN_COLOR]: buildShaderEntry({ preset: presetColor, passes: GAMEBOY_PASSES, textures: GAMEBOY_TEXTURES }),
});
