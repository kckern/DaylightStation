/** Persistence boundary for the Fresh Video scheduler workflow. */
export class IFreshVideoMediaStore {
  acquireRunLock(_ownerId, _staleMs, _timestamp) { throw new Error('acquireRunLock not implemented'); }
  cleanupOlderThan(_cutoff) { throw new Error('cleanupOlderThan not implemented'); }
  cleanupInvalid(_provider) { throw new Error('cleanupInvalid not implemented'); }
  findDatedVideo(_provider, _date) { throw new Error('findDatedVideo not implemented'); }
  listVideosSince(_cutoff) { throw new Error('listVideosSince not implemented'); }
  ensureProvider(_provider) { throw new Error('ensureProvider not implemented'); }
  loadProviderMetadata(_provider) { throw new Error('loadProviderMetadata not implemented'); }
  saveProviderMetadata(_provider, _metadata) { throw new Error('saveProviderMetadata not implemented'); }
  presentRunResult(_result) { throw new Error('presentRunResult not implemented'); }
}

export default IFreshVideoMediaStore;
