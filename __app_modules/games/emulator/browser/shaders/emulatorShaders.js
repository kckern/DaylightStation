// emulatorShaders.js — the picture-shader presets the arcade registers with
// EmulatorJS at boot. A manifest names one in `presentation.ejs_shader`.
//
// The five Harlequin passes are GPL-3.0 third-party source, so they are NOT in
// this repo or its bundle: `npm run install:assets` puts them on the media
// volume and we fetch them at runtime from /vendor/shaders/gameboy/. If they
// are not installed the table is empty and EmulatorJS shows the picture
// unfiltered (one `warn`, never a crash). The two .glslp presets are our own
// small config text and stay in the repo. The textures are bitmaps: they live
// on the media mount, the console manifest names them
// (`presentation.ejs_shader_textures`), and EmulatorSession fetches them at boot.

import { buildShaderEntry } from "./customShaders.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import presetMono from "./gameboy/gameboy-harlequin.glslp?raw";
import presetColor from "./gameboy/gameboy-harlequin-color.glslp?raw";

/** Harlequin dot matrix, palette mode — the Game Boy. */
export const GAMEBOY_HARLEQUIN = 'gameboy-harlequin.glslp';
/** Harlequin dot matrix, colour mode — the Game Boy Color. */
export const GAMEBOY_HARLEQUIN_COLOR = 'gameboy-harlequin-color.glslp';

export const VENDOR_SHADER_BASE = '/vendor/shaders';
const GAMEBOY_PASS_NAMES = [0, 1, 2, 3, 4].map((i) => `gb-pass${i}.glsl`);

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'emulator-shaders' });
  return _logger;
}

let warned = false;
let cached = null;
let failed = false;

export function resetEmulatorShadersForTest() {
  warned = false;
  cached = null;
  failed = false;
}

function warnOnce(error) {
  if (warned) return;
  warned = true;
  logger().warn('emulator.shader.unavailable', {
    error,
    hint: 'Game Boy picture shaders are not installed; showing the unfiltered picture. Run `npm run install:assets`.',
  });
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = await res.text();
  if (!text.trim()) throw new Error(`empty ${url}`);
  return text;
}

/**
 * Fetch the Game Boy passes and build the preset table for EmulatorJS.
 * All-or-nothing: any pass that cannot be fetched yields `{}`.
 * @returns {Promise<Record<string, object>>}
 */
export async function loadEmulatorShaders({ fetchImpl = globalThis.fetch } = {}) {
  if (cached) return cached;
  if (failed) return {};
  try {
    const passes = await Promise.all(GAMEBOY_PASS_NAMES.map(
      async (name) => [name, await fetchText(`${VENDOR_SHADER_BASE}/gameboy/${name}`, fetchImpl)],
    ));
    cached = Object.freeze({
      [GAMEBOY_HARLEQUIN]: buildShaderEntry({ preset: presetMono, passes }),
      [GAMEBOY_HARLEQUIN_COLOR]: buildShaderEntry({ preset: presetColor, passes }),
    });
    return cached;
  } catch (err) {
    failed = true;
    warnOnce(err?.message || String(err));
    return {};
  }
}
