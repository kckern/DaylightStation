/**
 * Port for provenance (which streaming service a title is "from").
 * Reference: __docs/reference/media/provenance.md
 */

/** Remembers availability per title, and the month's lookup usage. */
export class IProvenanceStore {
  /** @returns {Promise<object|null>} the stored record for `plex:<key>` */
  async get(_key) { throw new Error('IProvenanceStore.get not implemented'); }
  /** Saves a record and, when given, the month's usage. */
  async put(_key, _record, _usage) { throw new Error('IProvenanceStore.put not implemented'); }
  /** @returns {Promise<{month:string,quota:number|null,quotaUsed:number|null}|null>} */
  async usage() { throw new Error('IProvenanceStore.usage not implemented'); }
}
