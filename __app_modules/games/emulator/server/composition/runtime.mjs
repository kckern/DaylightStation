import { randomUUID } from 'node:crypto';
import { FilesystemEmulatorCheckpointRepository } from '../adapters/FilesystemEmulatorCheckpointRepository.mjs';
import { EmulatorCheckpointService } from '../application/EmulatorCheckpointService.mjs';
import path from 'node:path';
import { loadEmulatorConfig } from "../application/loadEmulatorConfig.mjs";
import { FilesystemEmulatorConfigRepository } from "../adapters/FilesystemEmulatorConfigRepository.mjs";
import { EmulatorResourceService } from "../application/EmulatorResourceService.mjs";
import { FilesystemEmulatorAssetRepository } from "../adapters/FilesystemEmulatorAssetRepository.mjs";
import { FilesystemEmulatorSaveRepository } from "../adapters/FilesystemEmulatorSaveRepository.mjs";
import { EmulatorLibraryService } from "../application/EmulatorLibraryService.mjs";
import { buildCatalog, resolveGameRules } from "../application/EmulatorCatalog.mjs";
import { createEmulatorRouter } from "../api/emulator.mjs";

export function createEmulatorRuntime({configService,rootLogger,eventBus}) {
    const emulationDir = path.join(configService.getMediaDir(), 'emulation');
    const engineDir = path.join(emulationDir, '_engine');
    const emuLogger = rootLogger.child({ module: 'emulator-api' });
    const configRepository = new FilesystemEmulatorConfigRepository({ emulationDir });
    const loadConfig = () => loadEmulatorConfig({ emulationDir, configRepository, logger: emuLogger });
    const assetRepository = new FilesystemEmulatorAssetRepository({ emulationDir, engineDir, loadCatalog: loadConfig });
    const saveRepository = new FilesystemEmulatorSaveRepository({ emulationDir });
    const checkpointService = new EmulatorCheckpointService({
      checkpointRepository: new FilesystemEmulatorCheckpointRepository({ emulationDir }),
      assetRepository, saveRepository, loadConfig, makeId: randomUUID,
    });
    const emulatorResources = new EmulatorResourceService({
      assetRepository,
      saveRepository,
      loadConfig,
      resolveGameRules,
    });
    const emulatorLibrary = new EmulatorLibraryService({ loadConfig, buildCatalog, resolveGameRules, logger: emuLogger });
    const router = createEmulatorRouter({
      logger: emuLogger,
      emulatorResources,
      emulatorLibrary,
      checkpointService,
      // Broadcasts the bt.pair.request bus topic the garage fitness bridge
      // listens for (puts the box into controller-pairing mode without SSH).
      // eventBus is already constructed (above) and in scope here.
      publishBtPair: (payload) => eventBus.broadcast('bt.pair.request', { topic: 'bt.pair.request', ...payload }),
    });
    return router;
}
