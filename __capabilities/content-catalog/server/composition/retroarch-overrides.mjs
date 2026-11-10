/**
 * Public facet: RetroArch per-game override files (savestate auto-load per game).
 *
 * Callers supply a device `shell(script)` runner (ADB in production) so this
 * owner never picks a device or transport. See
 * __docs/reference/gaming/retroarch-game-overrides.md.
 */
import { RetroArchGameOverrideWriter } from '../adapters/providers/retroarch/RetroArchGameOverrideWriter.mjs';
import { createRetroArchLaunchPreparer } from '../adapters/providers/retroarch/prepareRetroArchLaunch.mjs';
import { planAllGameOverrides } from '../adapters/providers/retroarch/retroarchGameOverrides.mjs';

/** LaunchService `prepareLaunch` hook for retroarch items. */
export function createRetroArchPrepareLaunch({ shell, getConfig, readCatalog, logger, budgetMs }) {
  const writer = new RetroArchGameOverrideWriter({ shell, logger });
  return createRetroArchLaunchPreparer({ getConfig, readCatalog, writer, logger, budgetMs });
}

/** Bulk sync of every catalog game's override. */
export async function syncRetroArchGameOverrides({ shell, config, catalog, logger }) {
  const { plans, skipped } = planAllGameOverrides({ config, catalog });
  const results = await new RetroArchGameOverrideWriter({ shell, logger }).ensureAll(plans);
  return { results, skipped };
}

/** Dry-run plan of every catalog game's override. */
export function planRetroArchGameOverrides({ config, catalog }) {
  return planAllGameOverrides({ config, catalog });
}
