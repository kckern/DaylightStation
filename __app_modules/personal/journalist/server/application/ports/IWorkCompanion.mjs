/** Optional Work coordination; Journalist never owns provider or KB mutations. */
export class IWorkCompanion {
  async selectForMorning(_input) {
    throw new Error('Not implemented');
  }
  async prepareForMorning(_input) {
    throw new Error('Not implemented');
  }
  async dispatchDelivery(_input) {
    throw new Error('Not implemented');
  }
  async recordDelivery(_input) {
    throw new Error('Not implemented');
  }
  async recordDeliveryFailure(_input) {
    throw new Error('Not implemented');
  }
  capturePrincipal(_input) {
    throw new Error('Not implemented');
  }
  sourceForEntry(_input) {
    throw new Error('Not implemented');
  }
  async onEntrySaved(_input) {
    throw new Error('Not implemented');
  }
  async handleCallback(_input) {
    throw new Error('Not implemented');
  }
  async open(_input) {
    throw new Error('Not implemented');
  }
}
