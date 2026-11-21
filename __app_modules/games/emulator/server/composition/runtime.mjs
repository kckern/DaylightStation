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
import { EmulatorEffectService } from "../application/EmulatorEffectService.mjs";

/**
 * @param {object} deps
 * @param {object} [deps.haGateway]     Home Assistant gateway for registry effects (lights, scenes).
 * @param {object} [deps.lightingHold]  { hold, release } — the fitness zone LED controller, so a
 *                                      game effect owns the garage strips while it is entered.
 */
export function createEmulatorRuntime({configService,rootLogger,eventBus,haGateway = null,lightingHold = null}) {
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
    // Household effects a game's memory state can enter/exit (effects.yml).
    const effectService = new EmulatorEffectService({
      readRegistry: () => configRepository.readEffectsConfig(),
      haGateway,
      lightingHold,
      logger: rootLogger.child({ module: 'emulator-effects' }),
      // Coalescing waits and max-duration exits; unref so they never hold the process.
      setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
      clearTimer: (t) => clearTimeout(t),
    });
    const router = createEmulatorRouter({
      effectService,
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
