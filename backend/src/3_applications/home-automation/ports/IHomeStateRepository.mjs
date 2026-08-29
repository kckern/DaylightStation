/** Semantic persistence boundary for legacy home-control state. */
export class IHomeStateRepository {
  loadVolumeState() { throw new Error('IHomeStateRepository.loadVolumeState must be implemented'); }
  saveVolumeState(_state) { throw new Error('IHomeStateRepository.saveVolumeState must be implemented'); }
  loadKeyboardBindings() { throw new Error('IHomeStateRepository.loadKeyboardBindings must be implemented'); }
  loadEvents() { throw new Error('IHomeStateRepository.loadEvents must be implemented'); }
}

export default IHomeStateRepository;
