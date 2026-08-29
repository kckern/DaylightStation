/** Persistence boundary for the recoverable fitness-session trash queue. */
export class ISessionTrashStore {
  async listRetentionBatches() {
    throw new Error('ISessionTrashStore.listRetentionBatches must be implemented');
  }

  async permanentlyDelete(_entry) {
    throw new Error('ISessionTrashStore.permanentlyDelete must be implemented');
  }

  async pruneBatchIfEmpty(_date) {
    throw new Error('ISessionTrashStore.pruneBatchIfEmpty must be implemented');
  }
}
