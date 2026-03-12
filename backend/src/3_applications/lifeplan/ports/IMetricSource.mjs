export class IMetricSource {
  getLatest(username) { throw new Error('Not implemented'); }
  saveSnapshot(username, snapshot) { throw new Error('Not implemented'); }
  getHistory(username) { throw new Error('Not implemented'); }
}
