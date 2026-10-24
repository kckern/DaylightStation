
const CORE_NAMES = Object.freeze({ gb: 'gambatte', gba: 'mgba', segaMD: 'genesis_plus_gx', segaGG: 'genesis_plus_gx' });
const error = (code, message) => Object.assign(new Error(message), { code });
const sameProvenance = (a, b) => a?.romHash === b?.romHash && a?.core?.name === b?.core?.name
  && a?.core?.bundleHash === b?.core?.bundleHash && a?.core?.format === b?.core?.format
  && a?.core?.variant === b?.core?.variant;
async function resourceBytes(resource) {
  const chunks = [];
  let size = 0;
  for await (const chunk of resource.open()) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw error('ECHECKPOINTINVALID', 'Save exceeds the supported size');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) throw error('ECHECKPOINTCORRUPT', 'An existing save file is empty');
  return Buffer.concat(chunks);
}

/** Identity, compatible asset provenance, migration and explicit progress operations. */
export class EmulatorCheckpointService {
  #checkpoints; #saves; #assets; #loadConfig; #makeId;
  constructor({ checkpointRepository, saveRepository, assetRepository, loadConfig, makeId }) {
    if (!checkpointRepository || !saveRepository || !assetRepository || typeof loadConfig !== 'function' || typeof makeId !== 'function') {
      throw new Error('EmulatorCheckpointService requires checkpoint, save, asset and configuration ports');
    }
    this.#checkpoints = checkpointRepository;
    this.#saves = saveRepository;
    this.#assets = assetRepository;
    this.#loadConfig = loadConfig;
    this.#makeId = makeId;
  }
  async #context(key, variant = 'wasm') {
    if (!['wasm', 'legacy-wasm'].includes(variant)) throw error('ECHECKPOINTINVALID', 'Unknown core variant');
    const config = this.#loadConfig();
    const game = config.games?.find(item => item.id === key.gameId && item.system === key.system);
    if (!game) throw error('ENOENT', 'Unknown emulator game');
    if (game.saveOwner && String(key.user).toLowerCase() !== String(game.saveOwner).toLowerCase()) throw error('ESAVEOWNER', 'Save belongs to another player');
    if (!['state', 'battery'].includes(game.saveMode)) throw error('ECHECKPOINTINVALID', 'This game does not support saving');
    const coreId = game.core || config.systems?.[key.system]?.core;
    const coreName = CORE_NAMES[coreId] || config.systems?.[key.system]?.nativeCore;
    if (!coreName || !/^[a-z0-9_-]+$/i.test(coreName)) throw error('ECHECKPOINTINVALID', 'This emulator core has no protected save contract');
    const provenance = {
      romHash: await this.#assets.getResourceDigest(this.#assets.getRomResource(key)),
      core: { name: coreName,
        bundleHash: await this.#assets.getResourceDigest(this.#assets.getEngineResource(`cores/${coreName}-${variant}.data`)),
        format: 1, variant,
      },
    };
    return { saveMode: game.saveMode, provenance };
  }
  async #legacy(key, mode) {
    const read = async (getResource) => {
      let resource;
      try { resource = getResource(); }
      catch (err) { if (err.code === 'ENOENT') return null; throw err; }
      // A resource that disappeared or failed mid-read is an error, not absence.
      return resourceBytes(resource);
    };
    const snapshot = await read(() => this.#saves.getStateResource({ ...key, slot: 'auto' }));
    const battery = mode === 'battery' ? await read(() => this.#saves.getSaveResource(key)) : null;
    return snapshot || battery ? { snapshot, battery } : null;
  }
  async #description(key, { variant = 'wasm' } = {}, includeArtifacts = true) {
    key = { ...key, user: String(key.user).toLowerCase() };
    const context = await this.#context(key, variant);
    // Establish the new protocol before inspecting legacy bytes. All legacy
    // writers share this boundary, so migration cannot race a half-written pair.
    await this.#checkpoints.protect(key);
    let head = includeArtifacts ? await this.#checkpoints.read(key) : await this.#checkpoints.readMetadata(key);
    if (!head) {
      const legacy = await this.#legacy(key, context.saveMode);
      if (legacy) {
        try {
          head = await this.#checkpoints.commit(key, { ...legacy, expectedRevision: null,
            provenance: context.provenance, captureId: this.#makeId(), sessionId: this.#makeId(), sequence: 0, kind: 'baseline',
          });
        } catch (err) {
          if (err.code !== 'ECHECKPOINTCONFLICT') throw err;
          head = await this.#checkpoints.read(key);
        }
      }
    }
    return { ...context, head, compatible: !head || sameProvenance(head.provenance, context.provenance) };
  }
  read(key, options) { return this.#description(key, options); }
  #requiredBytes(mode, captured, { importOnly = false } = {}) {
    const valid = value => value instanceof Uint8Array && value.length > 0 && value.length <= 8 * 1024 * 1024;
    if (mode === 'state' ? !valid(captured.snapshot)
      : (!valid(captured.battery) || (!importOnly && !valid(captured.snapshot)))) {
      throw error('ECHECKPOINTINVALID', 'Required save data was not captured');
    }
  }
  async #write(key, payload, kind) {
    const description = await this.#description(key, { variant: payload.provenance?.core?.variant }, kind === 'save');
    if (!sameProvenance(payload.provenance, description.provenance)) throw error('ECHECKPOINTCOMPAT', 'The game or emulator changed; recover explicitly');
    if (kind === 'save' && !description.compatible) throw error('ECHECKPOINTCOMPAT', 'Existing progress requires explicit compatible recovery');
    if (kind !== 'reset') this.#requiredBytes(description.saveMode, payload, { importOnly: kind === 'import' });
    return this.#checkpoints.commit({ ...key, user: String(key.user).toLowerCase() }, { ...payload, kind,
      snapshot: kind === 'reset' ? null : payload.snapshot,
      battery: kind === 'reset' ? null : payload.battery,
      provenance: description.provenance,
    });
  }
  commit(key, payload) { return this.#write(key, payload, 'save'); }
  reset(key, payload) { return this.#write(key, payload, 'reset'); }
  import(key, payload) { return this.#write(key, payload, 'import'); }
  async history(key) {
    await this.#context(key);
    return this.#checkpoints.history({ ...key, user: String(key.user).toLowerCase() });
  }
  async revision(key, revision) {
    await this.#context(key);
    return this.#checkpoints.readRevision({ ...key, user: String(key.user).toLowerCase() }, revision);
  }
  async recover(key, payload) {
    const description = await this.#description(key, { variant: payload.provenance?.core?.variant }, false);
    const source = await this.#checkpoints.readRevision({ ...key, user: String(key.user).toLowerCase() }, payload.sourceRevision);
    if (!sameProvenance(payload.provenance, description.provenance) || source.provenance.romHash !== description.provenance.romHash) {
      throw error('ECHECKPOINTCOMPAT', 'This checkpoint belongs to a different game');
    }
    // Recovery is explicit, preserves the original record and still uses CAS.
    return this.#checkpoints.commit({ ...key, user: String(key.user).toLowerCase() }, { ...payload,
      snapshot: source.snapshot, battery: source.battery, provenance: description.provenance,
      kind: source.kind === 'reset' ? 'reset' : 'recover', restoredFrom: source.revision,
    });
  }
}
