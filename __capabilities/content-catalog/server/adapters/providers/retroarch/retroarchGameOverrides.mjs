/**
 * Per-game RetroArch override planning — pure, no I/O.
 *
 * RetroArch applies a game override file `<config_dir>/<core name>/<rom basename>.cfg`
 * on top of the global retroarch.cfg when that game loads. The Android intent
 * cannot carry per-launch config, so this is the only per-game lever we have.
 *
 * We own exactly one key in those files: `savestate_auto_load`. It mirrors the
 * catalog's per-game `resume` flag (catalog.yml `overrides["<console>/<game>"].resume`),
 * which defaults to false — a game only boots back into its last state when the
 * household config says so. Every other line in an override file is preserved.
 *
 * Config shape (games.yml):
 *   launch.game_overrides.config_dir   device path of RetroArch's config dir
 *   consoles.<id>.core_name            libretro library_name = override subdirectory
 */

export const AUTO_LOAD_KEY = 'savestate_auto_load';

const KEY_LINE_RE = new RegExp(`^\\s*${AUTO_LOAD_KEY}\\s*=.*$`);

/** ROM path → file basename without its extension (RetroArch's override filename). */
export function romBasename(rom) {
  const file = String(rom || '').split('/').pop() || '';
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Device path of a game's override file. */
export function overridePath({ configDir, coreName, rom }) {
  const dir = String(configDir).replace(/\/+$/, '');
  return `${dir}/${coreName}/${romBasename(rom)}.cfg`;
}

/**
 * Set `savestate_auto_load` in an override file's text, preserving every other line.
 * @returns {{ text: string, changed: boolean }}
 */
export function applyAutoLoad(existingText, resume) {
  const wanted = `${AUTO_LOAD_KEY} = "${resume ? 'true' : 'false'}"`;
  const source = typeof existingText === 'string' ? existingText : '';
  const lines = source.length ? source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];

  let found = false;
  const out = [];
  for (const line of lines) {
    if (KEY_LINE_RE.test(line)) {
      if (!found) out.push(wanted);
      found = true;
      continue;
    }
    out.push(line);
  }
  if (!found) out.push(wanted);

  const text = `${out.join('\n')}\n`;
  return { text, changed: text !== source };
}

/**
 * Plan one game's override.
 * @returns {{ plan?: {consoleId, gameId, title, path, resume}, skip?: string }}
 */
export function planGameOverride({ config, catalog, consoleId, gameId }) {
  const configDir = config?.launch?.game_overrides?.config_dir;
  if (!configDir) return { skip: 'no-config-dir' };

  const consoleConfig = config?.consoles?.[consoleId];
  if (!consoleConfig) return { skip: 'unknown-console' };
  if (!consoleConfig.core_name) return { skip: 'no-core-name' };

  const game = (catalog?.games?.[consoleId] || []).find((g) => g.id === gameId);
  if (!game) return { skip: 'unknown-game' };
  if (!game.rom) return { skip: 'no-rom' };

  const override = catalog?.overrides?.[`${consoleId}/${gameId}`] || {};
  return {
    plan: {
      consoleId,
      gameId,
      title: override.title || game.title || gameId,
      path: overridePath({ configDir, coreName: consoleConfig.core_name, rom: game.rom }),
      resume: override.resume === true,
    },
  };
}

/** Plan every catalog game. @returns {{ plans: object[], skipped: object[] }} */
export function planAllGameOverrides({ config, catalog }) {
  const plans = [];
  const skipped = [];
  for (const [consoleId, games] of Object.entries(catalog?.games || {})) {
    for (const game of games || []) {
      const { plan, skip } = planGameOverride({ config, catalog, consoleId, gameId: game.id });
      if (plan) plans.push(plan);
      else skipped.push({ consoleId, gameId: game.id, reason: skip });
    }
  }
  return { plans, skipped };
}
