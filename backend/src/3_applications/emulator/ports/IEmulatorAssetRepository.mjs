/** Immutable/runtime assets needed by an emulator session. */
export class IEmulatorAssetRepository {
  getEngineResource(_assetId) {
    throw new Error('IEmulatorAssetRepository.getEngineResource not implemented');
  }

  getRomResource(_gameRef) {
    throw new Error('IEmulatorAssetRepository.getRomResource not implemented');
  }

  /** System-scoped: the console's wordmark, which exists with or without games. */
  getSystemLogoResource(_systemRef) {
    throw new Error('IEmulatorAssetRepository.getSystemLogoResource not implemented');
  }

  getArtResource(_artRef) {
    throw new Error('IEmulatorAssetRepository.getArtResource not implemented');
  }
}

export function isEmulatorAssetRepository(candidate) {
  return candidate
    && typeof candidate.getEngineResource === 'function'
    && typeof candidate.getRomResource === 'function'
    && typeof candidate.getArtResource === 'function'
    && typeof candidate.getSystemLogoResource === 'function';
}

export default IEmulatorAssetRepository;
