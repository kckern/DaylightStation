import { deepMerge } from './lib/deepMerge.mjs';
import { mergePresentation } from './mergePresentation.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

// EmulatorJS core → native framebuffer resolution. The dot-matrix grid + the
// integer-locked screen box must scale to the ACTUAL game resolution, not GB's
// 160×144, or the LCD cells drift off a GBA title's pixels.
const CORE_NATIVE = {
  gb: { width: 160, height: 144 },
  gbc: { width: 160, height: 144 },
  gambatte: { width: 160, height: 144 },
  gba: { width: 240, height: 160 },
  mgba: { width: 240, height: 160 },
};
const DEFAULT_NATIVE = { width: 160, height: 144 };

function resolveNative({ gameNative, systemNative, core }) {
  if (gameNative && Number.isFinite(gameNative.width) && Number.isFinite(gameNative.height)) {
    return { width: gameNative.width, height: gameNative.height };
  }
  if (systemNative && Number.isFinite(systemNative.width) && Number.isFinite(systemNative.height)) {
    return { width: systemNative.width, height: systemNative.height };
  }
  const key = typeof core === 'string' ? core.toLowerCase() : core;
  return CORE_NATIVE[key] || DEFAULT_NATIVE;
}

/**
 * Load + normalize per-system emulator manifests into the in-memory `cfg`
 * shape consumed by buildCatalog/resolveGameRules.
 *
 * File I/O is fully injected via `readManifests` so this stays pure/testable.
 * The real wiring (scan emulationDir, parse YAML) lives in Task C's
 * emulatorFs.readManifests and is passed in here.
 *
 * @param {object}   opts
 * @param {string}   opts.emulationDir     Base media dir (provenance/logging only).
 * @param {function} opts.readManifests    () => Array<{ system, manifest }>.
 * @param {function} [opts.readInputConfig] () => parsed input.yml object (keyboard/controllers) or null.
 * @param {function} [opts.readConsoles]   () => ordered console-tab list (consoles.yml) or null.
 * @param {object}   [opts.logger]         Logger with warn/info/debug/error.
 * @returns {{ systems: object, games: object[], defaults: object, users: object, input: object|null, consoles: object[] }}
 */
export function loadEmulatorConfig({ emulationDir, readManifests, readInputConfig, readConsoles, logger = NOOP_LOGGER }) {
  const systems = {};
  const games = [];

  const entries = (typeof readManifests === 'function' ? readManifests() : null) ?? [];

  for (const entry of entries) {
    const manifest = entry?.manifest;
    if (!manifest) continue;
    const systemId = entry.system || manifest.system;
    if (!systemId) {
      logger.warn('emulator.config.manifest_missing_system', { emulationDir });
      continue;
    }

    systems[systemId] = {
      core: manifest.core?.ejs_core || manifest.core?.name || systemId,
      label: manifest.label || systemId,
      native: manifest.native && Number.isFinite(manifest.native.width) && Number.isFinite(manifest.native.height)
        ? { width: manifest.native.width, height: manifest.native.height }
        : null,
    };

    const sysDefaults = manifest.defaults ?? {};
    const presentation = manifest.presentation ?? {};

    for (const game of manifest.games ?? []) {
      if (!game?.id) {
        logger.warn('emulator.config.game_missing_id', { system: systemId, title: game?.title });
        continue;
      }

      games.push({
        id: game.id,
        system: systemId,
        title: game.title,
        rom: game.rom,
        save: game.save,
        // Per-game save behavior: 'none' (no persistence) | 'state' (emulator
        // save-state snapshot as the resume point) | 'battery' (.srm battery save).
        // Drives the fingerprint-up-front launch flow; absent ⇒ 'none'.
        saveMode: game.save_mode ?? game.saveMode ?? 'none',
        // Per-game EJS_core override (e.g. a GBA game living in the gb category so
        // it shares the bezel/shader, but boots with the mGBA core). Absent ⇒ use
        // the system's core. EmulatorJS treats this as a system id and resolves
        // it to the actual libretro core (e.g. 'gba' → mgba).
        core: game.core ?? null,
        boxart: game.cover,
        // The bezel is a SYSTEM-level asset (the DMG chrome shared by every GB/
        // GBC/GBA title in this category), so default it — games shouldn't each
        // need to declare it. A game may override; a system may name its bezel via
        // manifest.bezel. Falls back to the conventional `bezel.png`.
        bezel: game.bezel ?? manifest.bezel ?? 'bezel.png',
        watches: game.watches,
        hooks: game.hooks,
        // Deep-merge system defaults UNDER the game so the global-defaults pure
        // functions (resolveGameRules) stay correct with an empty cfg.defaults.
        governance: deepMerge(sysDefaults.governance ?? {}, game.governance ?? {}),
        shader: game.shader ?? presentation.shader ?? null,
        chrome: game.chrome ?? presentation.chrome ?? null,
        // Native framebuffer res for the LCD grid / integer screen box. Per-game
        // override → system manifest native → core default → 160×144.
        native: resolveNative({
          gameNative: game.native,
          systemNative: manifest.native,
          core: game.core ?? manifest.core?.ejs_core ?? manifest.core?.name ?? systemId,
        }),
        // Bezel control surface: system presentation (screen cutout, hotspots,
        // overlays, onscreen controls) merged under the game's own presentation
        // override (by id). The browser reads screen/onscreen_controls from here.
        presentation: mergePresentation(presentation, game.presentation),
      });
    }
  }

  const input = (typeof readInputConfig === 'function' ? readInputConfig() : null) ?? null;

  // Ordered console-tab list (consoles.yml). Each entry is either a real console
  // bound to a `system`, or a blank placeholder (no/unknown system). Resolution
  // of real-vs-placeholder happens in buildCatalog (it knows `systems`). Absent
  // ⇒ empty, and buildCatalog falls back to one tab per discovered system.
  const consolesRaw = (typeof readConsoles === 'function' ? readConsoles() : null);
  const consoles = Array.isArray(consolesRaw)
    ? consolesRaw
    : (Array.isArray(consolesRaw?.consoles) ? consolesRaw.consoles : []);

  return {
    systems,
    games,
    defaults: { governance: {}, shader: null, chrome: null },
    users: {},
    input,
    consoles,
  };
}
