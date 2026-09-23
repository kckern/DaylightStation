/** Persists the sync-health monitor's state so a restart can't hide a stale stage. */
export class ISyncHealthStore {
  load() { throw new Error('ISyncHealthStore.load must be implemented'); }
  save(_state) { throw new Error('ISyncHealthStore.save must be implemented'); }
}
export default ISyncHealthStore;
