export class SnapshotRepository {
  async getVersion(_sessionId) { return undefined; }
  async get(_sessionId) { throw new Error('SnapshotRepository.get not implemented'); }
  async put(_session, _options) { throw new Error('SnapshotRepository.put not implemented'); }
  observe(_sessionId, _listener) { throw new Error('SnapshotRepository.observe not implemented'); }
}
