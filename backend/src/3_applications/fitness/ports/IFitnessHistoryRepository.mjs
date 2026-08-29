export class IFitnessHistoryRepository {
  isAvailable() { throw new Error('IFitnessHistoryRepository.isAvailable must be implemented'); }
  list(_date) { throw new Error('IFitnessHistoryRepository.list must be implemented'); }
  find(_sessionId) { throw new Error('IFitnessHistoryRepository.find must be implemented'); }
  save(_sessionId, _session) { throw new Error('IFitnessHistoryRepository.save must be implemented'); }
  remove(_sessionId) { throw new Error('IFitnessHistoryRepository.remove must be implemented'); }
}
