/**
 * YAML persistence for play intents.
 *
 * Layout: `gaming/arcade-game-sessions/intents/{deviceId}.yml` — one standing intent
 * per device, overwritten by the next launch. Nothing is deleted; a superseded
 * or expired intent simply stops authorising anything, and remains readable as
 * a record of what was last attempted on that device.
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IArcadeGameSessionIntentRepository } from '#apps/gaming/ports/IArcadeGameSessionIntentRepository.mjs';
import { ArcadeGameSessionIntent } from '#domains/gaming/value-objects/ArcadeGameSessionIntent.mjs';

export class YamlArcadeGameSessionIntentDatastore extends IArcadeGameSessionIntentRepository {
  #configService; #logger;

  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService) {
      throw new InfrastructureError('YamlArcadeGameSessionIntentDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #intentPath(deviceId, householdId) {
    return path.join(
      this.#configService.getHouseholdPath('gaming/arcade-game-sessions', householdId),
      'intents', String(deviceId),
    );
  }

  async record(intent, { householdId = null } = {}) {
    const file = this.#intentPath(intent.deviceId, householdId);
    ensureDir(path.dirname(file));
    saveYaml(file, intent.toSnapshot(), { noRefs: true });
    return intent;
  }

  async findForDevice(deviceId, { householdId = null } = {}) {
    const snapshot = loadYamlSafe(this.#intentPath(deviceId, householdId));
    if (!snapshot || typeof snapshot !== 'object') return null;
    try {
      return ArcadeGameSessionIntent.fromSnapshot(snapshot);
    } catch (error) {
      // An unreadable intent costs attribution, not availability.
      this.#logger.warn?.('arcade.intent.unreadable', { deviceId, error: error.message });
      return null;
    }
  }
}

export default YamlArcadeGameSessionIntentDatastore;
