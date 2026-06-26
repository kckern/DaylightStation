import { deepMerge } from './lib/deepMerge.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Resolve a single game's effective rules by merging:
 *   defaults <- game <- per-user overlay
 * Only the governance/shader/chrome keys participate in the merge.
 *
 * @param {object} cfg     Emulator config ({ defaults, games, users, systems })
 * @param {string} gameId  Game id to resolve
 * @param {string|null} userId  Optional user id for per-user overlay
 * @returns {object|null} Resolved game rules, or null if the game is unknown.
 */
export function resolveGameRules(cfg, gameId, userId) {
  const game = cfg?.games?.find((g) => g.id === gameId);
  if (!game) return null;

  let merged = {
    governance: cfg?.defaults?.governance ?? {},
    shader: cfg?.defaults?.shader ?? null,
    chrome: cfg?.defaults?.chrome ?? null,
    screen: cfg?.defaults?.screen ?? null,
    onscreenControls: cfg?.defaults?.onscreenControls ?? false,
  };

  merged = deepMerge(merged, {
    governance: game.governance,
    shader: game.shader,
    chrome: game.chrome,
    screen: game.screen,
    onscreenControls: game.onscreenControls,
  });

  if (userId && cfg?.users?.[userId]) {
    const u = cfg.users[userId];
    merged = deepMerge(merged, {
      governance: u.governance,
      shader: u.shader,
      chrome: u.chrome,
      screen: u.screen,
      onscreenControls: u.onscreenControls,
    });
  }

  return {
    id: game.id,
    system: game.system,
    rom: game.rom,
    title: game.title,
    boxart: game.boxart,
    // Save behavior surfaced to the browser so the launch flow knows whether to
    // fingerprint up front (state/battery) or boot anonymously (none).
    saveMode: game.saveMode ?? 'none',
    // Per-game EJS_core override (null ⇒ use the system core).
    core: game.core ?? null,
    watches: game.watches ?? null,
    hooks: game.hooks ?? null,
    governance: merged.governance,
    shader: merged.shader,
    chrome: merged.chrome,
    // Bezel control surface (screen cutout, hotspots, overlays, onscreen
    // controls). Already merged system-under-game in loadEmulatorConfig;
    // passed through to the browser.
    presentation: game.presentation ?? null,
  };
}

/**
 * Build the browser-facing catalog ({ systems, games }).
 * Tolerant: games referencing an unknown system are skipped (logged), and
 * credit-mode games missing a finite earn_rate fall back to the default.
 * Relative path strings (boxart/rom/core) are left untouched; URL building
 * is the router's responsibility.
 *
 * @param {object} cfg     Emulator config
 * @param {object} [logger] Logger with warn/info/debug/error (defaults to no-op)
 * @returns {{ systems: object, games: object[], consoles: object[] }}
 */
export function buildCatalog(cfg, logger = NOOP_LOGGER) {
  const systems = cfg?.systems ?? {};
  const defaultEarnRate = isFiniteNumber(cfg?.defaults?.governance?.earn_rate)
    ? cfg.defaults.governance.earn_rate
    : 1;

  const games = [];
  for (const game of cfg?.games ?? []) {
    if (!(game.system in systems)) {
      logger.warn('emulator.catalog.unknown_system', { id: game.id, system: game.system });
      continue;
    }

    const resolved = resolveGameRules(cfg, game.id, null);
    if (!resolved) continue;

    if (resolved.governance?.mode === 'credit' && !isFiniteNumber(resolved.governance?.earn_rate)) {
      resolved.governance = { ...resolved.governance, earn_rate: defaultEarnRate };
    }

    games.push(resolved);
  }

  return { systems, games, consoles: resolveConsoles(cfg, systems) };
}

/**
 * Resolve the ordered console-tab list for the arcade shell.
 *
 * Each configured slot becomes either a REAL console (its `system` is known —
 * gets a label fallback) or a blank PLACEHOLDER (no/unknown system). When no
 * `consoles` are configured, fall back to one real tab per discovered system so
 * the shell still works without a consoles.yml.
 *
 * @param {object} cfg     Emulator config ({ consoles?, systems })
 * @param {object} systems Known systems map ({ [id]: { label } })
 * @returns {Array<{ system: string|null, label: string|null, placeholder: boolean }>}
 */
export function resolveConsoles(cfg, systems = {}) {
  const configured = Array.isArray(cfg?.consoles) ? cfg.consoles : [];
  if (configured.length === 0) {
    return Object.entries(systems).map(([system, s]) => ({
      system,
      label: s?.label ?? system,
      placeholder: false,
    }));
  }
  return configured.map((slot) => {
    const system = slot?.system ?? null;
    if (system && system in systems) {
      return { system, label: slot.label || systems[system].label || system, placeholder: false };
    }
    return { system: null, label: slot?.label ?? null, placeholder: true };
  });
}
