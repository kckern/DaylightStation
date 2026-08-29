import { IHomeStateRepository } from '#apps/home-automation/ports/IHomeStateRepository.mjs';

const KEYS = Object.freeze({
  volume: 'hardware/volLevel',
  keyboard: 'triggers/bindings/keyboard',
  events: 'calendar/events',
});

/** Owns the legacy household YAML keys used by home-control application queries. */
export class HouseholdHomeStateRepository extends IHomeStateRepository {
  constructor({ load, save }) {
    super();
    if (typeof load !== 'function') throw new Error('HouseholdHomeStateRepository requires load');
    this.load = load;
    this.save = typeof save === 'function' ? save : null;
  }

  loadVolumeState() { return this.load(KEYS.volume); }
  saveVolumeState(state) { return this.save?.(KEYS.volume, state); }
  loadKeyboardBindings() { return this.load(KEYS.keyboard); }
  loadEvents() { return this.load(KEYS.events); }
}

export default HouseholdHomeStateRepository;
