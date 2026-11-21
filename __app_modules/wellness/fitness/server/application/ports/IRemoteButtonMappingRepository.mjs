/**
 * IRemoteButtonMappingRepository — what each Bluetooth remote's buttons do,
 * for one household (RemoteButtonService). A document:
 * { remotes: { ADDRESS: { buttons, positions, label, updatedAt, updatedBy } } }.
 */
export class IRemoteButtonMappingRepository {
  /** @returns {Promise<object|null>} the household's document, or null when none is saved */
  async load(householdId) { throw new Error('IRemoteButtonMappingRepository.load must be implemented'); }

  /** @param {object} document { remotes } */
  async save(householdId, document) { throw new Error('IRemoteButtonMappingRepository.save must be implemented'); }
}

export function isRemoteButtonMappingRepository(obj) {
  return !!obj && typeof obj.load === 'function' && typeof obj.save === 'function';
}
