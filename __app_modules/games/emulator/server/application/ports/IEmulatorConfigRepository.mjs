/** Parsed configuration sources needed to assemble the emulator catalog. */
export class IEmulatorConfigRepository {
  readManifests() { throw new Error('IEmulatorConfigRepository.readManifests not implemented'); }
  readInputConfig() { throw new Error('IEmulatorConfigRepository.readInputConfig not implemented'); }
  readConsolesConfig() { throw new Error('IEmulatorConfigRepository.readConsolesConfig not implemented'); }
  readSettingsConfig() { throw new Error('IEmulatorConfigRepository.readSettingsConfig not implemented'); }
}

export function isEmulatorConfigRepository(candidate) {
  return candidate
    && typeof candidate.readManifests === 'function'
    && typeof candidate.readInputConfig === 'function'
    && typeof candidate.readConsolesConfig === 'function'
    && typeof candidate.readSettingsConfig === 'function';
}

export default IEmulatorConfigRepository;
