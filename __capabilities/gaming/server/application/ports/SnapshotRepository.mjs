export class SnapshotRepository {
  // Optional observable storage token; null means absent, undefined unsupported.
  async getVersion(_sessionId) { return undefined; }
  async get(_sessionId) { throw new Error('SnapshotRepository.get not implemented'); }
  // A version-capable writer may return { version } captured under its commit lock.
  async put(_session, _options) { throw new Error('SnapshotRepository.put not implemented'); }
  observe(_sessionId, _listener) { throw new Error('SnapshotRepository.observe not implemented'); }
}
