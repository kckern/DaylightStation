import { AmbientSchedulerService } from './application/ambient/AmbientSchedulerService.mjs';
import { YamlAmbientStateStore } from './adapters/ambient/YamlAmbientStateStore.mjs';
export function createAmbientScheduler({ loadSchedule, tracker, wakeAndLoadService, deviceService, dataDir, createScheduler, loggerFor }) {
  return new AmbientSchedulerService({ loadSchedule, tracker, wakeAndLoadService, deviceService,
    stateStore: new YamlAmbientStateStore({ dataDir, logger: loggerFor('ambient-state') }),
    scheduler: createScheduler(), timeZone: 'America/Los_Angeles', logger: loggerFor('ambient-scheduler') });
}
