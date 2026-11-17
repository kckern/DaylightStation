/** Normalized provider reads, guarded commands and read-only reconciliation. */
export class IWorkProvider {
  async readSnapshot(_input) {
    throw new Error('IWorkProvider.readSnapshot not implemented');
  }
  async getItem(_input) {
    throw new Error('IWorkProvider.getItem not implemented');
  }
  async execute(_input) {
    throw new Error('IWorkProvider.execute not implemented');
  }
  async reconcile(_input) {
    throw new Error('IWorkProvider.reconcile not implemented');
  }
  capabilities(_input) {
    throw new Error('IWorkProvider.capabilities not implemented');
  }
}
