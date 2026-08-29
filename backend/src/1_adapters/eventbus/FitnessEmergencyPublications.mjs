export class FitnessEmergencyPublications {
  #bus;
  constructor({ eventBus } = {}) { this.#bus = eventBus; }
  locked(payload) { return this.#bus.broadcast('fitness.emergency.locked', payload); }
  released(payload) { return this.#bus.broadcast('fitness.emergency.released', payload); }
}
export default FitnessEmergencyPublications;
