import { isEmulatorAssetRepository } from "./ports/IEmulatorAssetRepository.mjs";
import { isEmulatorSaveRepository } from "./ports/IEmulatorSaveRepository.mjs";

/** Emulator asset lookup and save-state persistence operations. */
export class EmulatorResourceService {
  #assets;
  #saves;
  #loadConfig;
  #resolveGameRules;

  constructor({ assetRepository, saveRepository, loadConfig, resolveGameRules }) {
    if (!isEmulatorAssetRepository(assetRepository)) {
      throw new Error('EmulatorResourceService requires assetRepository');
    }
    if (!isEmulatorSaveRepository(saveRepository)) {
      throw new Error('EmulatorResourceService requires saveRepository');
    }
    if (typeof loadConfig !== 'function') {
      throw new Error('EmulatorResourceService requires loadConfig');
    }
    if (typeof resolveGameRules !== 'function') {
      throw new Error('EmulatorResourceService requires resolveGameRules');
    }
    this.#assets = assetRepository;
    this.#saves = saveRepository;
    this.#loadConfig = loadConfig;
    this.#resolveGameRules = resolveGameRules;
  }

  getEngineResource(assetId) {
    try {
      return this.#assets.getEngineResource(assetId);
    } catch (error) {
      const isMissingLocale = error?.code === 'ENOENT'
        && /^localization\/[\w-]+\.json$/.test(assetId)
        && assetId !== 'localization/en.json';
      if (!isMissingLocale) throw error;
      try {
        return this.#assets.getEngineResource('localization/en.json');
      } catch {
        // Retain the original ENOENT so the HTTP adapter preserves its 404 even
        // when the fallback itself is unreadable for a non-absence reason.
        throw error;
      }
    }
  }

  getRomResource({ system, gameId }) {
    return this.#assets.getRomResource({ system, gameId });
  }

  /** The console's wordmark for its tab (system-scoped; see the repository). */
  getSystemLogoResource({ system }) {
    return this.#assets.getSystemLogoResource({ system });
  }

  getArtResource({ system, gameId, kind }) {
    return this.#assets.getArtResource({ system, gameId, kind });
  }

  // A game with a save owner is one person's: nobody else may write or erase
  // its save. The browser already refuses to launch it for anyone else; this
  // is the backstop, so a stale tab or a hand-made request cannot overwrite it.
  #assertWriter({ gameId, user }) {
    const owner = this.#resolveGameRules(this.#loadConfig(), gameId, null)?.saveOwner;
    if (owner && String(user ?? '').toLowerCase() !== String(owner).toLowerCase()) {
      const error = new Error(`save for ${gameId} belongs to ${owner}`);
      error.code = 'ESAVEOWNER';
      throw error;
    }
  }

  getSaveResource(key) { return this.#saves.getSaveResource(key); }
  storeSaveArtifact(key, artifact) { this.#assertWriter(key); return this.#saves.storeSaveArtifact(key, artifact); }
  deleteSave(key) { this.#assertWriter(key); return this.#saves.deleteSave(key); }
  getStateResource(key) { return this.#saves.getStateResource(key); }
  storeStateArtifact(key, artifact) { this.#assertWriter(key); return this.#saves.storeStateArtifact(key, artifact); }
  deleteState(key) { this.#assertWriter(key); return this.#saves.deleteState(key); }

  listSaveUsers({ system, gameId }) {
    const rules = this.#resolveGameRules(this.#loadConfig(), gameId, null) ?? {};
    if ((rules.saveMode ?? 'none') === 'none') return [];
    return this.#saves.listUsers(system, gameId);
  }
}

export default EmulatorResourceService;
