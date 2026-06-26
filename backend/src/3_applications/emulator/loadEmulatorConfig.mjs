import { deepMerge } from './lib/deepMerge.mjs';
import { mergePresentation } from './mergePresentation.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

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
        boxart: game.cover,
        bezel: game.bezel,
        watches: game.watches,
        hooks: game.hooks,
        // Deep-merge system defaults UNDER the game so the global-defaults pure
        // functions (resolveGameRules) stay correct with an empty cfg.defaults.
        governance: deepMerge(sysDefaults.governance ?? {}, game.governance ?? {}),
        shader: game.shader ?? presentation.shader ?? null,
        chrome: game.chrome ?? presentation.chrome ?? null,
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
