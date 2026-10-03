/**
 * IRoutineSnapshotDatastore — port for the last imported routine catalog
 * (routines extracted where the routine config is readable, e.g. on the host,
 * and posted to the app; see cli/media-routines.cli.mjs).
 */
export class IRoutineSnapshotDatastore {
  /** @param {string} [householdId] @returns {Promise<{routines:Object[], importedAt:string|null, source:string|null}|null>} */
  async load(householdId) {
    throw new Error('IRoutineSnapshotDatastore.load must be implemented');
  }

  /** @param {{routines:Object[], importedAt:string, source:string}} snapshot @param {string} [householdId] */
  async save(snapshot, householdId) {
    throw new Error('IRoutineSnapshotDatastore.save must be implemented');
  }
}

export default IRoutineSnapshotDatastore;
