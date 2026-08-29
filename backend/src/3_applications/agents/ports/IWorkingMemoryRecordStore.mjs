export class IWorkingMemoryRecordStore {
  async loadRecord(_agentId, _userId) {
    throw new Error('IWorkingMemoryRecordStore.loadRecord must be implemented');
  }

  async saveRecord(_agentId, _userId, _record) {
    throw new Error('IWorkingMemoryRecordStore.saveRecord must be implemented');
  }
}
