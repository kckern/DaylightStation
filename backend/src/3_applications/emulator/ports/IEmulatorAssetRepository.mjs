/** Immutable/runtime assets needed by an emulator session. */
export class IEmulatorAssetRepository {
  getEngineResource(_assetId) {
    throw new Error('IEmulatorAssetRepository.getEngineResource not implemented');
  }

  getRomResource(_gameRef) {
    throw new Error('IEmulatorAssetRepository.getRomResource not implemented');
  }

  getArtResource(_artRef) {
    throw new Error('IEmulatorAssetRepository.getArtResource not implemented');
  }
}

export function isEmulatorAssetRepository(candidate) {
  return candidate
    && typeof candidate.getEngineResource === 'function'
    && typeof candidate.getRomResource === 'function'
    && typeof candidate.getArtResource === 'function';
}

export default IEmulatorAssetRepository;
