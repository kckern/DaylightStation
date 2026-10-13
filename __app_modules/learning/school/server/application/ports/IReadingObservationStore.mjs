export class IReadingObservationStore {
  append(_event) { throw new Error('IReadingObservationStore.append must be implemented'); }
  async list(_location, _options) { throw new Error('IReadingObservationStore.list must be implemented'); }
}
