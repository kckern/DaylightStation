/** Durable at-most-once boundary for teacher actions with external effects. */
export class ITeacherActionReceiptStore {
  async claim({ key, fingerprint, at }) { // eslint-disable-line no-unused-vars
    throw new Error('ITeacherActionReceiptStore.claim must be implemented');
  }

  async complete({ key, fingerprint, receipt, at }) { // eslint-disable-line no-unused-vars
    throw new Error('ITeacherActionReceiptStore.complete must be implemented');
  }
}

export default ITeacherActionReceiptStore;
