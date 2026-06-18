// backend/src/1_adapters/persistence/yaml/YamlEmergencyLockDatastore.mjs
import { loadYamlFromPath, saveYamlToPath, deleteFile } from '#system/utils/FileIO.mjs';
import { IEmergencyLockRepository } from '#apps/fitness/ports/IEmergencyLockRepository.mjs';
import { LockdownState } from '#domains/fitness/value-objects/LockdownState.mjs';

/**
 * YamlEmergencyLockDatastore
 *
 * YAML-backed persistence for the single current emergency lockdown.
 * Path: household[-{hid}]/history/fitness/emergency_lock.yml
 *
 * Household is fixed at construction (the emergency lock is per-household), so
 * the repository interface (load/save/clear) takes no household argument.
 * read/write/delete are injectable so the IO surface is unit-testable.
 *
 * @module adapters/persistence/yaml
 */
const REL_DIR = 'history/fitness';
const FILE_NAME = 'emergency_lock.yml';

export class YamlEmergencyLockDatastore extends IEmergencyLockRepository {
  #configService;
  #householdId;
  #load;
  #save;
  #remove;

  constructor({ configService, householdId, load = loadYamlFromPath, save = saveYamlToPath, remove = deleteFile } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlEmergencyLockDatastore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#householdId = householdId;
    this.#load = load;
    this.#save = save;
    this.#remove = remove;
  }

  #path() {
    return `${this.#configService.getHouseholdPath(REL_DIR, this.#householdId)}/${FILE_NAME}`;
  }

  /** @returns {Promise<LockdownState|null>} */
  async load() {
    const raw = this.#load(this.#path());
    if (!raw || typeof raw !== 'object') return null;
    try {
      return LockdownState.fromData(raw);
    } catch {
      // Corrupt/partial record on disk → treat as unlocked rather than crash.
      return null;
    }
  }

  /** @param {LockdownState} state */
  async save(state) {
    this.#save(this.#path(), state.toData());
  }

  async clear() {
    this.#remove(this.#path());
  }
}
