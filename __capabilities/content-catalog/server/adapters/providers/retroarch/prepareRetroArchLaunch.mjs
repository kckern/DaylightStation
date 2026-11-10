import { planGameOverride } from './retroarchGameOverrides.mjs';

const DEFAULT_BUDGET_MS = 3000;

/**
 * Build the pre-launch hook LaunchService calls before a RetroArch game starts:
 * it makes the game's override file carry the catalog's `resume` setting.
 *
 * Best effort by design. ADB-over-WiFi does not survive a Shield reboot, so the
 * hook never throws and never holds a launch longer than `budgetMs` — on
 * failure or timeout the game launches with whatever override is already on the
 * device (the global retroarch.cfg default is auto-load off).
 *
 * @param {object} deps
 * @param {() => object} deps.getConfig     games.yml (launch + consoles)
 * @param {() => object} deps.readCatalog   catalog.yml (games + overrides)
 * @param {{ ensure: Function }} deps.writer RetroArchGameOverrideWriter
 * @param {number} [deps.budgetMs]
 * @param {object} [deps.logger]
 * @returns {(item: object) => Promise<void>}
 */
export function createRetroArchLaunchPreparer({ getConfig, readCatalog, writer, budgetMs = DEFAULT_BUDGET_MS, logger = console }) {
  return async function prepareRetroArchLaunch(item) {
    if (item?.source !== 'retroarch' || !item.localId) return;
    const [consoleId, ...rest] = String(item.localId).split('/');
    const gameId = rest.join('/');

    let plan;
    try {
      const result = planGameOverride({ config: getConfig(), catalog: readCatalog(), consoleId, gameId });
      if (!result.plan) {
        logger.warn?.('retroarch.override.skipped', { consoleId, gameId, reason: result.skip });
        return;
      }
      plan = result.plan;
    } catch (err) {
      logger.warn?.('retroarch.override.plan-failed', { consoleId, gameId, error: err?.message });
      return;
    }

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'timeout', path: plan.path }), budgetMs);
    });
    try {
      const outcome = await Promise.race([
        writer.ensure(plan).catch((err) => ({ status: 'failed', path: plan.path, error: err?.message })),
        timeout,
      ]);
      const level = outcome.status === 'failed' || outcome.status === 'timeout' ? 'warn' : 'debug';
      logger[level]?.('retroarch.override.prelaunch', { consoleId, gameId, resume: plan.resume, ...outcome });
    } finally {
      clearTimeout(timer);
    }
  };
}

export default createRetroArchLaunchPreparer;
