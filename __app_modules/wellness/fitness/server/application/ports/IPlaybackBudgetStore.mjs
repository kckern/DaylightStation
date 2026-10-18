/** Durable per-device allowance records, partitioned by household-local day. */
export class IPlaybackBudgetStore {
  async load(key) { throw new Error('IPlaybackBudgetStore.load not implemented'); }
  async save(record) { throw new Error('IPlaybackBudgetStore.save not implemented'); }
}
