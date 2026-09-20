/**
 * Application-owned boundary for cached adaptive-playback evidence. Adapters
 * may persist it durably, but callers must never use it as a startup probe.
 */
export class IPlaybackRiskRepository {
  async find(_scope) { throw new Error('IPlaybackRiskRepository.find must be implemented'); }
  async record(_outcome) { throw new Error('IPlaybackRiskRepository.record must be implemented'); }
  async save(_rule) { throw new Error('IPlaybackRiskRepository.save must be implemented'); }
}

export default IPlaybackRiskRepository;
