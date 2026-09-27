// emulatorShaders.js — the picture-shader presets the arcade registers with
// EmulatorJS at boot. A manifest names one in `presentation.ejs_shader`.
//
// Shader text is source, imported here with `?raw`. The textures are bitmaps:
// they live on the media mount, the console manifest names them
// (`presentation.ejs_shader_textures`), and EmulatorSession fetches them at boot.

import { buildShaderEntry } from './customShaders.js';
import presetMono from './gameboy/gameboy-harlequin.glslp?raw';
import presetColor from './gameboy/gameboy-harlequin-color.glslp?raw';
import pass0 from './gameboy/gb-pass0.glsl?raw';
import pass1 from './gameboy/gb-pass1.glsl?raw';
import pass2 from './gameboy/gb-pass2.glsl?raw';
import pass3 from './gameboy/gb-pass3.glsl?raw';
import pass4 from './gameboy/gb-pass4.glsl?raw';

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

export const EMULATOR_SHADERS = Object.freeze({
  [GAMEBOY_HARLEQUIN]: buildShaderEntry({ preset: presetMono, passes: GAMEBOY_PASSES }),
  [GAMEBOY_HARLEQUIN_COLOR]: buildShaderEntry({ preset: presetColor, passes: GAMEBOY_PASSES }),
});
