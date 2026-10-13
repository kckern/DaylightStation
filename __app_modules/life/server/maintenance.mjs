export function registerLifeplanMaintenance({ agentsServices, lifeplanResult, rootLogger }) {
  if (agentsServices.scheduler) {
    agentsServices.scheduler.registerTask('lifeplan:ceremony-check', '0 * * * *', async () => {
      const lifePlanStore = lifeplanResult.container.getLifePlanStore();
      for (const username of lifePlanStore.listUsernames()) {
        await lifeplanResult.ceremonyScheduler.checkAndNotify(username);
      }
    });
  }

  // Nightly drift/allocation snapshot per user with a plan — the dashboard's
  // drift gauge and the weekly retro read these snapshots. Also flushes any
  // stale pre-fix snapshots that carried a false 'reconsidering' status.
  if (agentsServices.scheduler) {
    agentsServices.scheduler.registerTask('lifeplan:drift-refresh', '0 2 * * *', async () => {
      const lifePlanStore = lifeplanResult.container.getLifePlanStore();
      for (const username of lifePlanStore.listUsernames()) {
        try {
          await lifeplanResult.services.driftService.computeAndSave(username);
        } catch (err) {
          rootLogger.warn('lifeplan.drift.refresh_failed', { username, error: err.message });
        }
      }
    });
  }

}
