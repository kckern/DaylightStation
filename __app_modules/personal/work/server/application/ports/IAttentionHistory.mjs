/** Owner-provided acknowledged/prepared attention receipts, never KB evidence. */
export class IAttentionHistory {
  async read(_input) {
    throw new Error('IAttentionHistory.read not implemented');
  }
}
