/** Journalist owns this consumer boundary; implementations receive owner runtime functions. */
export class IFollowUpSource {
  async selectForMorning(_input) {
    throw new Error('Not implemented');
  }
  async prepareDelivery(_input) {
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
}
