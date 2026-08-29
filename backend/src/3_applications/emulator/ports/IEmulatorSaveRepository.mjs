/** Per-user battery-save and emulator-state persistence. */
export class IEmulatorSaveRepository {
  getSaveResource(_key) { throw new Error('IEmulatorSaveRepository.getSaveResource not implemented'); }
  storeSaveArtifact(_key, _artifact) { throw new Error('IEmulatorSaveRepository.storeSaveArtifact not implemented'); }
  deleteSave(_key) { throw new Error('IEmulatorSaveRepository.deleteSave not implemented'); }
  getStateResource(_key) { throw new Error('IEmulatorSaveRepository.getStateResource not implemented'); }
  storeStateArtifact(_key, _artifact) { throw new Error('IEmulatorSaveRepository.storeStateArtifact not implemented'); }
  deleteState(_key) { throw new Error('IEmulatorSaveRepository.deleteState not implemented'); }
  listUsers(_system, _gameId) { throw new Error('IEmulatorSaveRepository.listUsers not implemented'); }
}

export function isEmulatorSaveRepository(candidate) {
  return candidate
    && typeof candidate.getSaveResource === 'function'
    && typeof candidate.storeSaveArtifact === 'function'
    && typeof candidate.deleteSave === 'function'
    && typeof candidate.getStateResource === 'function'
    && typeof candidate.storeStateArtifact === 'function'
    && typeof candidate.deleteState === 'function'
    && typeof candidate.listUsers === 'function';
}

export default IEmulatorSaveRepository;
