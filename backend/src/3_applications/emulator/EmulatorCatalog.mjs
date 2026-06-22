import { deepMerge } from './lib/deepMerge.mjs';

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
  };

  merged = deepMerge(merged, {
    governance: game.governance,
    shader: game.shader,
    chrome: game.chrome,
  });

  if (userId && cfg?.users?.[userId]) {
    const u = cfg.users[userId];
    merged = deepMerge(merged, {
      governance: u.governance,
      shader: u.shader,
      chrome: u.chrome,
    });
  }

  return {
    id: game.id,
    system: game.system,
    rom: game.rom,
    title: game.title,
    boxart: game.boxart,
    watches: game.watches ?? null,
    hooks: game.hooks ?? null,
    governance: merged.governance,
    shader: merged.shader,
    chrome: merged.chrome,
  };
}
