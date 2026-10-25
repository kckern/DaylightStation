/** Atomic versioned progress bundles, independent of the transport. */
export class IEmulatorCheckpointRepository {
  protect(_key) { throw new Error('protect not implemented'); }
  readMetadata(_key) { throw new Error('readMetadata not implemented'); }
  read(_key) { throw new Error('read not implemented'); }
  commit(_key, _checkpoint) { throw new Error('commit not implemented'); }
  history(_key) { throw new Error('history not implemented'); }
  inspectRecovery(_key) { throw new Error('inspectRecovery not implemented'); }
  readRecoveryRevision(_key, _revision) { throw new Error('readRecoveryRevision not implemented'); }
  repairHead(_key, _payload) { throw new Error('repairHead not implemented'); }
  readRevision(_key, _revision) { throw new Error('readRevision not implemented'); }
}
