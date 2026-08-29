/** Application-owned persistence boundary for decoded OMR quiz scans. */
export class IDecodedQuizScanStore {
  async append(_readerId, _record) {
    throw new Error('IDecodedQuizScanStore.append not implemented');
  }

  async listRawReaders() {
    throw new Error('IDecodedQuizScanStore.listRawReaders not implemented');
  }

  async listRawDays(_readerId) {
    throw new Error('IDecodedQuizScanStore.listRawDays not implemented');
  }

  async readRawDay(_readerId, _dayFile) {
    throw new Error('IDecodedQuizScanStore.readRawDay not implemented');
  }

  async replaceDecodedDay(_readerId, _dayFile, _records) {
    throw new Error('IDecodedQuizScanStore.replaceDecodedDay not implemented');
  }
}

export default IDecodedQuizScanStore;
