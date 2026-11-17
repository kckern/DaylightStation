/** Provider reads first; command methods are added with their first real consumers. */
export class IWorkProvider {
  async readSnapshot(_input) {
    throw new Error('IWorkProvider.readSnapshot not implemented');
  }
  async getItem(_input) {
    throw new Error('IWorkProvider.getItem not implemented');
  }
  capabilities(_input) {
    throw new Error('IWorkProvider.capabilities not implemented');
  }
}
